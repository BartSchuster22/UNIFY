import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { AuthError } from './service.js';
export interface ProjectGrant {
  id: string;
  ownerId: string;
  name: string;
  frameworkId: string;
  projectId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface ProjectCredentialStore {
  create(
    ownerId: string,
    name: string,
    frameworkId: string,
    projectId: string,
    hash: string,
    expiresAt: Date,
  ): Promise<ProjectGrant>;
  find(hash: string): Promise<ProjectGrant | null>;
  list(): Promise<ProjectGrant[]>;
  revoke(id: string): Promise<boolean>;
}
export class PostgresProjectCredentialStore implements ProjectCredentialStore {
  constructor(private readonly pool: Pool) {}
  private record(r: Record<string, unknown>): ProjectGrant {
    return {
      id: r.id as string,
      ownerId: r.owner_id as string,
      name: r.name as string,
      frameworkId: r.framework_id as string,
      projectId: r.project_id as string,
      expiresAt: r.expires_at as Date,
      revokedAt: r.revoked_at as Date | null,
    };
  }
  async create(
    ownerId: string,
    name: string,
    frameworkId: string,
    projectId: string,
    hash: string,
    expiresAt: Date,
  ) {
    const r = await this.pool.query(
      'INSERT INTO project_service_credentials(owner_id,name,framework_id,project_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [ownerId, name, frameworkId, projectId, hash, expiresAt],
    );
    return this.record(r.rows[0]);
  }
  async find(hash: string) {
    const r = await this.pool.query(
      'SELECT * FROM project_service_credentials WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',
      [hash],
    );
    return r.rows[0] ? this.record(r.rows[0]) : null;
  }
  async list() {
    const r = await this.pool.query(
      'SELECT * FROM project_service_credentials ORDER BY created_at DESC LIMIT 500',
    );
    return r.rows.map((v) => this.record(v));
  }
  async revoke(id: string) {
    const r = await this.pool.query(
      'UPDATE project_service_credentials SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL',
      [id],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
export class ProjectCredentialService {
  constructor(readonly store: ProjectCredentialStore) {}
  async create(
    ownerId: string,
    name: string,
    frameworkId: string,
    projectId: string,
    ttlSeconds: number,
  ) {
    if (
      !name.trim() ||
      name.length > 100 ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(frameworkId) ||
      !/^[a-zA-Z0-9_.-]{1,200}$/.test(projectId) ||
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 60 ||
      ttlSeconds > 86400
    )
      throw new AuthError('GRANT_INVALID', 400, 'Invalid project credential request');
    const token = 'dshs1_' + randomBytes(32).toString('base64url');
    const grant = await this.store.create(
      ownerId,
      name,
      frameworkId,
      projectId,
      createHash('sha256').update(token).digest('hex'),
      new Date(Date.now() + ttlSeconds * 1000),
    );
    return {
      grant,
      token,
      permission: 'project.read' as const,
      audience: 'dsh-project-api-v1' as const,
    };
  }
  async authorize(header: unknown, frameworkId: string, projectId: string) {
    if (typeof header !== 'string' || !/^Bearer dshs1_[A-Za-z0-9_-]{43}$/.test(header))
      throw new AuthError('SERVICE_AUTH_REQUIRED', 401, 'Project service credential required');
    const grant = await this.store.find(createHash('sha256').update(header.slice(7)).digest('hex'));
    if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now())
      throw new AuthError('SERVICE_AUTH_REQUIRED', 401, 'Project service credential required');
    if (grant.frameworkId !== frameworkId || grant.projectId !== projectId)
      throw new AuthError('PROJECT_SCOPE_DENIED', 403, 'Project scope denied');
    return grant;
  }
}
