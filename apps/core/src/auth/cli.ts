import { Pool } from 'pg';
import { authenticationConfigFromEnvironment } from './config.js';
import { AuthenticationService } from './service.js';
import { poolConfigFromEnvironment } from '../database/migrations.js';

if (process.argv[2] !== 'bootstrap-administrator') {
  console.error('Usage: auth-cli bootstrap-administrator');
  process.exitCode = 2;
} else {
  const username = process.env.CORE_AUTH_BOOTSTRAP_USERNAME;
  const displayName = process.env.CORE_AUTH_BOOTSTRAP_DISPLAY_NAME;
  const password = process.env.CORE_AUTH_BOOTSTRAP_PASSWORD;
  const token = process.env.CORE_AUTH_BOOTSTRAP_TOKEN;
  if (!username || !displayName || !password || !token)
    throw new Error(
      'Bootstrap username, display name, password, and token environment variables are required',
    );
  const pool = new Pool(poolConfigFromEnvironment());
  try {
    const service = await AuthenticationService.create(pool, authenticationConfigFromEnvironment());
    const principal = await service.bootstrapAdministrator(
      { token, username, displayName, password },
      { remoteAddress: '127.0.0.1', userAgent: 'unify-core-auth-cli' },
    );
    console.log(
      JSON.stringify({
        bootstrapped: true,
        identityId: principal.id,
        username: principal.username,
      }),
    );
  } finally {
    await pool.end();
  }
}
