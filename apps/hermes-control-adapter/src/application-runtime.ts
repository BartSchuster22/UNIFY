import { spawn } from 'node:child_process';
import { isAbsolute, dirname } from 'node:path';

export type ApplicationAction = 'execute' | 'lookup' | 'cancel' | 'erase';
export interface ApplicationScope {
  receiptId: string; applicationId: string; projectId: string; subject: string;
}
export interface ApplicationEvidence {
  url: string; retrievedAt: string; sha256: string; excerpt: string;
}
export interface ApplicationRequest extends ApplicationScope {
  payload?: {
    contractVersion: 'alica-application/v1'; operation: 'answer' | 'research' | 'refresh' | 'correction';
    question: string; subject: string; corrects?: string;
  };
  sourceUrls?: string[];
  knowledge?: (ApplicationEvidence & { quote: string; validated: true; conflicting?: boolean })[];
}
export interface ApplicationResponse {
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'missing';
  reference: (ApplicationScope & { taskId: string; sessionId: string }) | null;
  result?: {
    answer: string; evidence: ApplicationEvidence[];
    findings: { quote: string; sourceIndex: number; validated: boolean; conflicting: boolean }[];
    uncertainty: string; promotion: 'candidate-only'; native: NonNullable<ApplicationResponse['reference']>;
  };
  error?: string;
  cancellation?: { stopAcknowledged: boolean; localSettled: boolean; effectsSettled: boolean };
}
export interface ApplicationRuntimeOptions {
  /** Fixed server configuration, never populated from request payloads. */
  pythonPath: string;
  workerPath: string;
  timeoutMs?: number;
}
const actions = ['execute', 'lookup', 'cancel', 'erase'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const scopeKeys = ['receiptId', 'applicationId', 'projectId', 'subject'] as const;
const MAX_INPUT = 98304;
const MAX_OUTPUT = 131072;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, n: number, empty = false): x is string => typeof x === 'string' && x.length <= n && (empty || x.trim().length > 0) && !x.includes('\0');
function check(ok: unknown): asserts ok { if (!ok) throw new Error('application_runtime_contract_rejected'); }
function keys(x: unknown, required: string[], optional: string[] = []): asserts x is Record<string, unknown> {
  check(record(x) && required.every(k => k in x) && Object.keys(x).every(k => [...required, ...optional].includes(k)));
}
function https(x: unknown): boolean {
  if (!str(x, 2048) || !/^[\x21-\x7e]+$/.test(x)) return false;
  try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443') && /^[a-z0-9.-]+$/i.test(u.hostname) && !u.hostname.endsWith('.'); } catch { return false; }
}
function evidence(x: unknown): asserts x is ApplicationEvidence & Record<string, unknown> {
  check(record(x) && https(x.url) && str(x.retrievedAt, 40) && Number.isFinite(Date.parse(x.retrievedAt)) && /(?:Z|[+-]\d\d:\d\d)$/.test(x.retrievedAt) && typeof x.sha256 === 'string' && /^[0-9a-f]{64}$/.test(x.sha256) && str(x.excerpt, 12000));
}
export function validateApplicationRequest(action: ApplicationAction, value: unknown): asserts value is ApplicationRequest {
  check(actions.includes(action));
  keys(value, [...scopeKeys], ['payload', 'sourceUrls', 'knowledge']);
  check(typeof value.receiptId === 'string' && uuid.test(value.receiptId) && typeof value.applicationId === 'string' && uuid.test(value.applicationId));
  check(typeof value.projectId === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value.projectId));
  check(typeof value.subject === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/.test(value.subject));
  if (action === 'execute' || value.payload !== undefined) {
    const p = value.payload;
    keys(p, ['contractVersion', 'operation', 'question', 'subject'], ['corrects']);
    check(p.contractVersion === 'alica-application/v1' && ['answer', 'research', 'refresh', 'correction'].includes(String(p.operation)) && str(p.question, 4000) && p.subject === value.subject);
    check(p.corrects === undefined || (typeof p.corrects === 'string' && uuid.test(p.corrects)));
    check(p.operation !== 'correction' || p.corrects !== undefined);
  }
  if (value.sourceUrls !== undefined) check(Array.isArray(value.sourceUrls) && value.sourceUrls.length <= 4 && new Set(value.sourceUrls).size === value.sourceUrls.length && value.sourceUrls.every(https));
  if (value.knowledge !== undefined) {
    check(Array.isArray(value.knowledge) && value.knowledge.length <= 4);
    for (const k of value.knowledge) {
      keys(k, ['url', 'retrievedAt', 'sha256', 'excerpt', 'quote', 'validated'], ['conflicting']); evidence(k);
      check(k.validated === true && str(k.quote, 2000) && k.excerpt.includes(k.quote) && (k.conflicting === undefined || typeof k.conflicting === 'boolean'));
    }
  }
}
export function validateApplicationResponse(value: unknown, scope: ApplicationScope): asserts value is ApplicationResponse {
  keys(value, ['state', 'reference'], ['result', 'error', 'cancellation']);
  check(['running', 'completed', 'failed', 'cancelled', 'missing'].includes(String(value.state)));
  if (value.reference === null) check(value.state === 'missing' || value.state === 'failed');
  else {
    keys(value.reference, [...scopeKeys, 'taskId', 'sessionId']);
    const ref = value.reference;
    check(scopeKeys.every(k => ref[k] === scope[k]) && str(ref.taskId, 128) && ref.sessionId === `alica-app-${scope.receiptId}`);
  }
  check(value.state !== 'missing' || value.reference === null);
  if (value.error !== undefined) check(typeof value.error === 'string' && /^[a-z0-9_]{1,100}$/.test(value.error));
  if (value.cancellation !== undefined) {
    keys(value.cancellation, ['stopAcknowledged', 'localSettled', 'effectsSettled']);
    check(Object.values(value.cancellation).every(v => typeof v === 'boolean'));
  }
  if (value.state === 'completed') {
    const r = value.result;
    keys(r, ['answer', 'evidence', 'findings', 'uncertainty', 'promotion', 'native']);
    check(value.reference !== null && str(r.answer, 10000) && str(r.uncertainty, 4000, true) && r.promotion === 'candidate-only');
    keys(r.native, [...scopeKeys, 'taskId', 'sessionId']);
    check(Object.entries(r.native).every(([k, v]) => record(value.reference) && value.reference[k] === v));
    check(Array.isArray(r.evidence) && r.evidence.length > 0 && r.evidence.length <= 4);
    for (const e of r.evidence) { keys(e, ['url', 'retrievedAt', 'sha256', 'excerpt']); evidence(e); }
    check(Array.isArray(r.findings) && r.findings.length > 0 && r.findings.length <= 8);
    const sources = r.evidence as ApplicationEvidence[];
    for (const f of r.findings) {
      keys(f, ['quote', 'sourceIndex', 'validated', 'conflicting']);
      check(str(f.quote, 2000) && typeof f.sourceIndex === 'number' && Number.isInteger(f.sourceIndex) && f.sourceIndex >= 0 && f.sourceIndex < sources.length && typeof f.validated === 'boolean' && typeof f.conflicting === 'boolean');
      check(!f.validated || sources[f.sourceIndex]!.excerpt.includes(f.quote));
    }
    const citations = [...r.answer.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]) - 1);
    check(citations.length > 0 && citations.every(i => (r.findings as Record<string, unknown>[]).some(f => f.sourceIndex === i && f.validated === true)));
  } else check(value.result === undefined);
}

export class ApplicationRuntime {
  private readonly options: Required<ApplicationRuntimeOptions>;
  constructor(options: ApplicationRuntimeOptions) {
    check(isAbsolute(options.pythonPath) && isAbsolute(options.workerPath));
    const timeoutMs = options.timeoutMs ?? 180000;
    check(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 180000);
    this.options = { ...options, timeoutMs };
  }
  execute(request: ApplicationRequest): Promise<ApplicationResponse> { return this.run('execute', request); }
  lookup(request: ApplicationScope): Promise<ApplicationResponse> { return this.run('lookup', request); }
  cancel(request: ApplicationScope): Promise<ApplicationResponse> { return this.run('cancel', request); }
  erase(request: ApplicationScope): Promise<ApplicationResponse> { return this.run('erase', request); }
  async run(action: ApplicationAction, request: ApplicationRequest): Promise<ApplicationResponse> {
    validateApplicationRequest(action, request);
    const input = JSON.stringify(request);
    check(Buffer.byteLength(input) <= MAX_INPUT);
    // Freeze correlation against caller mutation while the subprocess is in flight.
    const expectedScope: ApplicationScope = { receiptId: request.receiptId, applicationId: request.applicationId, projectId: request.projectId, subject: request.subject };
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.pythonPath, [this.options.workerPath, action, '--receipt', request.receiptId], {
        shell: false, cwd: dirname(this.options.workerPath), stdio: ['pipe', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let failure: string | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const stop = (reason: string) => {
        if (failure) return;
        failure = reason;
        child.stdin.destroy();
        // Only this ChildProcess, never a caller-supplied/native unverified PID.
        child.kill('SIGTERM');
        escalation = setTimeout(() => child.kill('SIGKILL'), 500);
      };
      // Reserve cleanup grace inside the 180s outer bound.
      const timer = setTimeout(() => stop('application_runtime_timeout_reconcile_native'), Math.max(1, this.options.timeoutMs - 500));
      child.on('error', () => stop('application_runtime_spawn_failed'));
      child.stdin.on('error', () => stop('application_runtime_stdin_failed_reconcile_native'));
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT) stop('application_runtime_output_limit_reconcile_native');
        else if (!failure) chunks.push(chunk);
      });
      child.on('close', (code, sig) => {
        clearTimeout(timer); if (escalation) clearTimeout(escalation);
        if (failure || code !== 0 || sig) { reject(new Error(failure ?? 'application_runtime_exit_failed_reconcile_native')); return; }
        try {
          const out: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          validateApplicationResponse(out, expectedScope);
          resolve(out);
        } catch { reject(new Error('application_runtime_invalid_output_reconcile_native')); }
      });
      child.stdin.end(input);
    });
  }
}
