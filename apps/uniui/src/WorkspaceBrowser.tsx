import {
  Alert,
  Button,
  Checkbox,
  Code,
  FileInput,
  Group,
  Modal,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { api, apiUpload } from './api';
import type { WorkInventory } from './WorkSelections';
type Entry = { name: string; kind: 'directory' | 'file'; size: number; version: string };
type Listing = {
  directory: string;
  root: string;
  items: Entry[];
  selectable: boolean;
  maxUploadBytes: number;
};
export function WorkspaceBrowser({
  inventory,
  workspace,
  projectId,
  onSelect,
  disabled,
}: {
  inventory: WorkInventory;
  workspace: string;
  projectId?: string | undefined;
  onSelect: (path: string) => void;
  disabled: boolean;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button
        variant="light"
        disabled={!inventory.ready || !inventory.workspaces.length || disabled}
        onClick={() => setOpened(true)}
      >
        Browse / Create workspace · Upload files
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Workspace folders and files"
        size="xl"
        closeOnClickOutside={false}
      >
        {opened && (
          <Browser
            key={inventory.frameworkId}
            inventory={inventory}
            workspace={workspace}
            projectId={projectId}
            onSelect={(path) => {
              onSelect(path);
              inventory.refresh();
              setOpened(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}
function Browser({
  inventory,
  workspace,
  projectId,
  onSelect,
}: {
  inventory: WorkInventory;
  workspace: string;
  projectId?: string | undefined;
  onSelect: (path: string) => void;
}) {
  const endpoint = `/frameworks/${encodeURIComponent(inventory.frameworkId)}/work/files`;
  const [listing, setListing] = useState<Listing>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [memoryFile, setMemoryFile] = useState<Entry>();
  const [memoryConfirmed, setMemoryConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadName, setUploadName] = useState('');
  const epoch = useRef(0);
  const upload = useRef<AbortController | undefined>(undefined);
  const request = <T,>(body: unknown) =>
    api<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });
  const load = async (directory: string) => {
    const token = ++epoch.current;
    setBusy(true);
    setError('');
    setOverwrite(false);
    setMemoryFile(undefined);
    setMemoryConfirmed(false);
    try {
      const next = await request<Listing>({ action: 'list', directory });
      if (token === epoch.current) setListing(next);
    } catch (e) {
      if (token === epoch.current) {
        setError(message(e));
        setListing(undefined);
      }
    } finally {
      if (token === epoch.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load(workspace || inventory.workspaces[0]!.value);
    return () => {
      epoch.current++;
      upload.current?.abort();
    };
  }, []);
  const createFolder = async () => {
    if (!listing) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{ directory: string }>({
        action: 'mkdir',
        directory: listing.directory,
        name: folder,
        confirmed: true,
      });
      setFolder('');
      inventory.refresh();
      await load(result.directory);
      setNotice('Folder created. No work was started.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const uploadFiles = async () => {
    if (!listing) return;
    if (files.length > 10 || new Set(files.map((f) => f.name)).size !== files.length) {
      setError('Select up to 10 files with distinct names.');
      return;
    }
    if (files.some((f) => f.size > listing.maxUploadBytes)) {
      setError('Each file must be at most 8 MiB.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    upload.current = new AbortController();
    const saved: string[] = [];
    try {
      for (const file of files) {
        const prior = listing.items.find((x) => x.name === file.name);
        if (prior && (prior.kind !== 'file' || !overwrite))
          throw new Error('Confirm overwriting the listed files, or choose another destination.');
        setUploadName(file.name);
        setProgress(0);
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const sha256 = Array.from(new Uint8Array(digest), (v) =>
          v.toString(16).padStart(2, '0'),
        ).join('');
        const contentBase64 = await base64(file);
        const result = await apiUpload<{ saved: boolean; sha256: string }>(
          endpoint,
          {
            action: 'upload',
            directory: listing.directory,
            name: file.name,
            contentBase64,
            sha256,
            confirmed: true,
            ...(prior ? { overwrite: true, expectedVersion: prior.version } : {}),
          },
          setProgress,
          upload.current.signal,
        );
        if (!result.saved || result.sha256 !== sha256)
          throw new Error('Server upload verification failed. Refresh before retrying.');
        saved.push(file.name);
        setNotice('Saved: ' + saved.join(', '));
      }
      setFiles([]);
      await load(listing.directory);
      setNotice('Saved: ' + saved.join(', ') + '. Nothing was executed or added to memory.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setUploadName('');
    }
  };
  const addMemory = async () => {
    if (!listing || !memoryFile || !memoryConfirmed || !projectId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(endpoint + '/memory', {
        method: 'POST',
        body: JSON.stringify({
          directory: listing.directory,
          name: memoryFile.name,
          expectedVersion: memoryFile.version,
          projectId,
          confirmed: true,
        }),
      });
      setNotice(
        'Selected text file added as project-scoped evidence in MemoryV4. The original remains in the workspace.',
      );
      setMemoryFile(undefined);
      setMemoryConfirmed(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const conflicts = files.filter((file) => listing?.items.some((item) => item.name === file.name));
  return (
    <Stack>
      <Text size="sm">
        Server folders on {inventory.frameworkId}. Local files are copied here; selecting folders or
        uploading never starts agents.
      </Text>
      <Select
        label="Approved workspace"
        data={inventory.workspaces}
        value={listing?.directory ?? null}
        onChange={(v) => {
          if (v) void load(v);
        }}
        disabled={busy}
        searchable
      />
      {error && (
        <Alert color="red" title="Workspace operation failed">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert color="teal" role="status">
          {notice}
        </Alert>
      )}
      {busy && !uploadName && <Text role="status">Checking workspace…</Text>}
      {listing && (
        <>
          <Text>
            Destination: <Code>{listing.directory}</Code>
          </Text>
          <Group>
            <Button
              variant="subtle"
              disabled={busy || listing.directory === listing.root}
              onClick={() =>
                void load(listing.directory.slice(0, listing.directory.lastIndexOf('/')))
              }
            >
              Parent folder
            </Button>
            <Button variant="subtle" disabled={busy} onClick={() => void load(listing.directory)}>
              Refresh files
            </Button>
            <Button
              disabled={busy || !listing.selectable}
              onClick={() => onSelect(listing.directory)}
            >
              Use this workspace
            </Button>
          </Group>
          {!listing.selectable && (
            <Text size="sm">
              This subfolder can store files. Workspace selection is limited to the approved
              inventory.
            </Text>
          )}
          <Group align="end">
            <TextInput
              label="New folder name"
              value={folder}
              onChange={(e) => setFolder(e.currentTarget.value)}
              disabled={busy}
            />
            <Button disabled={busy || !folder.trim()} onClick={() => void createFolder()}>
              Create folder
            </Button>
          </Group>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type / bytes</Table.Th>
                <Table.Th>Action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {listing.items.map((item) => (
                <Table.Tr key={item.name}>
                  <Table.Td>{item.name}</Table.Td>
                  <Table.Td>{item.kind === 'directory' ? 'Folder' : item.size}</Table.Td>
                  <Table.Td>
                    {item.kind === 'directory' ? (
                      <Button
                        size="xs"
                        variant="subtle"
                        disabled={busy}
                        onClick={() => void load(listing.directory + '/' + item.name)}
                      >
                        Open {item.name}
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="subtle"
                        disabled={busy || !projectId || item.size > 262144}
                        onClick={() => {
                          setMemoryFile(item);
                          setMemoryConfirmed(false);
                        }}
                      >
                        Add {item.name} to project memory
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!listing.items.length && <Text>No visible files or subfolders.</Text>}
          <FileInput
            label="Choose files from your computer"
            description="Up to 10 files, 8 MiB each. Archives are stored without extraction."
            multiple
            value={files}
            onChange={(v) => {
              setFiles(v);
              setOverwrite(false);
            }}
            disabled={busy}
          />
          {files.length > 0 && (
            <Text size="sm">Selected: {files.map((f) => f.name).join(', ')}</Text>
          )}
          {conflicts.length > 0 && (
            <Checkbox
              checked={overwrite}
              disabled={busy}
              onChange={(e) => setOverwrite(e.currentTarget.checked)}
              label={
                'I confirm replacing these exact listed versions: ' +
                conflicts.map((f) => f.name).join(', ') +
                '. Prior files will be retained.'
              }
            />
          )}
          <Button
            disabled={busy || !files.length || (conflicts.length > 0 && !overwrite)}
            onClick={() => void uploadFiles()}
          >
            Upload to this folder
          </Button>
          {uploadName && (
            <>
              <Text role="status">
                {uploadName}:{' '}
                {progress === 100
                  ? 'Transfer complete; awaiting server verification.'
                  : `Sending ${progress}%`}
              </Text>
              <Progress value={progress} aria-label="Upload transfer progress" />
            </>
          )}
          <Text size="sm" c="dimmed">
            Memory is optional and separate. Save the project with this workspace first. Only
            regular UTF-8 text files up to 256 KiB can be imported here; other working files remain
            available in the workspace.
          </Text>
          {memoryFile && (
            <Alert title="Confirm project memory import" color="yellow">
              <Stack>
                <Text>
                  Import {memoryFile.name} into project {projectId} as evidence, with a source
                  reference and checksum. This is not an instruction or a promotion to canonical
                  memory.
                </Text>
                <Checkbox
                  checked={memoryConfirmed}
                  onChange={(e) => setMemoryConfirmed(e.currentTarget.checked)}
                  disabled={busy}
                  label="I approve storing this file’s contents in project memory"
                />
                <Button disabled={busy || !memoryConfirmed} onClick={() => void addMemory()}>
                  Confirm memory import
                </Button>
              </Stack>
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : 'Workspace operation failed';
}
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the local file'));
    reader.readAsDataURL(file);
  });
}
