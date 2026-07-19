export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  status: 'active' | 'disabled' | 'locked';
}
export interface PrincipalRecord {
  userId: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}
export interface SessionRecord extends PrincipalRecord {
  sessionId: string;
  csrfHash: string;
  expiresAt: Date;
}
export interface SessionSummary {
  id: string;
  userId: string;
  deviceLabel: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface LoginThrottle {
  failedCount: number;
  blockedUntil: Date | null;
}
export interface NewSession {
  userId: string;
  tokenHash: string;
  csrfHash: string;
  deviceLabel: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  expiresAt: Date;
}
export interface AuthStore {
  ready(): Promise<boolean>;
  findUserByUsername(username: string): Promise<UserRecord | null>;
  getPrincipal(userId: string): Promise<PrincipalRecord | null>;
  getLoginThrottle(subjectHash: string): Promise<LoginThrottle | null>;
  recordLoginFailure(subjectHash: string, blockedUntil: Date | null): Promise<void>;
  clearLoginFailures(subjectHash: string): Promise<void>;
  createSession(session: NewSession): Promise<string>;
  findActiveSession(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  listSessions(userId: string): Promise<SessionSummary[]>;
  revokeSession(sessionId: string, reason: string, now: Date): Promise<boolean>;
  touchSession(sessionId: string, now: Date): Promise<void>;
}
