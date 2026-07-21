import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  HermesBoard,
  HermesMessage,
  HermesProfile,
  HermesProvider,
  HermesSession,
  HermesTask,
} from '@aquiero/contracts';
import type { AdapterSource, Snapshot } from './types.js';

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
  apiBaseUrl?: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
}

export class HermesNativeSource implements AdapterSource {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string | undefined;

  constructor(private readonly options: HermesNativeSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = options.apiBaseUrl ? validateApiBaseUrl(options.apiBaseUrl) : undefined;
  }

  conversationsConfigured() {
    return Boolean(this.apiBaseUrl);
  }

  async profiles(): Promise<Snapshot<HermesProfile>> {
    const output = stripAnsi(await this.options.runner.run(['profile', 'list']));
    const items = output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[◆ ]?[a-z0-9][a-z0-9_-]*\s{2,}/i.test(line))
      .map((line) => {
        const columns = line
          .replace(/^◆/, '◆ ')
          .trim()
          .split(/\s{2,}/);
        const active = columns[0]?.startsWith('◆') ?? false;
        const id = (columns[0] ?? '').replace(/^◆\s*/, '').trim();
        const gateway = columns[2]?.trim().toLowerCase();
        const profile: HermesProfile = {
          id,
          displayName: id === 'default' ? 'Default' : id,
          active,
          gatewayStatus:
            gateway === 'running' ? 'running' : gateway === 'stopped' ? 'stopped' : 'unknown',
        };
        if (columns[1] && columns[1] !== '—') profile.model = columns[1];
        return profile;
      })
      .filter((item) => item.id.length > 0 && item.id.toLowerCase() !== 'profile');
    return snapshot(items);
  }

  async providers(): Promise<Snapshot<HermesProvider>> {
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
      const id = slug(displayName);
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
        providers.set(slug(selectedName), {
          id: slug(selectedName),
          displayName: selectedName,
          credentialStatus: 'unknown',
          selected: true,
        });
    }
    return snapshot([...providers.values()].sort((a, b) => a.id.localeCompare(b.id)));
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
      const assignee = optionalString(row.assignee);
      if (assignee) task.assignee = assignee;
      if (Number.isInteger(row.priority)) task.priority = Number(row.priority);
      const updatedAt = dateString(row.updated_at);
      if (updatedAt) task.updatedAt = updatedAt;
      return task;
    });
    return snapshot(items);
  }

  async sessions(): Promise<Snapshot<HermesSession>> {
    const body = await this.api('/api/sessions');
    const rows = arrayFrom(body, ['sessions', 'items', 'data']);
    const items = rows.map((value) => {
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

  async health() {
    const checks: Record<string, 'healthy' | 'degraded' | 'unavailable'> = {};
    try {
      await this.options.runner.run(['version']);
      checks.cli = 'healthy';
    } catch {
      checks.cli = 'unavailable';
    }
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

  private async api(path: string) {
    if (!this.apiBaseUrl) throw new SourceUnavailableError('Hermes API is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        headers: {
          accept: 'application/json',
          ...(this.options.apiToken ? { authorization: `Bearer ${this.options.apiToken}` } : {}),
        },
        signal: controller.signal,
        redirect: 'error',
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

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object');
  return value as Record<string, unknown>;
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
