import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  mkdtemp,
  open,
  mkdir,
  readFile,
  writeFile,
  symlink,
  link,
  lstat,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectSetupStore } from './project-setup.js';
import { WorkspaceFiles, MAX_UPLOAD } from './workspace-files.js';
let home: string, root: string, store: WorkspaceFiles;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-files-qa-'));
  root = join(home, 'workspace');
  await mkdir(root);
  store = new WorkspaceFiles(new ProjectSetupStore(home, [root]));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});
const payload = (text: Buffer | string, name = 'notes.txt') => {
  const bytes = Buffer.from(text);
  return {
    directory: root,
    name,
    confirmed: true,
    contentBase64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
describe('workspace file store on real disposable filesystem', () => {
  it('creates and browses a selectable workspace without any execution', async () => {
    await store.perform('mkdir', { directory: root, name: 'project' });
    const rows = await store.perform('list', { directory: root });
    expect(rows.items).toEqual([expect.objectContaining({ name: 'project', kind: 'directory' })]);
    expect(await store.perform('list', { directory: join(root, 'project') })).toMatchObject({
      selectable: true,
      root,
    });
  });
  it('uploads verified bytes with no executable bits or leaked temporary files', async () => {
    const result = await store.perform('upload', payload('hello'));
    expect(result).toMatchObject({ saved: true, sha256: payload('hello').sha256 });
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('hello');
    expect((await lstat(join(root, 'notes.txt'))).mode & 0o777).toBe(0o600);
    expect(await readdir(root)).toEqual(['notes.txt']);
  });
  it('requires exact version and retains the original when explicitly overwriting', async () => {
    const first = await store.perform('upload', payload('original'));
    await expect(store.perform('upload', payload('replacement'))).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      store.perform('upload', { ...payload('replacement'), overwrite: true }),
    ).rejects.toMatchObject({ statusCode: 428 });
    await expect(
      store.perform('upload', {
        ...payload('replacement'),
        overwrite: true,
        expectedVersion: 'old',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await store.perform('upload', {
      ...payload('replacement'),
      overwrite: true,
      expectedVersion: first.version,
    });
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('replacement');
    const versions = await readdir(join(root, '.dsh-file-versions'));
    expect(versions).toHaveLength(1);
    expect(await readFile(join(root, '.dsh-file-versions', versions[0]!), 'utf8')).toBe('original');
    expect((await store.perform('list', { directory: root })).items).toEqual([
      expect.objectContaining({ name: 'notes.txt' }),
    ]);
  });
  it('serializes competing creates without losing either existing file', async () => {
    const results = await Promise.allSettled([
      store.perform('upload', payload('one')),
      store.perform('upload', payload('two')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('one');
  });
  it('accepts the full advertised size and rejects oversized input', async () => {
    const bytes = Buffer.alloc(MAX_UPLOAD, 42);
    expect(await store.perform('upload', payload(bytes))).toMatchObject({
      size: MAX_UPLOAD,
      saved: true,
    });
    await expect(
      store.perform('upload', payload(Buffer.alloc(MAX_UPLOAD + 1))),
    ).rejects.toMatchObject({ statusCode: 413 });
  });
  it('removes temporary data when disk writing fails', async () => {
    const handle = await open(join(root, 'prototype-probe'), 'w');
    const prototype = Object.getPrototypeOf(handle);
    await handle.close();
    const fault = vi
      .spyOn(prototype, 'writeFile')
      .mockRejectedValue(Object.assign(new Error('Injected disk failure'), { code: 'EIO' }));
    try {
      await expect(store.perform('upload', payload(Buffer.from('test')))).rejects.toMatchObject({
        statusCode: 503,
      });
      expect((await readdir(root)).filter((n) => n.startsWith('.dsh-upload-'))).toEqual([]);
    } finally {
      fault.mockRestore();
    }
  });
  it('rejects checksum mismatch without creating a file', async () => {
    await expect(
      store.perform('upload', { ...payload('hello'), sha256: 'bad' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await readdir(root)).toEqual([]);
  });
  it.each(['../outside', 'a/b', 'a\\b', '.env', '..', 'bad\0name'])(
    'rejects unsafe name %s',
    async (name) => {
      await expect(store.perform('upload', payload('x', name))).rejects.toMatchObject({
        statusCode: 400,
      });
    },
  );
  it('rejects directory traversal and an unapproved directory', async () => {
    await expect(store.perform('list', { directory: home })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      store.perform('list', { directory: root + '/../workspace' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it('never follows directory or target symlinks', async () => {
    const outside = join(home, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret'), 'protected');
    await symlink(outside, join(root, 'escape'));
    await expect(store.perform('list', { directory: join(root, 'escape') })).rejects.toMatchObject({
      statusCode: 403,
    });
    await symlink(join(outside, 'secret'), join(root, 'notes.txt'));
    await expect(store.perform('upload', payload('attack'))).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      store.perform('read', { directory: root, name: 'notes.txt', expectedVersion: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('protected');
  });
  it('rejects hard-linked targets and symlinked version storage', async () => {
    await writeFile(join(home, 'other'), 'original');
    await link(join(home, 'other'), join(root, 'notes.txt'));
    await expect(
      store.perform('upload', { ...payload('new'), overwrite: true, expectedVersion: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await rm(join(root, 'notes.txt'));
    const row = await store.perform('upload', payload('hello'));
    await symlink(home, join(root, '.dsh-file-versions'));
    await expect(
      store.perform('upload', { ...payload('new'), overwrite: true, expectedVersion: row.version }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('hello');
  });
  it('reads only the selected version of bounded UTF-8 text for optional memory', async () => {
    const row = await store.perform('upload', payload('document'));
    expect(
      await store.perform('read', {
        directory: root,
        name: 'notes.txt',
        expectedVersion: row.version,
      }),
    ).toMatchObject({ text: 'document', sha256: row.sha256 });
    await writeFile(join(root, 'notes.txt'), 'changed');
    await expect(
      store.perform('read', { directory: root, name: 'notes.txt', expectedVersion: row.version }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('does not interpret uploaded archives or binary files', async () => {
    const row = await store.perform('upload', payload(Buffer.from([0, 1, 2, 3]), 'data.zip'));
    expect(await readdir(root)).toEqual(['data.zip']);
    await expect(
      store.perform('read', { directory: root, name: 'data.zip', expectedVersion: row.version }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
