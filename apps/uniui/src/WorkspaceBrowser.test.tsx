import { MantineProvider } from '@mantine/core';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { WorkspaceBrowser } from './WorkspaceBrowser';
import { api, apiUpload } from './api';
vi.mock('./api', () => ({ api: vi.fn(), apiUpload: vi.fn() }));
const root = '/safe/workspace';
const apiMock = vi.mocked(api),
  uploadMock = vi.mocked(apiUpload);
let entries: any[], memoryCalls: number;
function setup(extra: any = {}) {
  return render(
    <MantineProvider>
      <WorkspaceBrowser
        inventory={
          {
            frameworkId: 'alpha',
            ready: true,
            workspaces: [{ value: root, label: 'Workspace' }],
            refresh: extra.refresh ?? vi.fn(),
          } as any
        }
        workspace={root}
        disabled={false}
        onSelect={vi.fn()}
        {...extra}
      />
    </MantineProvider>,
  );
}
async function show(extra: any = {}) {
  const view = setup(extra);
  fireEvent.click(screen.getByRole('button', { name: 'Browse / Create workspace · Upload files' }));
  await screen.findByText('inputs');
  return view;
}
function file(name = 'notes.txt', content = 'test') {
  const f = new File([content], name, { type: 'text/plain' });
  Object.defineProperty(f, 'arrayBuffer', {
    value: async () => new Uint8Array(Buffer.from(content)).buffer,
  });
  return f;
}
function selectFile(f: File) {
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [f] } });
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  entries = [{ name: 'inputs', kind: 'directory', size: 0, version: 'dir-v1' }];
  memoryCalls = 0;
  apiMock.mockImplementation(async (path, init) => {
    const body = JSON.parse(init?.body as string);
    if (path.endsWith('/memory')) {
      memoryCalls++;
      return { record: { record_id: 'm1' } } as any;
    }
    if (body.action === 'mkdir') return { directory: root + '/new-folder' } as any;
    return {
      directory: body.directory,
      root,
      items: body.directory === root ? entries : [],
      selectable: true,
      maxUploadBytes: 8388608,
    } as any;
  });
  uploadMock.mockImplementation(async (_path, body, progress) => {
    progress(100);
    return { saved: true, sha256: (body as { sha256: string }).sha256 } as any;
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe('Workspace browser', () => {
  it('requires manage availability before opening', () => {
    setup({ disabled: true });
    expect(
      screen.getByRole('button', { name: 'Browse / Create workspace · Upload files' }),
    ).toBeDisabled();
    expect(apiMock).not.toHaveBeenCalled();
  });
  it('browses folders and only changes selection after explicit confirmation', async () => {
    const change = vi.fn();
    await show({ onSelect: change });
    fireEvent.click(screen.getByRole('button', { name: 'Open inputs' }));
    await screen.findByText(root + '/inputs');
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use this workspace' }));
    expect(change).toHaveBeenCalledWith(root + '/inputs');
  });
  it('creates a folder and refreshes inventory without starting work', async () => {
    const inventory = vi.fn();
    await show({ refresh: inventory });
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'new-folder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    await screen.findByText(root + '/new-folder');
    expect(inventory).toHaveBeenCalledTimes(1);
    const calls = apiMock.mock.calls.map(([, i]) => JSON.parse(i?.body as string));
    expect(calls.some((x) => x.action === 'mkdir' && x.confirmed === true)).toBe(true);
    expect(calls.every((x) => ['list', 'mkdir'].includes(x.action))).toBe(true);
  });
  it('uploads bytes with checksum and does not ingest memory automatically', async () => {
    await show();
    selectFile(file());
    fireEvent.click(screen.getByRole('button', { name: 'Upload to this folder' }));
    await screen.findByText('Saved: notes.txt. Nothing was executed or added to memory.');
    expect(uploadMock.mock.calls[0]?.[1]).toMatchObject({
      directory: root,
      name: 'notes.txt',
      confirmed: true,
      contentBase64: 'dGVzdA==',
    });
    expect(memoryCalls).toBe(0);
  });
  it('requires explicit overwrite and sends the listed version', async () => {
    entries.push({ name: 'notes.txt', kind: 'file', size: 3, version: 'old-version' });
    await show();
    selectFile(file());
    expect(screen.getByRole('button', { name: 'Upload to this folder' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I confirm replacing these exact listed versions/));
    fireEvent.click(screen.getByRole('button', { name: 'Upload to this folder' }));
    await screen.findByText('Saved: notes.txt. Nothing was executed or added to memory.');
    expect(uploadMock.mock.calls[0]?.[1]).toMatchObject({
      overwrite: true,
      expectedVersion: 'old-version',
    });
  });
  it('does not call an unsuccessful upload saved', async () => {
    uploadMock.mockResolvedValue({ saved: false } as any);
    await show();
    selectFile(file());
    fireEvent.click(screen.getByRole('button', { name: 'Upload to this folder' }));
    await screen.findByText(/Server upload verification failed/);
    expect(
      screen.queryByText('Saved: notes.txt. Nothing was executed or added to memory.'),
    ).toBeNull();
  });
  it('requires a selected saved project and separate memory confirmation', async () => {
    entries.push({ name: 'notes.txt', kind: 'file', size: 3, version: 'v1' });
    await show({ projectId: 'saved-project' });
    fireEvent.click(screen.getByRole('button', { name: 'Add notes.txt to project memory' }));
    expect(memoryCalls).toBe(0);
    fireEvent.click(
      screen.getByLabelText('I approve storing this file’s contents in project memory'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm memory import' }));
    await screen.findByText(
      'Selected text file added as project-scoped evidence in MemoryV4. The original remains in the workspace.',
    );
    expect(memoryCalls).toBe(1);
    expect(
      JSON.parse(apiMock.mock.calls.find(([p]) => p.endsWith('/memory'))?.[1]?.body as string),
    ).toMatchObject({ projectId: 'saved-project', expectedVersion: 'v1', confirmed: true });
  });
  it('disables memory imports for unsaved projects or unsupported files', async () => {
    entries.push({ name: 'notes.txt', kind: 'file', size: 3, version: 'v1' });
    await show();
    expect(screen.getByRole('button', { name: 'Add notes.txt to project memory' })).toBeDisabled();
  });
  it('shows directory failures without presenting stale selectable data', async () => {
    apiMock.mockRejectedValue(new Error('Workspace is unavailable'));
    setup();
    fireEvent.click(
      screen.getByRole('button', { name: 'Browse / Create workspace · Upload files' }),
    );
    await screen.findByText('Workspace is unavailable');
    expect(screen.queryByRole('button', { name: 'Use this workspace' })).toBeNull();
  });
});
