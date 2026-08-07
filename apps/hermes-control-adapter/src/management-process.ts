import { spawn, type ChildProcess } from 'node:child_process';

export async function startPrivateHermesManagement(
  binary: string,
  baseUrl: string,
  sessionToken: string,
  home?: string,
): Promise<ChildProcess> {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Autostarted Hermes management must bind to loopback HTTP');
  const child = spawn(
    binary,
    ['dashboard', '--host', '127.0.0.1', '--port', url.port || '80', '--skip-build', '--no-open'],
    {
      env: {
        ...process.env,
        HERMES_DASHBOARD_SESSION_TOKEN: sessionToken,
        ...(home ? { HERMES_HOME: home } : {}),
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  let exited: Error | undefined;
  child.once('exit', (code, signal) => {
    exited = new Error(`Hermes management process exited (${code ?? signal ?? 'unknown'})`);
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) throw exited;
    try {
      const response = await fetch(`${url.origin}/api/model/options?include_unconfigured=true`, {
        headers: { 'x-hermes-session-token': sessionToken },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return child;
    } catch {
      // Keep waiting until the bounded startup deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error('Hermes management process did not become ready within 60 seconds');
}
