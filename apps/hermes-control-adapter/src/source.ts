import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  HermesBoard,
  HermesCronjob,
  HermesConversationCommand,
  HermesMessage,
  HermesModel,
  HermesModelManagementCommand,
  HermesProfile,
  HermesProfileCommand,
  HermesProject,
  HermesProvider,
  HermesSession,
  HermesTask,
  HermesWorkCommand,
} from '@aquiero/contracts';
import type { AdapterSource, Snapshot } from './types.js';
import { HermesManagementApi, HermesManagementError } from './management-api.js';
import { truthfulProviderContract } from './provider-contracts.js';

const execFileAsync = promisify(execFile);
const ansi = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

export interface CommandRunner {
  run(args: string[]): Promise<string>;
}

export class HermesCliRunner implements CommandRunner {
  constructor(
    private readonly binary = 'hermes',
    private readonly home?: string,
  ) {}

  async run(args: string[]) {
    const { stdout } = await execFileAsync(this.binary, args, {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(this.home ? { HERMES_HOME: this.home } : {}),
      },
    });
    return stdout;
  }
}

export interface HermesNativeSourceOptions {
  runner: CommandRunner;
  baseProfileDisplayName?: string;
  apiBaseUrl?: string;
  apiToken?: string;
  managementBaseUrl?: string;
  managementToken?: string;
  fetchImpl?: typeof fetch;
}

export class HermesNativeSource implements AdapterSource {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string | undefined;
  private readonly management: HermesManagementApi | undefined;
  private readonly baseProfileDisplayName: string;

  constructor(private readonly options: HermesNativeSourceOptions) {
    this.baseProfileDisplayName = validateBaseProfileDisplayName(options.baseProfileDisplayName);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = options.apiBaseUrl ? validateApiBaseUrl(options.apiBaseUrl) : undefined;
    this.management = options.managementBaseUrl
      ? new HermesManagementApi(options.managementBaseUrl, this.fetchImpl, options.managementToken)
      : undefined;
  }

  conversationsConfigured() {
    return Boolean(this.apiBaseUrl);
  }

  modelManagementConfigured() {
    return Boolean(this.management);
  }

  async profiles(): Promise<Snapshot<HermesProfile>> {
    const output = stripAnsi(await this.options.runner.run(['profile', 'list']));
    const items = await Promise.all(
      output.split('\n').map(async (line) => {
        const columns =
          /^\s*(◆)?\s*([a-z0-9][a-z0-9_-]*)\s+(\S+)\s+(running|stopped|—)(?:\s+.*)?$/i.exec(line);
        if (!columns) return undefined;
        const active = columns[1] === '◆';
        const id = columns[2] ?? '';
        const model = columns[3];
        const gateway = columns[4]?.toLowerCase();
        const profile: HermesProfile = {
          id,
          displayName: id === 'default' ? this.baseProfileDisplayName : id,
          active,
          gatewayStatus:
            gateway === 'running' ? 'running' : gateway === 'stopped' ? 'stopped' : 'unknown',
        };
        if (model && model !== '—') profile.model = model;
        if (id.toLowerCase() !== 'profile') {
          try {
            const description = stripAnsi(
              await this.options.runner.run(['profile', 'describe', id]),
            ).trim();
            if (description && !description.startsWith('(no description set'))
              profile.description = description;
          } catch {
            // Description enrichment is optional and must never hide profile inventory truth.
          }
        }
        return profile;
      }),
    );
    return snapshot(
      items.filter(
        (item): item is HermesProfile =>
          item !== undefined && item.id.length > 0 && item.id.toLowerCase() !== 'profile',
      ),
    );
  }

  async executeProfile(command: HermesProfileCommand): Promise<Record<string, unknown>> {
    assertNativeId(command.targetId);
    const payload = record(command.payload);
    const profiles = (await this.profiles()).items;
    const current = profiles.find((item) => item.id === command.targetId);
    switch (command.operation) {
      case 'profile.create': {
        if (!current) {
          const description = optionalPayloadString(payload, 'description', 5_000);
          try {
            await this.options.runner.run([
              'profile',
              'create',
              command.targetId,
              '--no-alias',
              ...(description ? ['--description', description] : []),
            ]);
          } catch (error) {
            const reconciled = (await this.profiles()).items.some(
              (item) => item.id === command.targetId,
            );
            if (!reconciled) throw error;
            return {
              profile: {
                id: command.targetId,
                created: true,
                reconciledAfterCommandError: true,
              },
            };
          }
        }
        return { profile: { id: command.targetId, created: !current } };
      }
      case 'profile.update': {
        if (!current) throw new SourceUnavailableError('Profile was not found');
        const description = optionalPayloadString(payload, 'description', 5_000);
        if (description !== undefined) {
          try {
            await this.options.runner.run([
              'profile',
              'describe',
              command.targetId,
              '--text',
              description,
            ]);
          } catch (error) {
            const reconciled = (await this.profiles()).items.some(
              (item) => item.id === command.targetId && item.description === description,
            );
            if (!reconciled) throw error;
            return {
              profile: {
                id: command.targetId,
                updated: true,
                reconciledAfterCommandError: true,
              },
            };
          }
        }
        return { profile: { id: command.targetId, updated: description !== undefined } };
      }
      case 'profile.rename': {
        if (command.targetId === 'default')
          throw new SourceConflictError(
            'Hermes does not support renaming the built-in default profile',
          );
        const newId = payloadString(payload, 'newId', 128);
        assertNativeId(newId);
        if (newId === command.targetId)
          throw new SourceConflictError('Profile source and destination must differ');
        const destination = profiles.find((item) => item.id === newId);
        if (!current) {
          if (destination)
            return {
              profile: {
                fromId: command.targetId,
                id: newId,
                renamed: false,
                alreadyRenamed: true,
              },
            };
          throw new SourceUnavailableError('Profile was not found');
        }
        if (destination) throw new SourceConflictError('Profile destination already exists');
        try {
          await this.options.runner.run(['profile', 'rename', command.targetId, newId]);
        } catch (error) {
          const reconciled = (await this.profiles()).items;
          if (
            reconciled.some((item) => item.id === command.targetId) ||
            !reconciled.some((item) => item.id === newId)
          )
            throw error;
          return {
            profile: {
              fromId: command.targetId,
              id: newId,
              renamed: true,
              alreadyRenamed: false,
              reconciledAfterCommandError: true,
            },
          };
        }
        return {
          profile: {
            fromId: command.targetId,
            id: newId,
            renamed: true,
            alreadyRenamed: false,
          },
        };
      }
      case 'profile.delete':
        if (current) {
          try {
            await this.options.runner.run(['profile', 'delete', command.targetId, '--yes']);
          } catch (error) {
            const reconciled = !(await this.profiles()).items.some(
              (item) => item.id === command.targetId,
            );
            if (!reconciled) throw error;
            return {
              profile: {
                id: command.targetId,
                deleted: true,
                reconciledAfterCommandError: true,
              },
            };
          }
        }
        return { profile: { id: command.targetId, deleted: Boolean(current) } };
    }
  }

  async providers(refresh = false): Promise<Snapshot<HermesProvider>> {
    if (this.management) {
      const inventory = await this.management.inventory(refresh);
      return snapshot(
        inventory.providers.map((row) => mapManagementProvider(row, inventory.provider)),
      );
    }
    const output = stripAnsi(await this.options.runner.run(['status', '--all']));
    const selectedName = /^\s*Provider:\s+(.+)$/m.exec(output)?.[1]?.trim();
    const providers = new Map<string, HermesProvider>();
    let section = '';
    for (const line of output.split('\n')) {
      const heading = /^◆\s+(.+)$/.exec(line.trim());
      if (heading) {
        section = heading[1] ?? '';
        continue;
      }
      if (!['API Keys', 'Auth Providers', 'API-Key Providers'].includes(section)) continue;
      const match = /^\s{2}(.+?)\s{2,}([✓✗])(?:\s|$)/.exec(line);
      if (!match) continue;
      const displayName = match[1]?.trim() ?? '';
      const id = providerId(displayName);
      if (!id) continue;
      const configured = match[2] === '✓';
      const previous = providers.get(id);
      providers.set(id, {
        id,
        displayName,
        credentialStatus:
          configured || previous?.credentialStatus === 'configured' ? 'configured' : 'missing',
        selected: normalizeName(displayName) === normalizeName(selectedName ?? ''),
      });
    }
    if (selectedName) {
      const selected = [...providers.values()].find(
        (item) => normalizeName(item.displayName) === normalizeName(selectedName),
      );
      if (selected) selected.selected = true;
      else
        providers.set(providerId(selectedName), {
          id: providerId(selectedName),
          displayName: selectedName,
          credentialStatus: 'unknown',
          selected: true,
        });
    }
    return snapshot([...providers.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  async models(refresh = false): Promise<Snapshot<HermesModel>> {
    if (this.management) {
      const inventory = await this.management.inventory(refresh);
      const items: HermesModel[] = [];
      for (const raw of inventory.providers) {
        const row = record(raw);
        const provider = optionalString(row.slug ?? row.provider);
        if (!provider || !Array.isArray(row.models)) continue;
        const capabilities = recordOrEmpty(row.capabilities);
        for (const rawModel of row.models) {
          const id = optionalString(rawModel);
          if (!id) continue;
          const modelCapabilities = recordOrEmpty(capabilities[id]);
          items.push({
            id,
            providerId: provider,
            displayName: id,
            capabilities: [
              'text',
              'tool-use',
              ...(modelCapabilities.reasoning === true ? (['reasoning'] as const) : []),
            ],
            selected: provider === inventory.provider && id === inventory.model,
          });
        }
      }
      return snapshot(items);
    }
    const status = stripAnsi(await this.options.runner.run(['status', '--all']));
    const selectedModel = /^\s*Model:\s+(.+)$/m.exec(status)?.[1]?.trim();
    const selectedProvider = /^\s*Provider:\s+(.+)$/m.exec(status)?.[1]?.trim();
    const models = new Map<string, HermesModel>();
    if (selectedModel && selectedProvider) {
      const selectedProviderId = providerId(selectedProvider);
      models.set(`${selectedProviderId}/${selectedModel}`, {
        id: selectedModel,
        providerId: selectedProviderId,
        displayName: selectedModel,
        capabilities: [],
        selected: true,
      });
    }
    const fallback = stripAnsi(await this.options.runner.run(['fallback', 'list']));
    for (const match of fallback.matchAll(/^\s*(\d+)\.\s+(.+?)\s+\(via\s+(.+?)\)\s*$/gm)) {
      const priority = Number(match[1]);
      const modelId = match[2]?.trim();
      const fallbackProviderId = providerId(match[3]?.trim() ?? '');
      if (
        !modelId ||
        !fallbackProviderId ||
        !Number.isInteger(priority) ||
        priority < 1 ||
        priority > 99
      )
        continue;
      const key = `${fallbackProviderId}/${modelId}`;
      models.set(key, {
        id: modelId,
        providerId: fallbackProviderId,
        displayName: modelId,
        capabilities: [],
        selected: models.get(key)?.selected ?? false,
        fallbackPriority: priority,
      });
    }
    return snapshot(
      [...models.values()].sort(
        (left, right) =>
          Number(right.selected) - Number(left.selected) ||
          (left.fallbackPriority ?? 100) - (right.fallbackPriority ?? 100) ||
          left.id.localeCompare(right.id),
      ),
    );
  }

  async executeModelManagement(
    command: HermesModelManagementCommand,
  ): Promise<Record<string, unknown>> {
    if (!this.management)
      throw new SourceUnavailableError('Hermes management API is not configured');
    const payload = record(command.payload);
    try {
      switch (command.operation) {
        case 'model.select': {
          const providerId = payloadString(payload, 'providerId', 200);
          const result = await this.management.selectModel(
            providerId,
            command.targetId,
            payload.confirmExpensiveModel === true,
          );
          if (result.ok === false && result.confirm_required === true)
            throw new ModelConfirmationRequiredError(
              optionalString(result.confirm_message) ?? 'Expensive model confirmation is required',
            );
          return { selected: result.ok !== false, providerId, modelId: command.targetId };
        }
        case 'provider.credential.set': {
          const setup = record(payload.setup);
          const values: Record<string, string> = {};
          for (const [key, value] of Object.entries(setup)) {
            if (
              !/^[a-z][A-Za-z0-9]{0,99}$/u.test(key) ||
              typeof value !== 'string' ||
              value.length > 32_768
            )
              throw new SourceUnavailableError('Provider setup contains an invalid field');
            values[key] = value;
          }
          if (!Object.keys(values).length)
            values.credential = payloadString(payload, 'credential', 32_768);
          return await this.management.setProviderSetup(command.targetId, values);
        }
        case 'provider.credential.remove':
          return await this.management.removeCredential(command.targetId);
        case 'provider.validate': {
          const setup = record(payload.setup);
          const values: Record<string, string> = {};
          for (const [key, value] of Object.entries(setup)) {
            if (
              !/^[a-z][A-Za-z0-9]{0,99}$/u.test(key) ||
              typeof value !== 'string' ||
              value.length > 4096
            )
              throw new SourceUnavailableError('Provider validation contains an invalid field');
            values[key] = value;
          }
          const persisted = await this.management.readProviderSetup(command.targetId);
          const merged: Record<string, string> = { ...persisted, ...values };
          if (['bedrock', 'vertex', 'copilot-acp'].includes(command.targetId))
            return await this.management.validateProviderIdentity(command.targetId, merged);
          if (['custom', 'lmstudio', 'moa'].includes(command.targetId))
            return await this.management.validateSpecialProvider(command.targetId, merged);
          return await this.management.validateProviderIdentity(command.targetId, values);
        }
        case 'provider.models.refresh':
          return await this.management.refreshProviderModels(command.targetId);
        case 'provider.persistence.verify':
          return await this.management.verifyPersistence(command.targetId);
        case 'provider.oauth.start':
          return await this.management.oauthStart(command.targetId);
        case 'provider.oauth.reconnect': {
          await this.management.oauthDisconnect(command.targetId);
          return await this.management.oauthStart(command.targetId);
        }
        case 'provider.oauth.status':
          return await this.management.oauthStatus(
            command.targetId,
            optionalString(payload.sessionId),
          );
        case 'provider.oauth.disconnect':
          return await this.management.oauthDisconnect(command.targetId);
        case 'provider.inference.test': {
          const provider = (await this.providers(true)).items.find(
            (item) => item.id === command.targetId,
          );
          if (!provider || provider.credentialStatus !== 'configured')
            throw new SourceUnavailableError('Provider is not configured');
          const models = (await this.models(true)).items.filter(
            (item) => item.providerId === command.targetId,
          );
          const modelId =
            optionalString(payload.modelId) ?? models.find((item) => item.selected)?.id;
          if (!modelId)
            throw new SourceUnavailableError(
              'No selected model is available for inference testing',
            );
          const created = await this.executeConversation({
            ...command,
            operation: 'session.create',
            targetId: 'provider-inference-smoke',
            payload: {
              title: `Provider smoke test: ${command.targetId}`,
              model: `${command.targetId}/${modelId}`,
            },
          });
          const session = record(created.session);
          const sessionId = requiredString(session.id ?? session.session_id, 'session id');
          const startedAt = Date.now();
          const sent = await this.executeConversation({
            ...command,
            operation: 'message.send',
            targetId: sessionId,
            payload: { message: 'Reply with exactly OK.' },
          });
          const immediate = record(sent.message);
          const assistant = isVerifiedAssistantInferenceMessage(immediate)
            ? immediate
            : await this.awaitAssistantInferenceMessage(sessionId);
          const content = assistantMessageContent(assistant);
          if (!content)
            throw new SourceUnavailableError(
              'Hermes did not return a verified assistant inference response',
            );
          return {
            providerId: command.targetId,
            modelId,
            succeeded: true,
            sessionId,
            latencyMs: Date.now() - startedAt,
            responseDigest: createHash('sha256').update(content).digest('hex'),
          };
        }
      }
      throw new SourceUnavailableError('Hermes model-management operation is unsupported');
    } catch (error) {
      if (error instanceof HermesManagementError) throw new SourceUnavailableError(error.message);
      throw error;
    }
  }

  async projects(): Promise<Snapshot<HermesProject>> {
    const output = stripAnsi(await this.options.runner.run(['project', 'list', '--all']));
    const summaries = output
      .split('\n')
      .map((line) => line.trim())
      .map((line) => {
        const match =
          /^([a-z0-9][a-z0-9._-]*)\s+(.+?)\s+\[(\d+) folder\(s\)\](?:\s+\[archived\])?$/i.exec(
            line,
          );
        return match
          ? { id: match[1]!, name: match[2]!, archived: line.includes('[archived]') }
          : null;
      })
      .filter((item): item is { id: string; name: string; archived: boolean } => Boolean(item));
    const items: HermesProject[] = [];
    for (const summary of summaries) {
      const detail = stripAnsi(await this.options.runner.run(['project', 'show', summary.id]));
      const description = /^\s*about:\s*(.*)$/m.exec(detail)?.[1]?.trim();
      const boardId = /^\s*board:\s*(\S+)$/m.exec(detail)?.[1]?.trim();
      items.push({
        id: summary.id,
        name: /^\s*name:\s*(.*)$/m.exec(detail)?.[1]?.trim() || summary.name,
        archived: summary.archived,
        ...(description ? { description } : {}),
        ...(boardId ? { boardId } : {}),
      });
    }
    return snapshot(items);
  }

  async boards(): Promise<Snapshot<HermesBoard>> {
    const raw = JSON.parse(
      await this.options.runner.run(['kanban', 'boards', 'list', '--json', '--all']),
    ) as unknown;
    if (!Array.isArray(raw)) throw new Error('Hermes boards output was not an array');
    const items = raw.map((value) => {
      const row = record(value);
      const board: HermesBoard = {
        id: requiredString(row.slug, 'board slug'),
        name: requiredString(row.name ?? row.slug, 'board name'),
        archived: Boolean(row.archived),
        isCurrent: Boolean(row.is_current),
        counts: integerRecord(row.counts),
        total: nonNegativeInteger(row.total),
      };
      const updatedAt = dateString(row.updated_at);
      if (updatedAt) board.updatedAt = updatedAt;
      return board;
    });
    return snapshot(items);
  }

  async tasks(boardId: string): Promise<Snapshot<HermesTask>> {
    assertNativeId(boardId);
    const raw = JSON.parse(
      await this.options.runner.run([
        'kanban',
        '--board',
        boardId,
        'list',
        '--json',
        '--archived',
        '--sort',
        'updated',
      ]),
    ) as unknown;
    if (!Array.isArray(raw)) throw new Error('Hermes tasks output was not an array');
    const items = raw.map((value) => {
      const row = record(value);
      const task: HermesTask = {
        id: requiredString(row.id, 'task id'),
        boardId,
        title: requiredString(row.title, 'task title'),
        status: requiredString(row.status, 'task status'),
      };
      assignOptional(task, 'body', optionalString(row.body));
      const assignee = optionalString(row.assignee);
      if (assignee) task.assignee = assignee;
      if (Number.isInteger(row.priority)) task.priority = Number(row.priority);
      const updatedAt = dateString(row.updated_at);
      if (updatedAt) task.updatedAt = updatedAt;
      return task;
    });
    return snapshot(items);
  }

  async cronjobs(): Promise<Snapshot<HermesCronjob>> {
    const output = stripAnsi(await this.options.runner.run(['cron', 'list', '--all']));
    const items: HermesCronjob[] = [];
    let current: Partial<HermesCronjob> | undefined;
    for (const rawLine of output.split('\n')) {
      const line = rawLine.trim();
      const header = /^([a-zA-Z0-9._-]+) \[(active|paused|completed|disabled|failed)\]$/.exec(line);
      if (header) {
        if (current?.id && current.name && current.schedule && current.status)
          items.push({ ...current, deliver: current.deliver ?? [] } as HermesCronjob);
        current = { id: header[1]!, status: header[2]! as HermesCronjob['status'] };
        continue;
      }
      if (!current) continue;
      const field = /^([^:]+):\s*(.*)$/.exec(line);
      if (!field) continue;
      const key = field[1]?.trim();
      const value = field[2]?.trim() ?? '';
      if (key === 'Name') current.name = value;
      else if (key === 'Schedule') current.schedule = value;
      else if (key === 'Next run') assignOptional(current, 'nextRunAt', dateString(value));
      else if (key === 'Last run') {
        const [at, result] = value.split(/\s{2,}/);
        assignOptional(current, 'lastRunAt', dateString(at));
        if (result) current.lastResult = result.slice(0, 100);
      } else if (key === 'Deliver')
        current.deliver = value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
    }
    if (current?.id && current.name && current.schedule && current.status)
      items.push({ ...current, deliver: current.deliver ?? [] } as HermesCronjob);
    return snapshot(items);
  }

  async executeWork(command: HermesWorkCommand): Promise<Record<string, unknown>> {
    assertNativeId(command.targetId);
    const payload = record(command.payload);
    switch (command.operation) {
      case 'project.create': {
        const name = payloadString(payload, 'name', 500);
        const description = optionalPayloadString(payload, 'description', 1_000_000);
        const existing = (await this.projects()).items.find((item) => item.id === command.targetId);
        if (existing) {
          if (existing.name !== name || (description && existing.description !== description))
            throw new Error('Hermes project identifier already exists with different content');
        } else {
          await this.options.runner.run([
            'project',
            'create',
            name,
            '--slug',
            command.targetId,
            ...(description ? ['--description', description] : []),
          ]);
        }
        const board = (await this.boards()).items.find((item) => item.id === command.targetId);
        if (!board) await this.options.runner.run(['kanban', 'boards', 'create', command.targetId]);
        await this.options.runner.run([
          'project',
          'bind-board',
          command.targetId,
          command.targetId,
        ]);
        let planningTask: Record<string, unknown> | undefined;
        if (payload.startPmPlanning === true) {
          const pm = payloadString(payload, 'projectManager', 200);
          const agents = Array.isArray(payload.agents)
            ? payload.agents.map(String).filter(Boolean).slice(0, 50)
            : [];
          const body = [
            description ?? '',
            agents.length ? `Project agents: ${agents.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          planningTask = await this.createTask(
            command.targetId,
            `Plan ${name}`,
            body,
            pm,
            90,
            command.idempotencyKey,
          );
          const planningTaskId = payloadString(planningTask, 'id', 300);
          await this.options.runner.run([
            'kanban',
            '--board',
            command.targetId,
            'promote',
            planningTaskId,
            'Activated by UNIFY Save and Start',
          ]);
          planningTask.status = 'ready';
        }
        return {
          project: { id: command.targetId, name },
          ...(planningTask ? { planningTask } : {}),
        };
      }
      case 'project.rename': {
        const name = payloadString(payload, 'name', 500);
        await this.options.runner.run(['project', 'rename', command.targetId, name]);
        return { project: { id: command.targetId, name } };
      }
      case 'project.archive':
        await this.options.runner.run(['project', 'archive', command.targetId]);
        return { project: { id: command.targetId, archived: true } };
      case 'task.create': {
        const boardId = payloadString(payload, 'boardId', 200);
        assertNativeId(boardId);
        return {
          task: await this.createTask(
            boardId,
            payloadString(payload, 'title', 2000),
            optionalPayloadString(payload, 'body', 1_000_000) ?? '',
            optionalPayloadString(payload, 'assignee', 200),
            priorityNumber(payload.priority),
            command.idempotencyKey,
            payload.triage === true,
          ),
        };
      }
      case 'task.start': {
        const boardId = payloadString(payload, 'boardId', 200);
        assertNativeId(boardId);
        const current = (await this.tasks(boardId)).items.find(
          (task) => task.id === command.targetId,
        );
        if (!current) throw new Error('Hermes task does not exist');
        if (current.status === 'ready' || current.status === 'running') return { task: current };
        if (current.status !== 'todo' && current.status !== 'blocked')
          throw new Error(`Hermes task cannot start from '${current.status}'`);
        await this.options.runner.run([
          'kanban',
          '--board',
          boardId,
          'promote',
          command.targetId,
          'Promoted to ready from UNIFY',
        ]);
        return { task: { id: command.targetId, status: 'ready' } };
      }
      case 'task.block':
        await this.options.runner.run([
          'kanban',
          '--board',
          payloadString(payload, 'boardId', 200),
          'block',
          command.targetId,
          optionalPayloadString(payload, 'reason', 2000) ?? 'Blocked from UNIFY',
        ]);
        return { task: { id: command.targetId, status: 'blocked' } };
      case 'task.unblock':
        await this.options.runner.run([
          'kanban',
          '--board',
          payloadString(payload, 'boardId', 200),
          'unblock',
          command.targetId,
        ]);
        return { task: { id: command.targetId, status: 'ready' } };
      case 'task.complete':
        await this.options.runner.run([
          'kanban',
          '--board',
          payloadString(payload, 'boardId', 200),
          'complete',
          command.targetId,
          '--result',
          optionalPayloadString(payload, 'result', 20_000) ?? 'Completed from UNIFY',
        ]);
        return { task: { id: command.targetId, status: 'done' } };
      case 'cron.create': {
        const name = payloadString(payload, 'name', 500);
        const schedule = payloadString(payload, 'schedule', 500);
        const prior = (await this.cronjobs()).items.find((item) => item.name === name);
        if (prior) {
          if (prior.schedule !== normalizeCronSchedule(schedule))
            throw new Error('Hermes cron name already exists with a different schedule');
          return { cronjob: prior };
        }
        const output = await this.options.runner.run([
          'cron',
          'create',
          schedule,
          payloadString(payload, 'prompt', 1_000_000),
          '--name',
          name,
          '--deliver',
          optionalPayloadString(payload, 'deliver', 500) ?? 'local',
        ]);
        const id = /Created job:\s*(\S+)/.exec(stripAnsi(output))?.[1];
        if (!id) throw new Error('Hermes cron create did not return a job identifier');
        return {
          cronjob: { id, name, schedule: normalizeCronSchedule(schedule), status: 'active' },
        };
      }
      case 'cron.run':
      case 'cron.pause':
      case 'cron.resume':
      case 'cron.delete': {
        const action =
          command.operation.slice(5) === 'delete' ? 'remove' : command.operation.slice(5);
        const prior = (await this.cronjobs()).items.find((item) => item.id === command.targetId);
        if (!prior && action === 'remove')
          return { cronjob: { id: command.targetId, deleted: true } };
        if (!prior) throw new Error('Hermes cron job does not exist');
        if (
          (action === 'pause' && prior.status === 'paused') ||
          (action === 'resume' && prior.status === 'active')
        )
          return { cronjob: prior };
        await this.options.runner.run(['cron', action, command.targetId]);
        return { cronjob: { id: command.targetId, action } };
      }
    }
    throw new Error('Unsupported Hermes work operation');
  }

  private async createTask(
    boardId: string,
    title: string,
    body: string,
    assignee: string | undefined,
    priority: number,
    idempotencyKey: string,
    triage = false,
  ) {
    const output = await this.options.runner.run([
      'kanban',
      '--board',
      boardId,
      'create',
      title,
      ...(body ? ['--body', body] : []),
      ...(assignee ? ['--assignee', assignee] : []),
      ...(triage ? ['--triage'] : []),
      '--priority',
      String(priority),
      '--idempotency-key',
      idempotencyKey,
      '--json',
    ]);
    return record(JSON.parse(output));
  }

  async sessions(): Promise<Snapshot<HermesSession>> {
    const body = await this.api('/api/sessions');
    const rows = arrayFrom(body, ['sessions', 'items', 'data']);
    const items = rows.filter(isInternalSession).map((value) => {
      const row = record(value);
      const item: HermesSession = { id: requiredString(row.id ?? row.session_id, 'session id') };
      assignOptional(item, 'title', optionalString(row.title ?? row.name));
      assignOptional(item, 'source', optionalString(row.source ?? row.platform));
      assignOptional(item, 'createdAt', dateString(row.created_at ?? row.createdAt));
      assignOptional(item, 'updatedAt', dateString(row.updated_at ?? row.updatedAt));
      return item;
    });
    return snapshot(items);
  }

  async messages(sessionId: string): Promise<Snapshot<HermesMessage>> {
    assertNativeId(sessionId);
    const sessionBody = record(await this.api(`/api/sessions/${encodeURIComponent(sessionId)}`));
    const session = record(sessionBody.session ?? sessionBody.data ?? sessionBody);
    if (!isInternalSession(session))
      throw new SecondConsumerForbiddenError('External-channel sessions are excluded from UNIFY');
    const body = await this.api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
    const rows = arrayFrom(body, ['messages', 'items', 'data']);
    const items = rows.map((value, index) => {
      const row = record(value);
      const item: HermesMessage = {
        id: optionalString(row.id ?? row.message_id) ?? `${sessionId}:${index}`,
        sessionId,
        role: optionalString(row.role) ?? 'unknown',
      };
      assignOptional(item, 'content', safeContent(row.content));
      assignOptional(item, 'createdAt', dateString(row.created_at ?? row.createdAt));
      return item;
    });
    return snapshot(items);
  }

  async executeConversation(command: HermesConversationCommand): Promise<Record<string, unknown>> {
    if (command.operation === 'session.create') {
      const title = requiredString(command.payload.title, 'session title');
      const model = optionalString(command.payload.model);
      const profileId = optionalString(command.payload.profileId);
      const result = record(
        await this.api('/api/sessions', 'POST', {
          title,
          ...(model ? { model } : {}),
          ...(profileId ? { profile: profileId } : {}),
        }),
      );
      const session = record(result.session);
      if (!isInternalSession(session))
        throw new SecondConsumerForbiddenError('Hermes created a non-internal session');
      return { session };
    }

    const sessionBody = record(
      await this.api(`/api/sessions/${encodeURIComponent(command.targetId)}`),
    );
    const session = record(sessionBody.session ?? sessionBody.data ?? sessionBody);
    if (!isInternalSession(session))
      throw new SecondConsumerForbiddenError('External-channel sessions are excluded from UNIFY');
    const message = command.payload.message;
    if (
      (typeof message !== 'string' || !message.trim()) &&
      (!Array.isArray(message) || message.length === 0)
    )
      throw new Error('Conversation message is required');
    const result = record(
      await this.api(`/api/sessions/${encodeURIComponent(command.targetId)}/chat`, 'POST', {
        message,
      }),
    );
    return {
      sessionId: requiredString(result.session_id ?? command.targetId, 'session id'),
      message: record(result.message),
    };
  }

  private async awaitAssistantInferenceMessage(sessionId: string) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const raw = record(await this.api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`));
      const messages = Array.isArray(raw.data) ? raw.data : [];
      const assistant = [...messages]
        .reverse()
        .map((item) => record(item))
        .find(isVerifiedAssistantInferenceMessage);
      if (assistant) return assistant;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new SourceUnavailableError('Hermes inference timed out without an assistant response');
  }

  async health() {
    const checks: Record<string, 'healthy' | 'degraded' | 'unavailable'> = {};
    try {
      await this.options.runner.run(['version']);
      checks.cli = 'healthy';
    } catch {
      checks.cli = 'unavailable';
    }
    if (this.management) {
      try {
        await this.management.inventory(false);
        checks.management = 'healthy';
      } catch {
        checks.management = 'unavailable';
      }
    } else checks.management = 'degraded';
    if (!this.apiBaseUrl) checks.conversations = 'degraded';
    else {
      try {
        await this.api('/health');
        checks.conversations = 'healthy';
      } catch {
        checks.conversations = 'unavailable';
      }
    }
    return checks;
  }

  private async api(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
    if (!this.apiBaseUrl) throw new SourceUnavailableError('Hermes API is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), method === 'POST' ? 180_000 : 5_000);
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.options.apiToken ? { authorization: `Bearer ${this.options.apiToken}` } : {}),
        },
        signal: controller.signal,
        redirect: 'error',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new SourceUnavailableError(`Hermes API returned HTTP ${response.status}`);
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof SourceUnavailableError) throw error;
      throw new SourceUnavailableError('Hermes API is unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}

export class SourceUnavailableError extends Error {}
export class SourceConflictError extends Error {}
export class SecondConsumerForbiddenError extends Error {}
export class ModelConfirmationRequiredError extends Error {}

function mapManagementProvider(
  raw: Record<string, unknown>,
  selectedProvider: string,
): HermesProvider {
  const id = optionalString(raw.slug ?? raw.provider) ?? 'unknown';
  const authenticated = raw.authenticated === true || raw.configured === true;
  const modelCount = Array.isArray(raw.models)
    ? raw.models.length
    : Number.isInteger(raw.total_models)
      ? Number(raw.total_models)
      : 0;
  const selected = id.toLowerCase() === selectedProvider.toLowerCase();
  const rawPrerequisites = raw.prerequisites;
  const prerequisiteStatuses = Object.fromEntries(
    Object.entries(
      rawPrerequisites && typeof rawPrerequisites === 'object' && !Array.isArray(rawPrerequisites)
        ? (rawPrerequisites as Record<string, unknown>)
        : {},
    )
      .filter(([, value]) => ['satisfied', 'missing', 'unknown'].includes(String(value)))
      .map(([key, value]) => [key, String(value) as 'satisfied' | 'missing' | 'unknown']),
  );
  const contract = truthfulProviderContract({
    id,
    authenticated,
    selected,
    modelCount,
    prerequisiteStatuses,
  });
  return {
    id,
    displayName: optionalString(raw.name ?? raw.label) ?? id,
    credentialStatus: authenticated || contract.authMethod === 'none' ? 'configured' : 'missing',
    selected,
    ...contract,
    modelCount,
  };
}

const INTERNAL_SESSION_SOURCES = new Set(['api_server', 'cli', 'tui', 'terminal', 'acp', 'local']);

function isInternalSession(value: unknown) {
  const row = record(value);
  const source = optionalString(row.source ?? row.platform);
  return source !== undefined && INTERNAL_SESSION_SOURCES.has(source);
}

export function validateBaseProfileDisplayName(value: string | undefined): string {
  const displayName = value?.trim() || 'Default';
  const hasControlCharacter = [...displayName].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (displayName.length > 100 || hasControlCharacter)
    throw new Error('Base profile display name is invalid');
  return displayName;
}

export function validateApiBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('HERMES_API_BASE_URL is invalid');
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !loopback))
    throw new Error('HERMES_API_BASE_URL requires HTTPS except on loopback');
  if (
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  )
    throw new Error('HERMES_API_BASE_URL cannot contain credentials, a path, query, or fragment');
  return url.origin;
}

export function sourceVersion(value: unknown) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function snapshot<T>(items: T[]): Snapshot<T> {
  return { items, sourceVersion: sourceVersion(items) };
}

function stripAnsi(value: string) {
  return value.replace(ansi, '');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function assistantMessageContent(message: Record<string, unknown>) {
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const row = recordOrEmpty(block);
      return typeof row.text === 'string' ? row.text.trim() : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function isVerifiedAssistantInferenceMessage(message: Record<string, unknown>) {
  const role = optionalString(message.role ?? message.author ?? message.sender)?.toLowerCase();
  return (role === 'assistant' || role === 'agent') && assistantMessageContent(message).length > 0;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object');
  return value as Record<string, unknown>;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayFrom(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const row = record(value);
  for (const key of keys) if (Array.isArray(row[key])) return row[key] as unknown[];
  throw new Error('Hermes API collection response was malformed');
}

function requiredString(value: unknown, field: string) {
  const result = optionalString(value);
  if (!result) throw new Error(`Missing ${field}`);
  return result;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function dateString(value: unknown) {
  const text = optionalString(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function integerRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, count]) => Number.isInteger(count) && Number(count) >= 0),
  ) as Record<string, number>;
}

function nonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function payloadString(row: Record<string, unknown>, key: string, maxLength: number) {
  const value = optionalPayloadString(row, key, maxLength);
  if (!value) throw new Error(`Hermes work payload ${key} is required`);
  return value;
}

function optionalPayloadString(row: Record<string, unknown>, key: string, maxLength: number) {
  const value = row[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
    throw new Error(`Hermes work payload ${key} is invalid`);
  return value.trim();
}

function priorityNumber(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value))
    return Math.min(100, Math.max(0, value));
  return value === 'urgent' ? 100 : value === 'high' ? 75 : value === 'low' ? 25 : 50;
}

function normalizeCronSchedule(value: string) {
  const match = /^every\s+(\d+)\s*([mhd])$/i.exec(value.trim());
  if (!match) return value.trim();
  const count = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const minutes = unit === 'd' ? count * 1440 : unit === 'h' ? count * 60 : count;
  return `every ${minutes}m`;
}

function providerId(value: string) {
  const normalized = slug(value);
  const aliases: Record<string, string> = {
    'z-ai-glm': 'zai',
    'kimi-moonshot': 'kimi',
    'stepfun-step-plan': 'stepfun',
    'minimax-china': 'minimax-cn',
  };
  return aliases[normalized] ?? normalized;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertNativeId(value: string) {
  if (!/^[a-zA-Z0-9._:-]{1,300}$/.test(value)) throw new Error('Invalid native identifier');
}

function safeContent(value: unknown) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const texts = value
    .map((part) =>
      part && typeof part === 'object' ? optionalString(record(part).text) : undefined,
    )
    .filter((part): part is string => Boolean(part));
  return texts.length ? texts.join('\n') : undefined;
}

function assignOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
) {
  if (value !== undefined) target[key] = value;
}
