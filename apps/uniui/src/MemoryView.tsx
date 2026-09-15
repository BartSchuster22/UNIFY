import { formatUserDate } from './userTime';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  Paper,
  Pill,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconBinaryTree,
  IconBook2,
  IconDatabaseSearch,
  IconExternalLink,
  IconFileDescription,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from './api';
import { MemoryEditor } from './MemoryEditor';
import type {
  MemoryArtifact,
  MemoryAuditEvent,
  MemoryEntity,
  MemoryRecord,
  MemoryRelation,
  MemoryRetrievalEvent,
} from './types';

type MemorySection = 'records' | 'search' | 'entities' | 'connections' | 'govern' | 'evidence';
type Page<T, K extends string> = Record<K, T[]> & { next_cursor: string | null };
type MemoryStatus = { status: 'ready'; contractVersion: string };
type CapabilityOperation = {
  method: string;
  path: string;
  permission: string;
  status: string;
  mutation: boolean;
};
type MemoryCapabilities = {
  service: string;
  contract_version: string;
  api_style: string;
  architecture: Record<string, string>;
  operations: CapabilityOperation[];
};
type EntityContext = {
  entity: MemoryEntity;
  records: MemoryRecord[];
  relations: MemoryRelation[];
  artifacts: MemoryArtifact[];
  truncated: boolean;
};
type SearchResult = { record: MemoryRecord; score: number };

const roleOptions = [
  { value: '', label: 'All roles' },
  { value: 'canonical', label: 'Canonical' },
  { value: 'active', label: 'Active' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'exhaust', label: 'Exhaust' },
];
const lifecycleOptions = [
  { value: '', label: 'All lifecycle states' },
  { value: 'live', label: 'Live' },
  { value: 'working', label: 'Working' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'archived', label: 'Archived' },
  { value: 'expired', label: 'Expired' },
];

function memoryPagePath(path: string, scope: string, params: Record<string, string | number>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  if (scope) query.set('scope_path', scope);
  return `${path}?${query.toString()}`;
}

export function MemoryView({
  canReadAudit,
  canWrite,
  canPromote,
  canAdmin,
}: {
  canReadAudit: boolean;
  canWrite: boolean;
  canPromote: boolean;
  canAdmin: boolean;
}) {
  const [section, setSection] = useState<MemorySection>('records');
  const [scope, setScope] = useState('');
  const [scopeInput, setScopeInput] = useState('');
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [capabilities, setCapabilities] = useState<MemoryCapabilities | null>(null);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [entities, setEntities] = useState<MemoryEntity[]>([]);
  const [relations, setRelations] = useState<MemoryRelation[]>([]);
  const [artifacts, setArtifacts] = useState<MemoryArtifact[]>([]);
  const [nextRecords, setNextRecords] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<MemoryRecord | null>(null);
  const [selectedContext, setSelectedContext] = useState<EntityContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [checkedAt, setCheckedAt] = useState('');

  const load = useCallback(
    async (requestedScope = scope) => {
      setLoading(true);
      setFailure('');
      try {
        const [nextStatus, nextCapabilities, recordPage, entityPage, relationPage, artifactPage] =
          await Promise.all([
            api<MemoryStatus>('/memory/status'),
            api<MemoryCapabilities>('/memory/capabilities'),
            api<Page<MemoryRecord, 'records'>>(
              memoryPagePath('/memory/records', requestedScope, { limit: 100 }),
            ),
            api<Page<MemoryEntity, 'entities'>>(
              memoryPagePath('/memory/entities', requestedScope, { limit: 100 }),
            ),
            api<Page<MemoryRelation, 'relations'>>(
              memoryPagePath('/memory/relations', requestedScope, { limit: 100 }),
            ),
            api<Page<MemoryArtifact, 'artifacts'>>(
              memoryPagePath('/memory/artifacts', requestedScope, { limit: 100 }),
            ),
          ]);
        setStatus(nextStatus);
        setCapabilities(nextCapabilities);
        setRecords(recordPage.records);
        setEntities(entityPage.entities);
        setRelations(relationPage.relations);
        setArtifacts(artifactPage.artifacts);
        setNextRecords(recordPage.next_cursor);
        setSelectedRecord((current) =>
          current ? (recordPage.records.find((record) => record.id === current.id) ?? null) : null,
        );
        setCheckedAt(new Date().toISOString());
      } catch (cause) {
        setStatus(null);
        setCapabilities(null);
        setRecords([]);
        setEntities([]);
        setRelations([]);
        setArtifacts([]);
        setNextRecords(null);
        setFailure(failureMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loadMoreRecords = async () => {
    if (!nextRecords) return;
    setLoading(true);
    setFailure('');
    try {
      const page = await api<Page<MemoryRecord, 'records'>>(
        memoryPagePath('/memory/records', scope, { limit: 100, cursor: nextRecords }),
      );
      setRecords((current) => [...current, ...page.records]);
      setNextRecords(page.next_cursor);
    } catch (cause) {
      setFailure(failureMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const chooseEntity = async (entity: MemoryEntity) => {
    setContextLoading(true);
    setSelectedContext(null);
    setFailure('');
    try {
      setSelectedContext(
        await api<EntityContext>(
          `/memory/context/${encodeURIComponent(entity.entity_type)}/${encodeURIComponent(entity.id)}`,
        ),
      );
    } catch (cause) {
      setFailure(failureMessage(cause));
    } finally {
      setContextLoading(false);
    }
  };

  const sectionOptions = [
    { value: 'records', label: 'Records' },
    { value: 'search', label: 'Search' },
    { value: 'entities', label: 'Entities' },
    { value: 'connections', label: 'Relations & artifacts' },
    ...(canWrite || canPromote || canAdmin ? [{ value: 'govern', label: 'Governed editing' }] : []),
    ...(canReadAudit ? [{ value: 'evidence', label: 'Evidence' }] : []),
  ];
  const operationCount = capabilities?.operations.filter(
    (operation) => operation.status === 'implemented',
  ).length;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} tt="uppercase">
            Governed Tier-3 knowledge
          </Text>
          <Title order={1}>Memory &amp; knowledge</Title>
          <Text c="dimmed">
            Governed records, entities, relationships, artifacts, search results and source evidence
            from authoritative MemoryV4.
          </Text>
        </div>
        <Group gap="xs">
          <Badge color={status ? 'teal' : loading ? 'gray' : 'red'} size="lg">
            {status ? 'Connected' : loading ? 'Checking' : 'Unavailable'}
          </Badge>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        </Group>
      </Group>

      <Alert
        color={canWrite || canPromote || canAdmin ? 'blue' : 'gray'}
        icon={<IconShieldCheck size={18} />}
        title={canWrite || canPromote || canAdmin ? 'Governed editing enabled' : 'Read-only role'}
      >
        {canWrite || canPromote || canAdmin
          ? 'Your UNIFY role exposes only its allowlisted editing actions. Every mutation is CSRF-protected, idempotent, scope-confined, attributed to your named identity and evidenced by both systems.'
          : 'Your UNIFY role performs only allowlisted GET requests. No create, edit, promotion or lifecycle action is exposed.'}
      </Alert>

      <Paper withBorder p="md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const nextScope = scopeInput.trim();
            setSelectedRecord(null);
            setSelectedContext(null);
            if (nextScope === scope) void load(nextScope);
            else setScope(nextScope);
          }}
        >
          <Group align="end">
            <TextInput
              label="Memory scope"
              description="Blank uses the adapter root; enter a descendant scope to narrow the view."
              placeholder="org:a/project:unify"
              value={scopeInput}
              onChange={(event) => setScopeInput(event.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button type="submit" variant="light" loading={loading}>
              Apply scope
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            Active scope: <Code>{scope || 'configured adapter root'}</Code>. The Gateway rejects
            sibling, ancestor and global escalation.
          </Text>
        </form>
      </Paper>

      {failure ? (
        <Alert color="red" title="MemoryV4 data unavailable" role="alert">
          {failure} No empty result is inferred from an unavailable source.
        </Alert>
      ) : null}
      {loading && !checkedAt ? <Loader aria-label="Loading MemoryV4 knowledge" /> : null}

      {status && capabilities ? (
        <SimpleGrid cols={{ base: 2, md: 3, xl: 6 }}>
          <Metric
            label="Records"
            value={sampleCount(records.length, nextRecords)}
            icon={IconBook2}
          />
          <Metric
            label="Entities"
            value={sampleCount(entities.length, null)}
            icon={IconBinaryTree}
          />
          <Metric
            label="Relations"
            value={sampleCount(relations.length, null)}
            icon={IconDatabaseSearch}
          />
          <Metric
            label="Artifacts"
            value={sampleCount(artifacts.length, null)}
            icon={IconFileDescription}
          />
          <Metric label="Contract" value={status.contractVersion} icon={IconShieldCheck} />
          <Metric label="Operations" value={String(operationCount ?? 0)} icon={IconExternalLink} />
        </SimpleGrid>
      ) : null}

      {checkedAt ? (
        <Text size="xs" c="dimmed" aria-live="polite">
          Authoritative source: {capabilities?.service ?? 'MemoryV4'} · contract{' '}
          {capabilities?.contract_version ?? 'unknown'} · observed {formatDate(checkedAt)}. Counts
          are the currently loaded visible scope sample, not global totals.
        </Text>
      ) : null}

      {status ? (
        <>
          <ScrollArea type="auto">
            <SegmentedControl
              value={section}
              onChange={(value) => setSection(value as MemorySection)}
              data={sectionOptions}
              aria-label="Memory view"
            />
          </ScrollArea>
          {section === 'records' ? (
            <RecordsSection
              records={records}
              selected={selectedRecord}
              onSelect={setSelectedRecord}
              nextCursor={nextRecords}
              loading={loading}
              onLoadMore={() => void loadMoreRecords()}
            />
          ) : null}
          {section === 'search' ? (
            <SearchSection
              scope={scope}
              onSelect={(record) => {
                setSelectedRecord(record);
                setSection('records');
              }}
            />
          ) : null}
          {section === 'entities' ? (
            <EntitiesSection
              entities={entities}
              context={selectedContext}
              loading={contextLoading}
              onSelect={(entity) => void chooseEntity(entity)}
              onSelectRecord={(record) => {
                setSelectedRecord(record);
                setSection('records');
              }}
            />
          ) : null}
          {section === 'connections' ? (
            <ConnectionsSection relations={relations} artifacts={artifacts} />
          ) : null}
          {section === 'govern' && (canWrite || canPromote || canAdmin) ? (
            <MemoryEditor
              scope={scope}
              selectedRecord={selectedRecord}
              selectedEntity={selectedContext?.entity ?? null}
              canWrite={canWrite}
              canPromote={canPromote}
              canAdmin={canAdmin}
              onChanged={() => load()}
            />
          ) : null}
          {section === 'evidence' && canReadAudit ? <EvidenceSection scope={scope} /> : null}
        </>
      ) : null}
    </Stack>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof IconBook2;
}) {
  return (
    <Card withBorder>
      <Group gap="xs" wrap="nowrap">
        <Icon size={19} aria-hidden="true" />
        <Box>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
          <Text fw={800} size="lg">
            {value}
          </Text>
        </Box>
      </Group>
    </Card>
  );
}

function RecordsSection({
  records,
  selected,
  onSelect,
  nextCursor,
  loading,
  onLoadMore,
}: {
  records: MemoryRecord[];
  selected: MemoryRecord | null;
  onSelect: (record: MemoryRecord | null) => void;
  nextCursor: string | null;
  loading: boolean;
  onLoadMore: () => void;
}) {
  return (
    <Stack gap="md">
      {!records.length ? (
        <Empty
          title="No records visible"
          detail="MemoryV4 returned an authoritative empty record page for this scope."
        />
      ) : null}
      <SimpleGrid cols={{ base: 1, lg: selected ? 2 : 1 }}>
        <Stack gap="xs">
          {records.map((record) => (
            <Card
              withBorder
              key={record.id}
              component="button"
              type="button"
              onClick={() => onSelect(record)}
              aria-pressed={selected?.id === record.id}
              ta="left"
            >
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={750}>{record.title}</Text>
                  <Text size="xs" c="dimmed">
                    {record.topic ?? record.id} · updated {formatDate(record.updated_at)}
                  </Text>
                </div>
                <Group gap={4}>
                  <GovernanceBadge value={record.role} />
                  <GovernanceBadge value={record.lifecycle} />
                </Group>
              </Group>
              <Text lineClamp={2} mt="sm" size="sm">
                {record.content}
              </Text>
              <Group gap={5} mt="sm">
                {record.tags.slice(0, 6).map((tag) => (
                  <Pill key={tag}>{tag}</Pill>
                ))}
              </Group>
            </Card>
          ))}
          {nextCursor ? (
            <Button variant="default" loading={loading} onClick={onLoadMore}>
              Load more records
            </Button>
          ) : null}
        </Stack>
        {selected ? <RecordReader record={selected} onClose={() => onSelect(null)} /> : null}
      </SimpleGrid>
    </Stack>
  );
}

function RecordReader({ record, onClose }: { record: MemoryRecord; onClose: () => void }) {
  return (
    <Paper withBorder p="lg" aria-label={`Record: ${record.title}`}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text size="xs" fw={800} tt="uppercase">
              Record reader
            </Text>
            <Title order={2}>{record.title}</Title>
          </div>
          <Button size="xs" variant="subtle" onClick={onClose}>
            Close
          </Button>
        </Group>
        <Group gap="xs">
          <GovernanceBadge value={record.role} />
          <GovernanceBadge value={record.lifecycle} />
          <Badge variant="outline">{record.write_policy}</Badge>
          <Badge variant="outline">v{record.version}</Badge>
        </Group>
        <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.content}</Text>
        <Divider />
        <Metadata label="Scope" value={record.scope_path} />
        <Metadata label="Author" value={record.author_actor} />
        <Metadata label="Topic" value={record.topic ?? '—'} />
        <Metadata
          label="Entity"
          value={record.entity ? `${record.entity.entity_type}:${record.entity.id}` : '—'}
        />
        <Metadata
          label="Confidence"
          value={record.confidence === null ? '—' : record.confidence.toFixed(2)}
        />
        <Metadata label="Updated" value={formatDate(record.updated_at)} />
        {record.supersedes ? <Metadata label="Supersedes" value={record.supersedes} /> : null}
        {record.superseded_by ? (
          <Metadata label="Superseded by" value={record.superseded_by} />
        ) : null}
        {record.source_refs.length ? (
          <Box>
            <Text size="xs" fw={700} c="dimmed">
              Source references
            </Text>
            {record.source_refs.map((source) => (
              <Code display="block" key={source} style={{ overflowWrap: 'anywhere' }}>
                {source}
              </Code>
            ))}
          </Box>
        ) : null}
        {Object.keys(record.provenance).length ? (
          <JsonEvidence label="Provenance" value={record.provenance} />
        ) : null}
      </Stack>
    </Paper>
  );
}

function SearchSection({
  scope,
  onSelect,
}: {
  scope: string;
  onSelect: (record: MemoryRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [failure, setFailure] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setFailure('');
    try {
      const params = new URLSearchParams({ q: trimmed, limit: '100' });
      if (scope) params.set('scope_path', scope);
      if (role) params.set('role', role);
      if (lifecycle) params.set('lifecycle', lifecycle);
      const page = await api<Page<SearchResult, 'results'>>(`/memory/search?${params}`);
      setResults(page.results);
    } catch (cause) {
      setResults(null);
      setFailure(failureMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="md">
      <Paper withBorder p="md" component="form" onSubmit={(event) => void submit(event)}>
        <Stack gap="sm">
          <TextInput
            label="Search governed records"
            placeholder="Search title and content"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            maxLength={500}
            leftSection={<IconSearch size={16} />}
            required
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Role"
              data={roleOptions}
              value={role}
              onChange={(value) => setRole(value ?? '')}
            />
            <Select
              label="Lifecycle"
              data={lifecycleOptions}
              value={lifecycle}
              onChange={(value) => setLifecycle(value ?? '')}
            />
          </SimpleGrid>
          <Button
            type="submit"
            loading={loading}
            disabled={!query.trim()}
            leftSection={<IconSearch size={16} />}
          >
            Search MemoryV4
          </Button>
        </Stack>
      </Paper>
      {failure ? (
        <Alert color="red" title="Search unavailable">
          {failure}
        </Alert>
      ) : null}
      {results?.length === 0 ? (
        <Empty
          title="No matching records"
          detail="MemoryV4 completed the query and returned no visible matches."
        />
      ) : null}
      {results?.map(({ record, score }) => (
        <Card withBorder key={record.id}>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={750}>{record.title}</Text>
              <Text size="xs" c="dimmed">
                Score {score.toFixed(4)} · {record.scope_path}
              </Text>
            </div>
            <Button size="xs" variant="light" onClick={() => onSelect(record)}>
              Read record
            </Button>
          </Group>
          <Text lineClamp={3} mt="sm">
            {record.content}
          </Text>
        </Card>
      ))}
    </Stack>
  );
}

function EntitiesSection({
  entities,
  context,
  loading,
  onSelect,
  onSelectRecord,
}: {
  entities: MemoryEntity[];
  context: EntityContext | null;
  loading: boolean;
  onSelect: (entity: MemoryEntity) => void;
  onSelectRecord: (record: MemoryRecord) => void;
}) {
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }}>
      <Stack gap="xs">
        {!entities.length ? (
          <Empty
            title="No entities visible"
            detail="MemoryV4 returned an authoritative empty entity page for this scope."
          />
        ) : null}
        {entities.map((entity) => (
          <Card withBorder key={`${entity.entity_type}:${entity.id}`}>
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={750}>{entity.name}</Text>
                <Code>
                  {entity.entity_type}:{entity.id}
                </Code>
                <Text size="xs" c="dimmed" mt={4}>
                  {entity.scope_path} · v{entity.version}
                </Text>
              </div>
              <Button size="xs" variant="light" onClick={() => onSelect(entity)}>
                View context
              </Button>
            </Group>
          </Card>
        ))}
      </Stack>
      <Paper withBorder p="lg">
        {loading ? <Loader aria-label="Loading entity context" /> : null}
        {!loading && !context ? (
          <Text c="dimmed">Select an entity to inspect its governed context.</Text>
        ) : null}
        {context ? (
          <Stack gap="sm">
            <Title order={2}>{context.entity.name}</Title>
            <Text c="dimmed">
              {context.records.length} records · {context.relations.length} relations ·{' '}
              {context.artifacts.length} artifacts
            </Text>
            {context.truncated ? (
              <Alert color="yellow">The source marked this context response as truncated.</Alert>
            ) : null}
            {context.records.map((record) => (
              <Card withBorder key={record.id}>
                <Group justify="space-between">
                  <Text fw={700}>{record.title}</Text>
                  <Button size="compact-xs" variant="subtle" onClick={() => onSelectRecord(record)}>
                    Read
                  </Button>
                </Group>
              </Card>
            ))}
            <JsonEvidence label="Entity attributes" value={context.entity.attrs} />
          </Stack>
        ) : null}
      </Paper>
    </SimpleGrid>
  );
}

function ConnectionsSection({
  relations,
  artifacts,
}: {
  relations: MemoryRelation[];
  artifacts: MemoryArtifact[];
}) {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Relations</Title>
        <Text c="dimmed">Typed, scoped connections between MemoryV4 objects.</Text>
      </div>
      {!relations.length ? (
        <Empty
          title="No relations visible"
          detail="MemoryV4 returned an authoritative empty relation page."
        />
      ) : (
        <ScrollArea>
          <Table striped miw={760}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Type</Table.Th>
                <Table.Th>From</Table.Th>
                <Table.Th>To</Table.Th>
                <Table.Th>Scope</Table.Th>
                <Table.Th>Version</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {relations.map((relation) => (
                <Table.Tr key={relation.id}>
                  <Table.Td>
                    <Badge variant="light">{relation.relation_type}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Code>{objectLabel(relation.from)}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Code>{objectLabel(relation.to)}</Code>
                  </Table.Td>
                  <Table.Td>{relation.scope_path}</Table.Td>
                  <Table.Td>{relation.version}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
      <Divider />
      <div>
        <Title order={2}>Artifacts</Title>
        <Text c="dimmed">
          Provenance-bearing references linked to records or entities. URIs are displayed as data
          and are not opened automatically.
        </Text>
      </div>
      {!artifacts.length ? (
        <Empty
          title="No artifacts visible"
          detail="MemoryV4 returned an authoritative empty artifact page."
        />
      ) : (
        artifacts.map((artifact) => (
          <Card withBorder key={artifact.id}>
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={700}>{artifact.artifact_type}</Text>
                <Code>{artifact.id}</Code>
              </div>
              <Badge variant="outline">v{artifact.version}</Badge>
            </Group>
            <Text mt="sm" style={{ overflowWrap: 'anywhere' }}>
              {artifact.uri}
            </Text>
            <Text size="xs" c="dimmed">
              Target{' '}
              {artifact.record_id ??
                (artifact.entity
                  ? `${artifact.entity.entity_type}:${artifact.entity.id}`
                  : '—')}{' '}
              · {artifact.scope_path}
            </Text>
          </Card>
        ))
      )}
    </Stack>
  );
}

function EvidenceSection({ scope }: { scope: string }) {
  const [audit, setAudit] = useState<MemoryAuditEvent[]>([]);
  const [retrieval, setRetrieval] = useState<MemoryRetrievalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setFailure('');
    try {
      const [auditPage, retrievalPage] = await Promise.all([
        api<Page<MemoryAuditEvent, 'events'>>(
          memoryPagePath('/memory/audit/events', scope, { limit: 100 }),
        ),
        api<Page<MemoryRetrievalEvent, 'events'>>(
          memoryPagePath('/memory/retrieval-events', scope, { limit: 100 }),
        ),
      ]);
      setAudit(auditPage.events);
      setRetrieval(retrievalPage.events);
    } catch (cause) {
      setAudit([]);
      setRetrieval([]);
      setFailure(failureMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [scope]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Memory evidence</Title>
          <Text c="dimmed">
            Durable MemoryV4 write and retrieval evidence within your authorized scope.
          </Text>
        </div>
        <Button
          variant="light"
          loading={loading}
          onClick={() => void load()}
          leftSection={<IconRefresh size={16} />}
        >
          Refresh evidence
        </Button>
      </Group>
      {failure ? (
        <Alert color="red" title="Evidence unavailable">
          {failure}
        </Alert>
      ) : null}
      {!loading && !failure && !audit.length && !retrieval.length ? (
        <Empty
          title="No evidence events visible"
          detail="MemoryV4 returned authoritative empty audit and retrieval pages."
        />
      ) : null}
      <SimpleGrid cols={{ base: 1, xl: 2 }}>
        <Stack gap="xs">
          <Title order={3}>Audit events</Title>
          {audit.map((event) => (
            <Card withBorder key={event.id}>
              <Group justify="space-between">
                <Badge>{event.action}</Badge>
                <Text size="xs">{formatDate(event.created_at)}</Text>
              </Group>
              <Text fw={700} mt="xs">
                {event.object_type}:{event.object_id}
              </Text>
              <Text size="xs" c="dimmed">
                {event.actor} · {event.scope_path}
              </Text>
            </Card>
          ))}
        </Stack>
        <Stack gap="xs">
          <Title order={3}>Retrieval events</Title>
          {retrieval.map((event) => (
            <Card withBorder key={event.id}>
              <Group justify="space-between">
                <Badge color={event.degraded ? 'orange' : 'teal'}>
                  {event.degraded ? 'degraded' : 'complete'}
                </Badge>
                <Text size="xs">{formatDate(event.created_at)}</Text>
              </Group>
              <Text fw={700} mt="xs">
                {event.query}
              </Text>
              <Text size="xs" c="dimmed">
                {event.result_count} results · {event.actor} · {event.scope_path}
              </Text>
            </Card>
          ))}
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}

function GovernanceBadge({ value }: { value: string }) {
  const color =
    value === 'canonical' || value === 'live'
      ? 'teal'
      : value === 'working' || value === 'active'
        ? 'blue'
        : value === 'superseded' || value === 'archived' || value === 'expired'
          ? 'gray'
          : 'violet';
  return (
    <Badge color={color} variant="light">
      {value}
    </Badge>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <Group gap="xs" align="flex-start">
      <Text size="xs" fw={700} c="dimmed" w={95}>
        {label}
      </Text>
      <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
        {value}
      </Text>
    </Group>
  );
}

function JsonEvidence({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <Box>
      <Text size="xs" fw={700} c="dimmed">
        {label}
      </Text>
      <Code block style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {JSON.stringify(value, null, 2)}
      </Code>
    </Box>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <Paper withBorder p="xl">
      <Text fw={700}>{title}</Text>
      <Text c="dimmed">{detail}</Text>
    </Paper>
  );
}

function objectLabel(ref: { kind: string; id: string; entity_type?: string }) {
  return ref.kind === 'entity'
    ? `${ref.entity_type ?? 'entity'}:${ref.id}`
    : `${ref.kind}:${ref.id}`;
}
function sampleCount(count: number, next: string | null) {
  return `${count}${next ? '+' : ''}`;
}
function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : formatUserDate(parsed);
}
function failureMessage(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return 'Your UNIFY role does not permit this MemoryV4 read.';
    return `${cause.failure.message}${cause.failure.requestId ? ` (request ${cause.failure.requestId})` : ''}`;
  }
  return cause instanceof Error ? cause.message : 'MemoryV4 request failed';
}
