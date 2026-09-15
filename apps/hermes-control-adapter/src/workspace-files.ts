import { constants } from 'node:fs';
import {
  open,
  realpath,
  readdir,
  mkdir,
  lstat,
  link,
  rename,
  unlink,
  statfs,
  type FileHandle,
} from 'node:fs/promises';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectSetupStore } from './project-setup.js';
export const MAX_UPLOAD = 8 * 1024 * 1024;
export class WorkspaceFileError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (message: string, status = 400): never => {
  throw new WorkspaceFileError(status, message);
};
function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 200 ||
    value.startsWith('.') ||
    /[\x00-\x1f\x7f/\\]/.test(value) ||
    ['node_modules', '__pycache__'].includes(value)
  )
    return fail('Choose a visible file or folder name without path separators');
  return value;
}
function version(s: Awaited<ReturnType<FileHandle['stat']>>) {
  return createHash('sha256')
    .update([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':'))
    .digest('hex');
}
function inRoot(path: string, root: string) {
  const p = relative(root, path);
  return p === '' || (!p.startsWith('..') && !isAbsolute(p));
}
/** Linux dirfd-relative operations: no symlink traversal, no executable uploads, no blind overwrite. */
export class WorkspaceFiles {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly setup: ProjectSetupStore) {}
  async perform(action: string, input: Record<string, unknown>) {
    const work = () => this.run(action, input);
    if (['list', 'read'].includes(action)) return work();
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async directory(
    value: unknown,
  ): Promise<{ handle: FileHandle; path: string; root: string }> {
    if (
      typeof value !== 'string' ||
      !isAbsolute(value) ||
      resolve(value) !== value ||
      value.includes('\0')
    )
      return fail('Choose an approved directory');
    const root = [...this.setup.roots]
      .sort((a, b) => b.length - a.length)
      .find((r) => inRoot(value, r));
    if (!root) return fail('Directory is outside approved workspace roots', 403);
    const segments = relative(root, value).split('/').filter(Boolean);
    if (segments.length > 32) return fail('Directory nesting limit exceeded');
    segments.forEach(name);
    if ((await realpath(root)) !== root)
      return fail('Workspace root must not contain symlinks', 403);
    let handle = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      for (const segment of segments) {
        const next = await open(
          `/proc/self/fd/${handle.fd}/${segment}`,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        await handle.close();
        handle = next;
      }
      if ((await realpath(`/proc/self/fd/${handle.fd}`)) !== value)
        return fail('Directory changed; refresh before continuing', 409);
      return { handle, path: value, root };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  private async run(
    action: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let directory: Awaited<ReturnType<WorkspaceFiles['directory']>> | undefined;
    try {
      directory = await this.directory(input.directory);
      const { handle, path, root } = directory;
      const fdpath = `/proc/self/fd/${handle.fd}`;
      if (action === 'list') {
        const entries = await readdir(fdpath, { withFileTypes: true });
        if (entries.length > 1000)
          return fail('Directory contains too many entries; use a smaller folder', 413);
        const items = [];
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (
            entry.name.startsWith('.') ||
            ['node_modules', '__pycache__'].includes(entry.name) ||
            (!entry.isDirectory() && !entry.isFile())
          )
            continue;
          const stat = await lstat(join(fdpath, entry.name));
          if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) continue;
          items.push({
            name: entry.name,
            kind: stat.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            version: version(stat),
          });
        }
        return {
          directory: path,
          root,
          items,
          selectable: (await this.setup.workspaces()).some((w) => w.path === path),
          maxUploadBytes: MAX_UPLOAD,
        };
      }
      const filename = name(input.name);
      const target = join(fdpath, filename);
      if (action === 'mkdir') {
        await mkdir(target, { mode: 0o700 });
        await handle.sync();
        return { directory: join(path, filename), created: true };
      }
      if (action === 'read') {
        const file = await open(
          target,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const before = await file.stat();
          if (!before.isFile() || before.nlink !== 1 || before.size > 256 * 1024)
            return fail('Project memory accepts regular UTF-8 text files up to 256 KiB');
          if (input.expectedVersion !== version(before))
            return fail('File changed; refresh before adding it to memory', 409);
          const buffer = Buffer.alloc(256 * 1024 + 1);
          let total = 0;
          while (total < buffer.length) {
            const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
            if (!bytesRead) break;
            total += bytesRead;
          }
          if (total > 256 * 1024) return fail('File grew beyond the project memory limit', 413);
          const bytes = buffer.subarray(0, total);
          if (version(await file.stat()) !== version(before))
            return fail('File changed while being read', 409);
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (text.includes('\0')) return fail('Binary files cannot be added to project memory');
          return {
            name: filename,
            directory: path,
            text,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            version: version(before),
          };
        } finally {
          await file.close();
        }
      }
      if (action !== 'upload') return fail('Unsupported workspace action');
      if (
        typeof input.contentBase64 !== 'string' ||
        input.contentBase64.length > Math.ceil(MAX_UPLOAD / 3) * 4 ||
        input.contentBase64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)
      )
        return fail('Invalid upload or file exceeds 8 MiB', 413);
      const bytes = Buffer.from(input.contentBase64, 'base64');
      if (bytes.toString('base64') !== input.contentBase64)
        return fail('Non-canonical upload encoding');
      if (bytes.length > MAX_UPLOAD) return fail('File exceeds 8 MiB', 413);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (input.sha256 !== hash) return fail('Upload checksum mismatch');
      const capacity = await statfs(fdpath);
      if (capacity.bavail * capacity.bsize < bytes.length + 512 * 1024 * 1024)
        return fail('Workspace storage reserve reached; free space before uploading', 507);
      const temporary = join(fdpath, `.dsh-upload-${randomUUID()}`);
      const file = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      let backup: string | undefined;
      try {
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        if (input.overwrite === true) {
          if (input.confirmed !== true || typeof input.expectedVersion !== 'string')
            return fail('Confirm the exact existing file version before overwriting', 428);
          const existing = await lstat(target);
          if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)
            return fail('Only ordinary, non-linked files may be overwritten', 403);
          if (version(existing) !== input.expectedVersion)
            return fail('File changed; refresh and confirm again', 409);
          const archive = join(fdpath, '.dsh-file-versions');
          await mkdir(archive, { mode: 0o700 }).catch((e) => {
            if (e.code !== 'EEXIST') throw e;
          });
          const archived = await open(
            archive,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          );
          try {
            if ((await readdir(`/proc/self/fd/${archived.fd}`)).length >= 256)
              return fail(
                'Retained-version limit reached; archive prior versions before further overwrites',
                507,
              );
            backup = join(`/proc/self/fd/${archived.fd}`, randomUUID());
            // Keep the old file before publishing. A concurrent new file is never replaced.
            await rename(target, backup);
            const saved = await lstat(backup);
            if (
              saved.ino !== existing.ino ||
              saved.size !== existing.size ||
              saved.mtimeMs !== existing.mtimeMs
            ) {
              await link(backup, target).catch(() => undefined);
              return fail(
                'File changed during overwrite; prior data retained in workspace version storage',
                409,
              );
            }
            try {
              await link(temporary, target);
              await archived.sync();
            } catch (error) {
              await link(backup, target).catch(() => undefined);
              throw error;
            }
          } finally {
            await archived.close();
          }
        } else await link(temporary, target);
        await unlink(temporary);
        await handle.sync();
        const saved = await lstat(target);
        return {
          name: filename,
          directory: path,
          size: bytes.length,
          sha256: hash,
          version: version(saved),
          saved: true,
          previousVersionRetained: Boolean(backup),
        };
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST')
        return fail(
          'File or folder already exists; refresh and explicitly confirm an overwrite',
          409,
        );
      if (['ELOOP', 'ENOTDIR', 'EACCES', 'EPERM'].includes(code ?? ''))
        return fail('Directory or file is not an approved accessible target', 403);
      if (code === 'ENOENT') return fail('Directory or file no longer exists', 404);
      return fail('Workspace operation failed; refresh to inspect the current state', 503);
    } finally {
      await directory?.handle.close();
    }
  }
}
