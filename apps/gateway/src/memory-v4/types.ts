export const MEMORY_V4_CONTRACT_VERSION = '1.0.0';

export type MemoryPermission =
  'memory.read' | 'memory.write' | 'memory.promote' | 'memory.admin' | 'audit.read';

export type MemoryRoute = {
  permission: MemoryPermission;
  mutation: boolean;
  injectQueryScope: boolean;
  injectBodyScope: boolean;
};

const reads: Array<[RegExp, MemoryPermission, boolean]> = [
  [/^\/(?:capabilities|schema)$/, 'memory.read', false],
  [/^\/entities(?:\/[^/]+\/[^/]+)?$/, 'memory.read', true],
  [/^\/records(?:\/[^/]+)?$/, 'memory.read', true],
  [/^\/relations$/, 'memory.read', true],
  [/^\/artifacts$/, 'memory.read', true],
  [/^\/context\/[^/]+\/[^/]+$/, 'memory.read', true],
  [/^\/search$/, 'memory.read', true],
  [/^\/review\/findings$/, 'memory.admin', true],
  [/^\/(?:audit\/events|retrieval-events)$/, 'audit.read', true],
  [/^\/usage$/, 'memory.admin', true],
];
const creates = /^\/(?:entities|records|relations|artifacts)$/;
const patches = /^\/(?:entities\/[^/]+\/[^/]+|records\/[^/]+)$/;
const promote = /^\/records\/[^/]+\/promote$/;
const administration =
  /^\/(?:records\/[^/]+\/(?:supersede|transition)|review\/findings\/[^/]+\/resolve)$/;

export function memoryRoute(method: string, path: string): MemoryRoute | null {
  if (!safePath(path)) return null;
  if (method === 'GET') {
    const found = reads.find(([pattern]) => pattern.test(path));
    return found
      ? {
          permission: found[1],
          mutation: false,
          injectQueryScope: found[2],
          injectBodyScope: false,
        }
      : null;
  }
  if (method === 'POST' && path === '/applications/knowledge/scrub')
    return { permission: 'memory.admin', mutation: true, injectQueryScope: false, injectBodyScope: true };
  if (method === 'POST' && creates.test(path))
    return {
      permission: 'memory.write',
      mutation: true,
      injectQueryScope: false,
      injectBodyScope: true,
    };
  if (method === 'PATCH' && patches.test(path))
    return {
      permission: 'memory.write',
      mutation: true,
      injectQueryScope: false,
      injectBodyScope: false,
    };
  if (method === 'POST' && promote.test(path))
    return {
      permission: 'memory.promote',
      mutation: true,
      injectQueryScope: false,
      injectBodyScope: false,
    };
  if (method === 'POST' && administration.test(path))
    return {
      permission: 'memory.admin',
      mutation: true,
      injectQueryScope: false,
      injectBodyScope: false,
    };
  return null;
}

export function validateScopePath(value: string): string {
  if (!value || value.trim() !== value || value.length > 500)
    throw new Error('scope path is invalid');
  if (value === 'global' || value === 'public') return value;
  const parts = value.split('/');
  if (
    parts.some((part) => {
      const separator = part.indexOf(':');
      return (
        separator <= 0 ||
        separator === part.length - 1 ||
        [...part].some((character) => {
          const point = character.codePointAt(0) ?? 0;
          return point <= 31 || point === 127;
        })
      );
    })
  )
    throw new Error('scope path is invalid');
  return value;
}

export function isScopeAllowed(candidate: string, root: string): boolean {
  validateScopePath(candidate);
  validateScopePath(root);
  if (root === 'global') return true;
  if (root === 'public') return candidate === 'public';
  return candidate === root || candidate.startsWith(`${root}/`);
}

function safePath(path: string): boolean {
  if (!path.startsWith('/') || path.length > 1_000 || path.includes('//')) return false;
  return !path.split('/').some((segment) => {
    if (segment === '.' || segment === '..') return true;
    return [...segment].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    });
  });
}
