import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconEdit, IconRefresh, IconUsers } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, gateway } from './api';
import { useFrameworkContext } from './FrameworkContext';
import type { MutationResponse } from './types';

type Profile = {
  id: string;
  displayName: string;
  active: boolean;
  gatewayStatus: 'running' | 'stopped' | 'unknown';
  model?: string;
  provider?: string;
  owner: 'hermes';
  frameworkId: string;
  sourceVersion: string;
  observedAt: string;
};
type Collection = {
  meta: {
    owner: 'hermes';
    frameworkId: string;
    frameworkVersion: string;
    frameworkCommit: string;
    sourceVersion: string;
    observedAt: string;
    freshness: 'current';
  };
  items: Profile[];
  page: { hasMore: boolean; nextCursor?: string };
};
type Capabilities = {
  meta: Collection['meta'];
  data: {
    capabilities: Record<
      string,
      { status: 'supported' | 'unsupported' | 'unavailable' | 'forbidden'; reasonCode?: string }
    >;
  };
};

type RenameState = {
  profile: Profile;
  newId: string;
  confirmed: boolean;
  reviewedFingerprint: string;
  dryRunKey: string;
  executeKey: string;
  preflight?: MutationResponse;
};

export function ProfilesView({ canManage }: { canManage: boolean }) {
  const {
    frameworks,
    frameworkId,
    loading: frameworksLoading,
    error: frameworkError,
    selectionIssue,
    selectFramework,
  } = useFrameworkContext();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'dry-run' | 'execute' | ''>('');
  const [rename, setRename] = useState<RenameState | null>(null);
  const generation = useRef(0);
  const selectedFramework = useRef(frameworkId);
  selectedFramework.current = frameworkId;

  const load = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (!frameworkId) {
      setCollection(null);
      setCapabilities(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [profiles, manifest] = await Promise.all([
        api<Collection>(`/frameworks/${encodeURIComponent(frameworkId)}/profiles?limit=100`),
        api<Capabilities>(`/frameworks/${encodeURIComponent(frameworkId)}/capabilities`),
      ]);
      if (generation.current !== requestGeneration) return;
      setCollection(profiles);
      setCapabilities(manifest);
    } catch (cause) {
      if (generation.current !== requestGeneration) return;
      setCollection(null);
      setCapabilities(null);
      setError(cause instanceof Error ? cause.message : 'Hermes profile inventory unavailable');
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, [frameworkId]);

  useEffect(() => {
    setRename(null);
    setBusy('');
    setNotice('');
    void load();
  }, [load]);

  const loadMore = async () => {
    const cursor = collection?.page.nextCursor;
    const requestFramework = frameworkId;
    if (!cursor || !requestFramework) return;
    setLoadingMore(true);
    setError('');
    try {
      const next = await api<Collection>(
        `/frameworks/${encodeURIComponent(requestFramework)}/profiles?limit=100&cursor=${encodeURIComponent(cursor)}`,
      );
      if (selectedFramework.current !== requestFramework) return;
      setCollection((current) =>
        current ? { ...next, items: [...current.items, ...next.items] } : next,
      );
    } catch (cause) {
      if (selectedFramework.current !== requestFramework) return;
      setError(cause instanceof Error ? cause.message : 'Next Hermes profile page unavailable');
    } finally {
      if (selectedFramework.current === requestFramework) setLoadingMore(false);
    }
  };

  const executeCapability = capabilities?.data.capabilities['profiles.execute'];
  const renameEnabled = canManage && executeCapability?.status === 'supported' && !!frameworkId;
  const frameworkOptions = useMemo(
    () => frameworks.map((item) => ({ value: item.frameworkId, label: item.displayName })),
    [frameworks],
  );
  const newIdError = rename ? profileIdError(rename.profile.id, rename.newId) : '';
  const fingerprint = rename
    ? `${rename.profile.frameworkId}:${rename.profile.id}:${rename.profile.sourceVersion}:${rename.newId.trim()}`
    : '';
  const reviewed = !!rename?.preflight && rename.reviewedFingerprint === fingerprint;

  const updateNewId = (newId: string) => {
    setRename((current) =>
      current
        ? {
            profile: current.profile,
            confirmed: current.confirmed,
            newId,
            reviewedFingerprint: '',
            dryRunKey: crypto.randomUUID(),
            executeKey: crypto.randomUUID(),
          }
        : null,
    );
    setError('');
  };

  const mutateRename = async (mode: 'dry-run' | 'execute') => {
    if (!rename || newIdError || !rename.confirmed) return;
    const intent = rename;
    const intentFingerprint = `${intent.profile.frameworkId}:${intent.profile.id}:${intent.profile.sourceVersion}:${intent.newId.trim()}`;
    if (mode === 'execute' && intent.reviewedFingerprint !== intentFingerprint) return;
    setBusy(mode);
    setError('');
    setNotice('');
    try {
      const result = await gateway.mutate(
        {
          operationType: 'profile.rename',
          target: {
            owner: 'hermes',
            kind: 'profile',
            nativeId: intent.profile.id,
            frameworkId: intent.profile.frameworkId,
          },
          payload: {
            newId: intent.newId.trim(),
            expectedSourceVersion: intent.profile.sourceVersion,
          },
          mode,
          confirmed: true,
        },
        mode === 'dry-run' ? intent.dryRunKey : intent.executeKey,
      );
      if (result.operation.state !== 'verified')
        throw new Error(
          `Governed profile rename did not verify; operation state is ${result.operation.state}.`,
        );
      if (selectedFramework.current !== intent.profile.frameworkId) return;
      if (mode === 'dry-run') {
        setRename((current) =>
          current?.profile.id === intent.profile.id
            ? { ...current, preflight: result, reviewedFingerprint: intentFingerprint }
            : current,
        );
        setNotice('Hermes validated the rename and completed the governed dry-run.');
      } else {
        const destination = intent.newId.trim();
        setRename(null);
        setNotice(
          result.replayed
            ? `Rename to ${destination} was already completed; governed evidence was replayed.`
            : `Profile renamed to ${destination} in Hermes and verified by authoritative readback.`,
        );
        await load();
      }
    } catch (cause) {
      if (selectedFramework.current !== intent.profile.frameworkId) return;
      setRename((current) => {
        if (current?.profile.id !== intent.profile.id) return current;
        return mode === 'execute'
          ? { ...current, executeKey: crypto.randomUUID() }
          : { ...current, dryRunKey: crypto.randomUUID() };
      });
      setError(cause instanceof Error ? cause.message : 'Hermes profile rename failed');
    } finally {
      if (selectedFramework.current === intent.profile.frameworkId) setBusy('');
    }
  };

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} tt="uppercase">
            Hermes source of truth
          </Text>
          <Title>Profiles</Title>
          <Text c="dimmed">
            Profiles are read and governed directly in the selected registered Hermes framework.
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </Group>
      <Select
        label="Hermes framework"
        value={frameworkId || null}
        data={frameworkOptions}
        onChange={(value) => selectFramework(value ?? '')}
        placeholder="No verified Hermes framework"
        disabled={frameworksLoading}
      />
      {frameworkError || selectionIssue || error ? (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {frameworkError || selectionIssue || error}
        </Alert>
      ) : null}
      {notice ? <Alert color="teal">{notice}</Alert> : null}
      {!frameworksLoading && !frameworks.length ? (
        <Alert color="yellow">
          No enabled, verified Hermes framework is registered. Profile truth is unavailable.
        </Alert>
      ) : null}
      {executeCapability?.status !== 'supported' ? (
        <Alert color="blue">
          Profile changes are disabled: Hermes reports{' '}
          <strong>{executeCapability?.status ?? 'unavailable'}</strong>
          {executeCapability?.reasonCode ? ` (${executeCapability.reasonCode})` : ''}. UNIFY will
          not route writes to an external owner or approximate them locally.
        </Alert>
      ) : !canManage ? (
        <Alert color="blue">Profile changes are read-only for your role.</Alert>
      ) : null}
      {loading && !collection ? (
        <Group>
          <Loader size="sm" />
          <Text>Loading Hermes profiles…</Text>
        </Group>
      ) : null}
      {collection ? (
        <>
          <Group>
            <Badge color="teal">Hermes · current</Badge>
            <Text size="sm" c="dimmed">
              Framework {collection.meta.frameworkId}
            </Text>
            <Text size="sm" c="dimmed">
              Observed {formatDate(collection.meta.observedAt)}
            </Text>
            <Text size="sm" c="dimmed">
              {collection.items.length} profiles
            </Text>
          </Group>
          {!collection.items.length ? (
            <Alert color="yellow">Hermes returned no profiles for this framework.</Alert>
          ) : (
            <Paper withBorder>
              <ScrollArea>
                <Table verticalSpacing="md" miw={820} aria-label="Hermes profiles">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      <Table.Th>Model</Table.Th>
                      <Table.Th>Provider</Table.Th>
                      <Table.Th>Runtime</Table.Th>
                      <Table.Th>Truth</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {collection.items.map((profile) => {
                      const builtIn = profile.id === 'default';
                      return (
                        <Table.Tr key={`${profile.frameworkId}:${profile.id}`}>
                          <Table.Td>
                            <Group gap="xs">
                              <IconUsers size={16} />
                              <div>
                                <Text fw={600}>{profile.displayName}</Text>
                                <Text size="xs" c="dimmed">
                                  {profile.id}
                                </Text>
                              </div>
                            </Group>
                          </Table.Td>
                          <Table.Td>{profile.model ?? 'Not reported'}</Table.Td>
                          <Table.Td>{profile.provider ?? 'Not reported'}</Table.Td>
                          <Table.Td>
                            <Badge
                              color={
                                profile.gatewayStatus === 'running'
                                  ? 'teal'
                                  : profile.gatewayStatus === 'stopped'
                                    ? 'gray'
                                    : 'yellow'
                              }
                            >
                              {profile.gatewayStatus}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Badge color="teal">{profile.owner}</Badge>
                          </Table.Td>
                          <Table.Td>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconEdit size={14} />}
                              disabled={!renameEnabled || builtIn}
                              title={
                                builtIn
                                  ? 'Hermes does not support renaming its built-in default profile'
                                  : undefined
                              }
                              aria-label={`Rename ${profile.displayName}`}
                              onClick={() => {
                                setError('');
                                setNotice('');
                                setRename({
                                  profile,
                                  newId: '',
                                  confirmed: false,
                                  reviewedFingerprint: '',
                                  dryRunKey: crypto.randomUUID(),
                                  executeKey: crypto.randomUUID(),
                                });
                              }}
                            >
                              Rename
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          )}
          {collection.items.find((profile) => profile.id === 'default') ? (
            <Alert color="blue">
              The base agent is displayed as{' '}
              <strong>
                {collection.items.find((profile) => profile.id === 'default')?.displayName}
              </strong>{' '}
              from the verified framework adapter configuration. Hermes retains the immutable native{' '}
              <Code>default</Code> ID; UNIUI does not emulate an unsupported ID rename.
            </Alert>
          ) : null}
          {collection.page.hasMore ? (
            <Button variant="light" loading={loadingMore} onClick={() => void loadMore()}>
              Load more profiles
            </Button>
          ) : null}
        </>
      ) : null}

      <Modal
        opened={!!rename}
        onClose={() => (busy ? undefined : setRename(null))}
        title="Rename Hermes profile"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
      >
        {rename ? (
          <Stack>
            <Alert color="blue">
              Framework <Code>{rename.profile.frameworkId}</Code> · source{' '}
              <Code>{rename.profile.id}</Code>. Hermes owns this mutation.
            </Alert>
            <TextInput
              label="New profile ID"
              description="Lowercase letters, numbers, hyphens, and underscores; maximum 128 characters."
              placeholder="alica"
              value={rename.newId}
              error={rename.newId ? newIdError : undefined}
              disabled={!!busy}
              onChange={(event) => updateNewId(event.currentTarget.value)}
            />
            <Checkbox
              checked={rename.confirmed}
              disabled={!!busy}
              label="I understand this renames the authoritative Hermes profile and may affect profile-scoped integrations."
              onChange={(event) => {
                const confirmed = event.currentTarget.checked;
                setRename((current) => (current ? { ...current, confirmed } : null));
              }}
            />
            {reviewed ? (
              <Alert color="teal">
                Dry-run passed. Source version <Code>{rename.profile.sourceVersion}</Code> is pinned
                for execution. Operation <Code>{rename.preflight?.operation.operationId}</Code>{' '}
                recorded the preflight evidence.
              </Alert>
            ) : null}
            <Group justify="flex-end">
              <Button variant="default" disabled={!!busy} onClick={() => setRename(null)}>
                Cancel
              </Button>
              <Button
                variant="light"
                disabled={!rename.newId || !!newIdError || !rename.confirmed || !!busy}
                loading={busy === 'dry-run'}
                onClick={() => void mutateRename('dry-run')}
              >
                Validate and dry-run
              </Button>
              <Button
                color="red"
                disabled={!reviewed || !rename.confirmed || !!busy}
                loading={busy === 'execute'}
                onClick={() => void mutateRename('execute')}
              >
                Rename profile
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </Stack>
  );
}

function profileIdError(currentId: string, newId: string) {
  if (!newId.trim()) return 'Enter a destination profile ID.';
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(newId))
    return 'Use a lowercase Hermes profile ID with only letters, numbers, hyphens, or underscores.';
  if (newId === currentId) return 'The destination must differ from the current profile ID.';
  return '';
}

function formatDate(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
