import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconCalendar, IconClipboardList, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, gateway } from './api';
import { useFrameworkContext } from './FrameworkContext';
import type { Collection, FederationLease, MutationRequest, UnifiedResource } from './types';

type WorkPage =
  'overview' | 'projects' | 'board' | 'details' | 'add' | 'federation' | 'cronjobs' | 'settings';
type ProjectForm = {
  slug: string;
  name: string;
  goal: string;
  workspace: string;
  projectManager: string;
  agents: string;
};
type TaskForm = { title: string; prompt: string; project: string; agent: string; priority: string };
type CronForm = {
  name: string;
  title: string;
  prompt: string;
  mode: 'at' | 'every' | 'cron';
  schedule: string;
  timezone: string;
};

type WorkCapability = {
  status: 'supported' | 'unsupported' | 'unavailable';
  reason?: string;
};
type CapabilityEnvelope = { data: { capabilities: Record<string, WorkCapability> } };

const lanes = ['triage', 'todo', 'ready', 'running', 'blocked', 'done', 'archived'] as const;
const pageOptions: Array<{ value: WorkPage; label: string }> = [
  { value: 'overview', label: 'Hermes overview' },
  { value: 'projects', label: 'Kanban overview' },
  { value: 'board', label: 'Kanban project' },
  { value: 'details', label: 'Project details' },
  { value: 'add', label: 'Add new' },
  { value: 'federation', label: 'Alica → Herman' },
  { value: 'cronjobs', label: 'Cronjobs' },
  { value: 'settings', label: 'Settings' },
];

export function WorkView({ canManage }: { canManage: boolean }) {
  const {
    frameworks,
    frameworkId,
    loading: frameworksLoading,
    error: frameworkError,
    selectionIssue,
    selectFramework,
  } = useFrameworkContext();
  const initialPage = workPageFromUrl();
  const [page, setPage] = useState<WorkPage>(initialPage);
  const [data, setData] = useState<Collection<UnifiedResource>>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selectedProject, setSelectedProject] = useState(
    () => new URLSearchParams(window.location.search).get('project') ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [workCapability, setWorkCapability] = useState<WorkCapability>();
  const [leases, setLeases] = useState<FederationLease[]>([]);
  const [workerProfiles, setWorkerProfiles] = useState<Array<{ id: string; displayName: string }>>(
    [],
  );
  const [federationLoading, setFederationLoading] = useState(false);
  const [federationFailure, setFederationFailure] = useState<string>();
  const loadGeneration = useRef(0);
  const selectedFramework = useRef(frameworkId);
  selectedFramework.current = frameworkId;

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!frameworkId) {
      setData({ items: [] });
      setWorkCapability(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure(undefined);
    try {
      const [response, capabilityResponse] = await Promise.all([
        loadHermesWork(frameworkId),
        api<CapabilityEnvelope>(`/frameworks/${encodeURIComponent(frameworkId)}/capabilities`),
      ]);
      if (generation !== loadGeneration.current) return;
      setData(response);
      setWorkCapability(capabilityResponse.data.capabilities['work.execute']);
      const projects = nativeProjects(response.items);
      setSelectedProject((current) => current || projects[0]?.slug || '');
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setFailure(errorMessage(error));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [frameworkId]);

  const loadFederation = useCallback(async () => {
    if (!canManage) return;
    setFederationLoading(true);
    setFederationFailure(undefined);
    try {
      const [leaseCollection, profiles] = await Promise.all([
        gateway.federationLeases(),
        gateway.hermesProfiles('hermes-herman'),
      ]);
      setLeases(leaseCollection.items);
      setWorkerProfiles(
        profiles.items
          .map((profile) => ({
            id: text(profile.id),
            displayName: text(profile.displayName) || text(profile.id),
          }))
          .filter((profile) => profile.id),
      );
    } catch (error) {
      setFederationFailure(errorMessage(error));
    } finally {
      setFederationLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    setData({ items: [] });
    setSelectedProject('');
    setNotice(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete('project');
    window.history.replaceState(window.history.state, '', url);
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const restoreFromHistory = () => {
      setPage(workPageFromUrl());
      setSelectedProject(new URLSearchParams(window.location.search).get('project') ?? '');
    };
    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, []);

  useEffect(() => {
    if (page === 'federation') void loadFederation();
  }, [loadFederation, page]);

  const projects = useMemo(() => nativeProjects(data.items), [data.items]);
  const tasks = useMemo(
    () => data.items.filter((item) => item.resource.kind === 'task'),
    [data.items],
  );
  const cronjobs = useMemo(
    () => data.items.filter((item) => item.resource.kind === 'cronjob'),
    [data.items],
  );
  const selected = projects.find((project) => project.slug === selectedProject) ?? projects[0];

  function navigate(next: WorkPage, project = selectedProject) {
    setPage(next);
    if (project) setSelectedProject(project);
    const url = new URL(window.location.href);
    url.pathname = '/work';
    url.searchParams.delete('view');
    url.searchParams.set('workPage', next);
    if (project) url.searchParams.set('project', project);
    else url.searchParams.delete('project');
    window.history.pushState({ workPage: next, project: project || null }, '', url);
  }

  const canExecuteWork = canManage && workCapability?.status === 'supported';

  async function mutate(request: MutationRequest, success: string) {
    if (request.confirmed && !window.confirm('Confirm this destructive Hermes work operation.'))
      return undefined;
    setBusy(true);
    setFailure(undefined);
    setNotice(undefined);
    const requestedFramework = frameworkId;
    try {
      if (!requestedFramework) throw new Error('Select an enabled, verified framework');
      if (!canManage) throw new Error('work.manage permission is required');
      if (workCapability?.status !== 'supported')
        throw new Error(
          workCapability?.reason ??
            'Native Hermes work mutations are not supported by this framework',
        );
      const response = await gateway.mutate(
        {
          ...request,
          target: { ...request.target, frameworkId: requestedFramework },
        },
        crypto.randomUUID(),
      );
      if (selectedFramework.current !== requestedFramework) return undefined;
      if (response.operation.state !== 'verified')
        throw new Error(`Hermes work operation did not verify (${response.operation.state}).`);
      setNotice(response.replayed ? `${success} Governed evidence was replayed.` : success);
      await load();
      return response.result;
    } catch (error) {
      if (selectedFramework.current === requestedFramework) setFailure(errorMessage(error));
      return undefined;
    } finally {
      if (selectedFramework.current === requestedFramework) setBusy(false);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Box>
          <Text size="xs" fw={800} tt="uppercase" c="ocean.7">
            Hermes source of truth
          </Text>
          <Title order={1}>Work & Kanban</Title>
          <Text c="dimmed">
            Projects, Kanban cards, and schedules are read from and mutated through native Hermes.
          </Text>
        </Box>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={() =>
            void Promise.all([load(), ...(page === 'federation' ? [loadFederation()] : [])])
          }
        >
          Refresh
        </Button>
      </Group>

      <Select
        label="Hermes framework"
        value={frameworkId || null}
        data={frameworks.map((item) => ({ value: item.frameworkId, label: item.displayName }))}
        onChange={(value) => selectFramework(value ?? '')}
        placeholder="No verified Hermes framework"
        disabled={frameworksLoading}
      />
      {frameworkError || selectionIssue ? (
        <Alert color="red" title="Framework selection unavailable">
          {frameworkError || selectionIssue}
        </Alert>
      ) : null}
      {!canManage ? (
        <Alert color="yellow" title="Read-only work access">
          `work.manage` permission is required for native Hermes mutations.
        </Alert>
      ) : workCapability && workCapability.status !== 'supported' ? (
        <Alert color="yellow" title="Native work mutations unavailable">
          {workCapability.reason ?? `Hermes reports work.execute as ${workCapability.status}.`}
        </Alert>
      ) : null}

      <ScrollArea type="auto">
        <SegmentedControl
          value={page}
          onChange={(value) => navigate(value as WorkPage)}
          data={pageOptions}
          aria-label="Work and Kanban section"
          className="work-section-navigation"
        />
      </ScrollArea>

      {data.meta?.freshness && (
        <Group gap="xs">
          <Badge color={data.meta.freshness === 'current' ? 'teal' : 'orange'} variant="light">
            Hermes · {data.meta.freshness}
          </Badge>
          {data.meta.observedAt && (
            <Text size="xs" c="dimmed">
              Observed {formatDate(data.meta.observedAt)}
            </Text>
          )}
        </Group>
      )}
      {failure && (
        <Alert color="red" title="Hermes work request failed">
          {failure}
        </Alert>
      )}
      {notice && (
        <Alert color="teal" title="Completed">
          {notice}
        </Alert>
      )}
      {loading ? (
        <Paper withBorder p="xl">
          <Group justify="center">
            <Loader size="sm" />
            <Text>Loading native work data…</Text>
          </Group>
        </Paper>
      ) : (
        <>
          {page === 'overview' && (
            <WorkOverview
              projects={projects}
              tasks={tasks}
              cronjobs={cronjobs}
              onNavigate={navigate}
            />
          )}
          {page === 'projects' && (
            <KanbanOverview
              projects={projects}
              onOpen={(slug) => navigate('board', slug)}
              onDetails={(slug) => navigate('details', slug)}
            />
          )}
          {page === 'board' && (
            <KanbanProject
              projects={projects}
              selected={selected?.slug ?? ''}
              tasks={tasks}
              onSelect={setSelectedProject}
              onDetails={(slug) => navigate('details', slug)}
              onMutate={mutate}
              canManage={canExecuteWork}
              busy={busy}
            />
          )}
          {page === 'details' && (
            <ProjectDetails
              project={selected}
              projects={projects}
              onSelect={setSelectedProject}
              onMutate={mutate}
              canManage={canExecuteWork}
              busy={busy}
            />
          )}
          {page === 'add' && (
            <AddNew
              projects={projects}
              selectedProject={selected?.slug ?? ''}
              onMutate={mutate}
              onCreated={(slug) => navigate('board', slug)}
              canManage={canExecuteWork}
              busy={busy}
            />
          )}
          {page === 'federation' && (
            <FederationView
              frameworkId={frameworkId}
              tasks={tasks}
              leases={leases}
              workerProfiles={workerProfiles}
              canManage={canManage}
              loading={federationLoading}
              failure={federationFailure}
              onReload={async () => {
                await Promise.all([load(), loadFederation()]);
              }}
            />
          )}
          {page === 'cronjobs' && (
            <Cronjobs jobs={cronjobs} onMutate={mutate} canManage={canExecuteWork} busy={busy} />
          )}
          {page === 'settings' && <NotificationSettings />}
        </>
      )}
    </Stack>
  );
}

function WorkOverview({
  projects,
  tasks,
  cronjobs,
  onNavigate,
}: {
  projects: ProjectView[];
  tasks: UnifiedResource[];
  cronjobs: UnifiedResource[];
  onNavigate: (page: WorkPage, project?: string) => void;
}) {
  const blocked = tasks.filter((task) => taskLane(task) === 'blocked');
  const running = tasks.filter((task) => taskLane(task) === 'running');
  const cronAttention = cronjobs.filter((job) => cronPaused(job) || cronFailed(job));
  const attention = blocked.length + cronAttention.length;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Card withBorder className="work-summary-card">
          <Text size="xs" fw={800} tt="uppercase" c="dimmed">
            Operational attention
          </Text>
          <Title order={2} mt="xs">
            {attention} items need attention
          </Title>
          <Text c="dimmed">
            {blocked.length} blocked cards · {cronAttention.length} paused or failed jobs
          </Text>
        </Card>
        <Card withBorder className="work-summary-card" onClick={() => onNavigate('projects')}>
          <Text size="xs" fw={800} tt="uppercase" c="dimmed">
            Kanban
          </Text>
          <Title order={2} mt="xs">
            {running.length} running
          </Title>
          <Text c="dimmed">
            {projects.length} projects · {tasks.length} cards · {blocked.length} blocked
          </Text>
        </Card>
        <Card withBorder className="work-summary-card" onClick={() => onNavigate('cronjobs')}>
          <Text size="xs" fw={800} tt="uppercase" c="dimmed">
            Cronjobs
          </Text>
          <Title order={2} mt="xs">
            {cronjobs.filter((job) => !cronPaused(job) && !cronFailed(job)).length} active
          </Title>
          <Text c="dimmed">{cronAttention.length} paused or failed schedules</Text>
        </Card>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card withBorder>
          <Group justify="space-between">
            <Title order={3}>Blocked Kanban</Title>
            <IconClipboardList size={20} />
          </Group>
          <Stack mt="md" gap="xs">
            {blocked.length === 0 ? (
              <Text c="dimmed">No blocked Kanban cards.</Text>
            ) : (
              blocked.slice(0, 8).map((task) => (
                <Paper withBorder p="sm" key={task.resource.canonicalId}>
                  <Group justify="space-between">
                    <Text fw={700}>{task.title}</Text>
                    <Badge color="red">Blocked</Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {text(task.data.board)} ·{' '}
                    {text(task.data.blockedReason) || task.resource.nativeId}
                  </Text>
                </Paper>
              ))
            )}
          </Stack>
        </Card>
        <Card withBorder>
          <Group justify="space-between">
            <Title order={3}>Scheduler attention</Title>
            <IconCalendar size={20} />
          </Group>
          <Stack mt="md" gap="xs">
            {cronAttention.length === 0 ? (
              <Text c="dimmed">No paused or failed cronjobs.</Text>
            ) : (
              cronAttention.slice(0, 8).map((job) => (
                <Paper withBorder p="sm" key={job.resource.canonicalId}>
                  <Group justify="space-between">
                    <Text fw={700}>{job.title}</Text>
                    <Badge color={cronFailed(job) ? 'red' : 'yellow'}>
                      {cronFailed(job) ? 'Failed' : 'Paused'}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {text(job.data.lastResult) || text(job.data.status)}
                  </Text>
                </Paper>
              ))
            )}
          </Stack>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}

function KanbanOverview({
  projects,
  onOpen,
  onDetails,
}: {
  projects: ProjectView[];
  onOpen: (slug: string) => void;
  onDetails: (slug: string) => void;
}) {
  if (!projects.length) return <Empty text="No Kanban projects exist in Hermes." />;
  return (
    <Stack>
      <Group justify="space-between">
        <Box>
          <Title order={2}>Kanban overview</Title>
          <Text c="dimmed">All Kanban-based projects from Hermes.</Text>
        </Box>
        <Badge size="lg">{projects.length} projects</Badge>
      </Group>
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {projects.map((project) => (
          <Card withBorder key={project.slug}>
            <Group justify="space-between" align="flex-start">
              <Box>
                <Title order={3}>{project.name}</Title>
                <Text size="sm" c="dimmed">
                  <Code>{project.slug}</Code> · {project.status}
                </Text>
              </Box>
              <Badge color={project.status === 'archived' ? 'gray' : 'teal'}>
                {project.status}
              </Badge>
            </Group>
            <Text mt="sm" lineClamp={2}>
              {project.description || 'No project goal recorded.'}
            </Text>
            <Group mt="md" gap="xs">
              {lanes.map((lane) => (
                <Badge variant="light" key={lane}>
                  {lane} {project.counts[lane] ?? 0}
                </Badge>
              ))}
            </Group>
            <Group mt="lg">
              <Button onClick={() => onOpen(project.slug)}>Open Kanban</Button>
              <Button variant="light" onClick={() => onDetails(project.slug)}>
                Project setup
              </Button>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function ProjectPicker({
  projects,
  selected,
  onSelect,
}: {
  projects: ProjectView[];
  selected: string;
  onSelect: (slug: string) => void;
}) {
  return (
    <Select
      label="Kanban project"
      value={selected || null}
      onChange={(value) => value && onSelect(value)}
      data={projects.map((project) => ({ value: project.slug, label: project.name }))}
      searchable
    />
  );
}

function KanbanProject({
  projects,
  selected,
  tasks,
  onSelect,
  onDetails,
  onMutate,
  canManage,
  busy,
}: {
  projects: ProjectView[];
  selected: string;
  tasks: UnifiedResource[];
  onSelect: (slug: string) => void;
  onDetails: (slug: string) => void;
  onMutate: Mutate;
  canManage: boolean;
  busy: boolean;
}) {
  const visible = tasks.filter((task) => text(task.data.board) === selected);
  return (
    <Stack>
      <Group justify="space-between" align="end">
        <ProjectPicker projects={projects} selected={selected} onSelect={onSelect} />
        <Group>
          <Badge size="lg">{visible.length} cards</Badge>
          <Button variant="light" onClick={() => onDetails(selected)}>
            Project setup
          </Button>
        </Group>
      </Group>
      {!selected ? (
        <Empty text="Select a Kanban project." />
      ) : (
        <ScrollArea type="auto">
          <Group align="flex-start" wrap="nowrap" className="kanban ttrrbda-board">
            {lanes.map((lane) => {
              const cards = visible.filter((task) => taskLane(task) === lane);
              return (
                <Paper withBorder p="sm" key={lane} className="kanban-column">
                  <Group justify="space-between" mb="sm">
                    <Text fw={800}>{lane.toUpperCase()}</Text>
                    <Badge variant="light">{cards.length}</Badge>
                  </Group>
                  <Stack gap="sm">
                    {cards.map((task) => (
                      <TaskCard
                        key={task.resource.canonicalId}
                        task={task}
                        onMutate={onMutate}
                        canManage={canManage}
                        busy={busy}
                      />
                    ))}
                    {!cards.length && (
                      <Text size="sm" c="dimmed">
                        No cards
                      </Text>
                    )}
                  </Stack>
                </Paper>
              );
            })}
          </Group>
        </ScrollArea>
      )}
    </Stack>
  );
}

function TaskCard({
  task,
  onMutate,
  canManage,
  busy,
}: {
  task: UnifiedResource;
  onMutate: Mutate;
  canManage: boolean;
  busy: boolean;
}) {
  const lane = taskLane(task);
  const id = text(task.data.nativeId) || task.resource.nativeId;
  const action = async (name: 'start' | 'block' | 'unblock' | 'complete') => {
    await onMutate(
      mutation(`work.task.${name}`, 'task', id, {
        boardId: text(task.data.boardId) || text(task.data.projectSlug),
        expectedSourceVersion: task.resource.sourceVersion,
        ...(name === 'block' ? { reason: 'Blocked from UNIFY Work & Kanban' } : {}),
      }),
      `${name} succeeded for ${id}.`,
    );
  };
  return (
    <Card withBorder shadow="xs" className="work-task-card">
      <Text fw={700}>{task.title}</Text>
      <Text size="xs" c="dimmed">
        {id} · {text(task.data.assigneeProfile) || text(task.data.assignee) || 'unassigned'}
      </Text>
      {text(task.data.description) && (
        <Text size="sm" mt="xs" lineClamp={3}>
          {text(task.data.description)}
        </Text>
      )}
      {canManage && (
        <Group mt="sm" gap="xs">
          {lane === 'todo' && (
            <Button
              size="compact-xs"
              variant="light"
              loading={busy}
              onClick={() => void action('start')}
            >
              Promote to ready
            </Button>
          )}
          {lane !== 'blocked' && lane !== 'done' && lane !== 'archived' && (
            <Button
              size="compact-xs"
              color="red"
              variant="light"
              loading={busy}
              onClick={() => void action('block')}
            >
              Block
            </Button>
          )}
          {lane === 'blocked' && (
            <Button
              size="compact-xs"
              variant="light"
              loading={busy}
              onClick={() => void action('unblock')}
            >
              Unblock
            </Button>
          )}
          {!['done', 'archived'].includes(lane) && (
            <Button
              size="compact-xs"
              color="teal"
              variant="light"
              loading={busy}
              onClick={() => void action('complete')}
            >
              Complete
            </Button>
          )}
        </Group>
      )}
    </Card>
  );
}

function ProjectDetails({
  project,
  projects,
  onSelect,
  onMutate,
  canManage,
  busy,
}: {
  project: ProjectView | undefined;
  projects: ProjectView[];
  onSelect: (slug: string) => void;
  onMutate: Mutate;
  canManage: boolean;
  busy: boolean;
}) {
  const [form, setForm] = useState<ProjectForm>(() => projectForm(project));
  useEffect(() => setForm(projectForm(project)), [project?.slug]);
  if (!project) return <Empty text="No Kanban project selected." />;
  const update = (key: keyof ProjectForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = () =>
    onMutate(
      mutation('work.project.rename', 'project', project.slug, {
        name: form.name.trim(),
        expectedSourceVersion: project.sourceVersion,
      }),
      `Updated project ${project.slug}.`,
    );
  return (
    <Stack>
      <Group justify="space-between" align="end">
        <ProjectPicker projects={projects} selected={project.slug} onSelect={onSelect} />
        <Badge>{project.status}</Badge>
      </Group>
      <Card withBorder>
        <Title order={2}>Kanban project details</Title>
        <Text c="dimmed">Hermes owns project identity, its board, and all task state.</Text>
        <SimpleGrid cols={{ base: 1, md: 2 }} mt="lg">
          <TextInput label="Project slug" value={form.slug} disabled />
          <TextInput
            label="Project name"
            value={form.name}
            disabled={!canManage}
            onChange={(event) => update('name', event.currentTarget.value)}
            required
          />
          <Textarea
            label="Project goal"
            value={form.goal}
            disabled
            onChange={(event) => update('goal', event.currentTarget.value)}
            minRows={4}
            className="work-form-wide"
          />
          <TextInput
            label="Default workspace path"
            value={form.workspace}
            disabled
            onChange={(event) => update('workspace', event.currentTarget.value)}
          />
          <TextInput
            label="Project manager agent"
            value={form.projectManager}
            disabled
            onChange={(event) => update('projectManager', event.currentTarget.value)}
          />
          <TextInput
            label="Project agents"
            description="Comma-separated agent profiles"
            value={form.agents}
            disabled
            onChange={(event) => update('agents', event.currentTarget.value)}
          />
        </SimpleGrid>
        <Divider my="lg" />
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <Paper withBorder p="md">
            <Text fw={700}>Schedule</Text>
            <Text size="sm">{text(project.data.schedule) || 'none'}</Text>
          </Paper>
          <Paper withBorder p="md">
            <Text fw={700}>Workspace</Text>
            <Text size="sm" lineClamp={2}>
              {form.workspace || 'not set'}
            </Text>
          </Paper>
          <Paper withBorder p="md">
            <Text fw={700}>Activity</Text>
            <Text size="sm">
              {formatDate(text(project.data.latestActivity) || text(project.data.updatedAt))}
            </Text>
          </Paper>
        </SimpleGrid>
        {canManage && (
          <Group mt="lg">
            <Button loading={busy} onClick={() => void save()}>
              Save project setup
            </Button>
            <Button
              variant="light"
              color="red"
              loading={busy}
              onClick={() =>
                void onMutate(
                  mutation(
                    'work.project.archive',
                    'project',
                    project.slug,
                    { expectedSourceVersion: project.sourceVersion },
                    true,
                  ),
                  `Archived ${project.slug}.`,
                )
              }
            >
              Archive
            </Button>
          </Group>
        )}
      </Card>
    </Stack>
  );
}

function AddNew({
  projects,
  selectedProject,
  onMutate,
  onCreated,
  canManage,
  busy,
}: {
  projects: ProjectView[];
  selectedProject: string;
  onMutate: Mutate;
  onCreated: (slug: string) => void;
  canManage: boolean;
  busy: boolean;
}) {
  const [kind, setKind] = useState<'project' | 'task'>('project');
  const [project, setProject] = useState<ProjectForm>({
    slug: '',
    name: '',
    goal: '',
    workspace: '',
    projectManager: '',
    agents: '',
  });
  const [task, setTask] = useState<TaskForm>({
    title: '',
    prompt: '',
    project: selectedProject,
    agent: '',
    priority: 'normal',
  });
  useEffect(
    () => setTask((current) => ({ ...current, project: current.project || selectedProject })),
    [selectedProject],
  );
  if (!canManage)
    return (
      <Alert color="yellow">
        Your account has read-only Work access. Project and task creation requires{' '}
        <Code>work.manage</Code>.
      </Alert>
    );
  const saveProject = async (start: boolean) => {
    const slug = project.slug.trim() || slugify(project.name);
    if (!project.name.trim()) return;
    if (start && (!project.goal.trim() || !project.projectManager.trim() || !project.agents.trim()))
      return;
    const result = await onMutate(
      mutation('work.project.create', 'project', slug, projectPayload({ ...project, slug }, start)),
      start ? `Saved ${slug} and activated planning.` : `Saved ${slug}.`,
    );
    if (result) onCreated(slug);
  };
  const saveTask = async (start: boolean) => {
    if (!task.title.trim() || !task.project) return;
    const result = await onMutate(
      mutation('work.task.create', 'task', slugify(task.title), {
        title: task.title,
        body: task.prompt,
        boardId: task.project,
        assignee: task.agent || undefined,
        priority: task.priority,
        triage: !start,
      }),
      `Created ${task.title}.`,
    );
    const created = record(ownerResult(result).task);
    const id = text(created.nativeId) || text(created.id);
    if (start && id)
      await onMutate(
        mutation('work.task.start', 'task', id, { boardId: task.project }),
        `Created and promoted ${task.title} to ready.`,
      );
  };
  return (
    <Card withBorder>
      <Group justify="space-between">
        <Box>
          <Title order={2}>Add new</Title>
          <Text c="dimmed">Create a Hermes project or a Kanban task related to it.</Text>
        </Box>
        <IconPlus size={26} />
      </Group>
      <SegmentedControl
        mt="lg"
        value={kind}
        onChange={(value) => setKind(value as 'project' | 'task')}
        data={[
          { value: 'project', label: 'Project' },
          { value: 'task', label: 'Task' },
        ]}
      />
      {kind === 'project' ? (
        <Stack mt="lg">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <TextInput
              label="Project name"
              required
              value={project.name}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setProject((current) => ({ ...current, name: value }));
              }}
            />
            <TextInput
              label="Project slug optional"
              placeholder={slugify(project.name)}
              value={project.slug}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setProject((current) => ({ ...current, slug: value }));
              }}
            />
            <Textarea
              label="Project goal"
              minRows={4}
              value={project.goal}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setProject((current) => ({ ...current, goal: value }));
              }}
            />
            <TextInput
              label="Default workspace path"
              value={project.workspace}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setProject((current) => ({ ...current, workspace: value }));
              }}
            />
            <TextInput
              label="Project manager agent"
              value={project.projectManager}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setProject((current) => ({ ...current, projectManager: value }));
              }}
            />
            <TextInput
              label="Project agents"
              description="Comma-separated profiles"
              value={project.agents}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setProject((current) => ({ ...current, agents: value }));
              }}
            />
          </SimpleGrid>
          <Group>
            <Button
              variant="light"
              loading={busy}
              disabled={!project.name.trim()}
              onClick={() => void saveProject(false)}
            >
              Save
            </Button>
            <Button
              loading={busy}
              disabled={
                !project.name.trim() ||
                !project.goal.trim() ||
                !project.projectManager.trim() ||
                !project.agents.trim()
              }
              onClick={() => void saveProject(true)}
            >
              Save and Start
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Save requires a project name only. Save and Start requires name, goal, project manager
            and agents.
          </Text>
        </Stack>
      ) : (
        <Stack mt="lg">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <TextInput
              label="Task name"
              required
              value={task.title}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setTask((current) => ({ ...current, title: value }));
              }}
            />
            <Select
              label="Project"
              required
              value={task.project || null}
              onChange={(value) => setTask((current) => ({ ...current, project: value ?? '' }))}
              data={projects.map((item) => ({ value: item.slug, label: item.name }))}
            />
            <Textarea
              label="Prompt"
              minRows={4}
              value={task.prompt}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setTask((current) => ({ ...current, prompt: value }));
              }}
            />
            <TextInput
              label="Assigned agent"
              value={task.agent}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setTask((current) => ({ ...current, agent: value }));
              }}
            />
            <Select
              label="Priority"
              value={task.priority}
              onChange={(value) =>
                setTask((current) => ({ ...current, priority: value ?? 'normal' }))
              }
              data={['low', 'normal', 'high', 'urgent']}
            />
          </SimpleGrid>
          <Group>
            <Button
              variant="light"
              loading={busy}
              disabled={!task.title.trim() || !task.project}
              onClick={() => void saveTask(false)}
            >
              Save Draft
            </Button>
            <Button
              loading={busy}
              disabled={!task.title.trim() || !task.project}
              onClick={() => void saveTask(true)}
            >
              Promote to ready
            </Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}

function Cronjobs({
  jobs,
  onMutate,
  canManage,
  busy,
}: {
  jobs: UnifiedResource[];
  onMutate: Mutate;
  canManage: boolean;
  busy: boolean;
}) {
  const [filter, setFilter] = useState('all');
  const [opened, setOpened] = useState(false);
  const [form, setForm] = useState<CronForm>({
    name: '',
    title: '',
    prompt: '',
    mode: 'every',
    schedule: 'every 1d',
    timezone: 'UTC',
  });
  const scheduleValid =
    form.mode !== 'at' ||
    (Boolean(form.schedule) && !Number.isNaN(new Date(form.schedule).getTime()));
  const visible = jobs.filter(
    (job) =>
      filter === 'all' ||
      (filter === 'active'
        ? !cronPaused(job) && !cronFailed(job)
        : filter === 'paused'
          ? cronPaused(job)
          : cronFailed(job)),
  );
  const action = (job: UnifiedResource, name: 'run' | 'pause' | 'resume' | 'delete') =>
    onMutate(
      mutation(
        `work.cron.${name}`,
        'cronjob',
        text(job.data.nativeId) || job.resource.nativeId,
        { expectedSourceVersion: job.resource.sourceVersion },
        name === 'delete',
      ),
      `${name} succeeded for ${job.title}.`,
    );
  const create = async () => {
    if (!scheduleValid) return;
    const schedule = form.mode === 'at' ? new Date(form.schedule).toISOString() : form.schedule;
    const result = await onMutate(
      mutation('work.cron.create', 'cronjob', form.name || slugify(form.title), {
        name: form.name || form.title,
        prompt: form.prompt,
        schedule,
        deliver: 'local',
      }),
      `Created cronjob ${form.title}.`,
    );
    if (result) setOpened(false);
  };
  return (
    <Stack>
      <Group justify="space-between">
        <Box>
          <Title order={2}>Cronjobs</Title>
          <Text c="dimmed">
            Single-task repeating or scheduled jobs owned by native Hermes cron.
          </Text>
        </Box>
        {canManage && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setOpened(true)}>
            New Cronjob
          </Button>
        )}
      </Group>
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        data={[
          { value: 'all', label: `All ${jobs.length}` },
          {
            value: 'active',
            label: `Active ${jobs.filter((job) => !cronPaused(job) && !cronFailed(job)).length}`,
          },
          { value: 'paused', label: `Paused ${jobs.filter(cronPaused).length}` },
          { value: 'failed', label: `Failed ${jobs.filter(cronFailed).length}` },
        ]}
      />
      {!visible.length ? (
        <Empty text="No cronjobs match this filter." />
      ) : (
        <Paper withBorder>
          <ScrollArea>
            <Table verticalSpacing="sm" miw={760}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Job</Table.Th>
                  <Table.Th>Schedule</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Next run</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map((job) => (
                  <Table.Tr key={job.resource.canonicalId}>
                    <Table.Td>
                      <Text fw={700}>{job.title}</Text>
                      <Text size="xs" c="dimmed">
                        {job.resource.nativeId}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Code>{scheduleText(job.data.schedule)}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={cronFailed(job) ? 'red' : cronPaused(job) ? 'yellow' : 'teal'}>
                        {cronFailed(job)
                          ? 'failed'
                          : cronPaused(job)
                            ? 'paused'
                            : text(job.data.status) || 'active'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatDate(text(job.data.nextRunAt))}</Table.Td>
                    <Table.Td>
                      {canManage && (
                        <Group gap="xs">
                          <Button
                            size="compact-xs"
                            variant="light"
                            loading={busy}
                            onClick={() => void action(job, 'run')}
                          >
                            Run now
                          </Button>
                          {cronPaused(job) ? (
                            <Button
                              size="compact-xs"
                              variant="light"
                              loading={busy}
                              onClick={() => void action(job, 'resume')}
                            >
                              Resume
                            </Button>
                          ) : (
                            <Button
                              size="compact-xs"
                              variant="light"
                              loading={busy}
                              onClick={() => void action(job, 'pause')}
                            >
                              Pause
                            </Button>
                          )}
                          <Button
                            size="compact-xs"
                            color="red"
                            variant="subtle"
                            loading={busy}
                            onClick={() => void action(job, 'delete')}
                          >
                            Remove
                          </Button>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      )}
      <Modal opened={opened} onClose={() => setOpened(false)} title="Create Cronjob" size="lg">
        <Stack>
          <TextInput
            label="Cronjob name"
            required
            value={form.name}
            onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({ ...current, name: value }));
              }}
          />
          <TextInput
            label="Title"
            required
            value={form.title}
            onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({ ...current, title: value }));
              }}
          />
          <Textarea
            label="Prompt"
            required
            minRows={4}
            value={form.prompt}
            onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({ ...current, prompt: value }));
              }}
          />
          <Select
            label="Schedule mode"
            value={form.mode}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                mode: (value ?? 'every') as CronForm['mode'],
                schedule: value === 'cron' ? '0 9 * * *' : value === 'at' ? '' : 'every 1d',
              }))
            }
            data={[
              { value: 'at', label: 'One-time date/time' },
              { value: 'every', label: 'Recurring interval' },
              { value: 'cron', label: 'Advanced cron expression' },
            ]}
          />
          <TextInput
            label={
              form.mode === 'at'
                ? 'Run date/time'
                : form.mode === 'every'
                  ? 'Repeat interval'
                  : 'Cron expression'
            }
            type={form.mode === 'at' ? 'datetime-local' : 'text'}
            value={form.schedule}
            onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({ ...current, schedule: value }));
              }}
          />
          <TextInput
            label="Timezone"
            description="Hermes cron currently uses its configured scheduler timezone."
            value={form.timezone}
            disabled
          />
          <Button
            loading={busy}
            disabled={!form.title || !form.prompt || !form.schedule || !scheduleValid}
            onClick={() => void create()}
          >
            Save Cronjob
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

function FederationView({
  frameworkId,
  tasks,
  leases,
  workerProfiles,
  canManage,
  loading,
  failure,
  onReload,
}: {
  frameworkId: string;
  tasks: UnifiedResource[];
  leases: FederationLease[];
  workerProfiles: Array<{ id: string; displayName: string }>;
  canManage: boolean;
  loading: boolean;
  failure?: string | undefined;
  onReload: () => Promise<void>;
}) {
  const eligible = tasks.filter((task) => ['triage', 'todo', 'ready'].includes(taskLane(task)));
  const [taskId, setTaskId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailure, setSubmitFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const selectedTask = eligible.find((task) => task.resource.nativeId === taskId);

  useEffect(() => {
    if (!taskId && eligible[0]) setTaskId(eligible[0].resource.nativeId);
  }, [eligible, taskId]);
  useEffect(() => {
    if (!profileId && workerProfiles[0]) setProfileId(workerProfiles[0].id);
  }, [profileId, workerProfiles]);
  useEffect(() => {
    if (selectedTask && !prompt)
      setPrompt(
        text(selectedTask.data.description) || selectedTask.title || selectedTask.resource.nativeId,
      );
  }, [prompt, selectedTask]);

  const changeIntent = (apply: () => void) => {
    apply();
    setConfirmed(false);
    setNotice(undefined);
    setSubmitFailure(undefined);
    setIdempotencyKey(crypto.randomUUID());
  };

  const delegate = async () => {
    if (
      !selectedTask ||
      !profileId ||
      !prompt.trim() ||
      !confirmed ||
      frameworkId !== 'hermes-alica'
    )
      return;
    setSubmitting(true);
    setSubmitFailure(undefined);
    setNotice(undefined);
    try {
      const response = await gateway.createFederationLease(
        {
          sourceFrameworkId: 'hermes-alica',
          sourceBoardId: text(selectedTask.data.boardId),
          sourceTaskId: selectedTask.resource.nativeId,
          sourceSourceVersion: selectedTask.resource.sourceVersion ?? '',
          workerFrameworkId: 'hermes-herman',
          workerProfileId: profileId,
          prompt: prompt.trim(),
        },
        idempotencyKey,
      );
      setNotice(
        response.replayed
          ? `Lease ${response.lease.id} was safely replayed without another worker execution.`
          : `Lease ${response.lease.id} reached ${response.lease.status}/${response.lease.stage}.`,
      );
      setConfirmed(false);
      setIdempotencyKey(crypto.randomUUID());
      await onReload();
    } catch (error) {
      setSubmitFailure(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canManage)
    return (
      <Alert color="yellow" title="Federation is restricted">
        Bounded Alica → Herman delegation requires <Code>work.manage</Code>.
      </Alert>
    );

  return (
    <Stack>
      <Box>
        <Title order={2}>Bounded Alica → Herman delegation</Title>
        <Text c="dimmed">
          Delegate one canonical Alica card to one selected native Herman profile. Alica keeps the
          only board card; UNIFY persists the lease and never accepts caller-supplied results.
        </Text>
      </Box>
      {frameworkId !== 'hermes-alica' && (
        <Alert color="yellow" title="Select Alica as the source framework">
          This contract is intentionally fixed to <Code>hermes-alica</Code> →{' '}
          <Code>hermes-herman</Code>. Select Alica above to choose an eligible source card.
        </Alert>
      )}
      {failure && (
        <Alert color="red" title="Federation inventory unavailable">
          {failure}
        </Alert>
      )}
      {submitFailure && (
        <Alert color="red" title="Delegation failed">
          {submitFailure} The same idempotency key is retained for a safe retry.
        </Alert>
      )}
      {notice && (
        <Alert color="teal" title="Delegation recorded">
          {notice}
        </Alert>
      )}
      <Card withBorder>
        <Stack>
          <Select
            label="Canonical Alica card"
            value={taskId || null}
            data={eligible.map((task) => ({
              value: task.resource.nativeId,
              label: `${text(task.data.boardId)} · ${task.title}`,
            }))}
            onChange={(value) =>
              changeIntent(() => {
                setTaskId(value ?? '');
                const task = eligible.find((item) => item.resource.nativeId === value);
                setPrompt(task ? text(task.data.description) || task.title : '');
              })
            }
            disabled={frameworkId !== 'hermes-alica' || loading}
            searchable
            nothingFoundMessage="No triage, todo, or ready Alica cards"
          />
          <Select
            label="Native Herman worker profile"
            value={profileId || null}
            data={workerProfiles.map((profile) => ({
              value: profile.id,
              label: `${profile.displayName} (${profile.id})`,
            }))}
            onChange={(value) => changeIntent(() => setProfileId(value ?? ''))}
            disabled={loading}
            searchable
          />
          <Textarea
            label="Worker prompt"
            description="This prompt is sent to the selected Herman profile. Result fields cannot be supplied by the browser."
            minRows={5}
            value={prompt}
            onChange={(event) => changeIntent(() => setPrompt(event.currentTarget.value))}
          />
          <Checkbox
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            label="I confirm this exact Alica card and Herman profile delegation"
          />
          <Button
            loading={submitting}
            disabled={
              frameworkId !== 'hermes-alica' ||
              !selectedTask ||
              !profileId ||
              !prompt.trim() ||
              !confirmed ||
              loading
            }
            onClick={() => void delegate()}
          >
            Delegate exact card
          </Button>
        </Stack>
      </Card>
      <Group justify="space-between">
        <Title order={3}>Durable federation leases</Title>
        <Button variant="light" loading={loading} onClick={() => void onReload()}>
          Refresh leases
        </Button>
      </Group>
      {loading && !leases.length ? (
        <Paper withBorder p="lg">
          <Group justify="center">
            <Loader size="sm" />
            <Text>Loading durable leases…</Text>
          </Group>
        </Paper>
      ) : !leases.length ? (
        <Empty text="No durable federation leases exist." />
      ) : (
        <Paper withBorder>
          <ScrollArea type="auto">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Lease</Table.Th>
                  <Table.Th>Source card</Table.Th>
                  <Table.Th>Worker profile</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Updated</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {leases.map((lease) => (
                  <Table.Tr key={lease.id}>
                    <Table.Td>
                      <Code>{lease.id}</Code>
                    </Table.Td>
                    <Table.Td>
                      {lease.source.boardId} · <Code>{lease.source.taskId}</Code>
                    </Table.Td>
                    <Table.Td>
                      {lease.worker.frameworkId} · <Code>{lease.worker.profileId}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={
                          lease.status === 'completed'
                            ? 'teal'
                            : lease.status === 'failed'
                              ? 'red'
                              : 'blue'
                        }
                      >
                        {lease.status} / {lease.stage}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatDate(lease.updatedAt)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  );
}

function NotificationSettings() {
  return (
    <Stack>
      <Title order={2}>Settings</Title>
      <Alert color="yellow" title="Authoritative notification settings unavailable">
        The selected Hermes Work contract does not expose notification-rule inventory or mutation.
        UNIFY therefore does not store browser-only fallback rules or raw delivery targets. Cronjob
        delivery remains the authoritative metadata returned by Hermes.
      </Alert>
    </Stack>
  );
}

type Mutate = (request: MutationRequest, success: string) => Promise<unknown>;

async function loadHermesWork(frameworkId: string): Promise<Collection<UnifiedResource>> {
  const [projects, boards, cronjobs] = await Promise.all([
    gateway.hermesProjects(frameworkId),
    gateway.hermesBoards(frameworkId),
    gateway.hermesCronjobs(frameworkId),
  ]);
  const taskCollections = await Promise.all(
    boards.items.map(async (board) => ({
      boardId: text(board.id),
      response: await gateway.hermesTasks(frameworkId, text(board.id)),
    })),
  );
  const items: UnifiedResource[] = [];
  const add = (
    kind: string,
    item: Record<string, unknown>,
    title: string,
    sourceVersion: string,
  ) => {
    const nativeId = text(item.id);
    const observedAt = new Date().toISOString();
    items.push({
      resource: {
        canonicalId: `${frameworkId}:${kind}:${nativeId}`,
        kind,
        owner: 'hermes',
        nativeId,
        observedAt,
        displayLabel: title,
        sourceVersion,
      },
      truth: 'current',
      authoritative: true,
      adapterId: 'hermes-control',
      fetchedAt: observedAt,
      title,
      searchableText: `${title} ${nativeId}`,
      data: { ...item, nativeId },
    });
  };
  for (const project of projects.items)
    add(
      'project',
      {
        ...project,
        slug: project.id,
        status: project.archived === true ? 'archived' : 'active',
      },
      text(project.name) || text(project.id),
      projects.meta.sourceVersion,
    );
  for (const board of boards.items)
    add(
      'kanban-board',
      {
        ...board,
        slug: board.id,
        status: board.archived === true ? 'archived' : 'active',
        countsByLane: board.counts,
      },
      text(board.name) || text(board.id),
      boards.meta.sourceVersion,
    );
  for (const collection of taskCollections)
    for (const task of collection.response.items) {
      const status = text(task.status);
      add(
        'task',
        {
          ...task,
          boardId: collection.boardId,
          board: collection.boardId,
          projectSlug: collection.boardId,
          lane: hermesTaskLane(status),
          description: task.body,
        },
        text(task.title) || text(task.id),
        collection.response.meta.sourceVersion,
      );
    }
  for (const cronjob of cronjobs.items)
    add('cronjob', cronjob, text(cronjob.name) || text(cronjob.id), cronjobs.meta.sourceVersion);
  return {
    items,
    meta: {
      requestId: crypto.randomUUID(),
      freshness: 'current',
      observedAt: projects.meta.generatedAt,
      generatedAt: new Date().toISOString(),
      warnings: [],
    },
  };
}

function hermesTaskLane(status: string) {
  return lanes.includes(status as (typeof lanes)[number]) ? status : 'triage';
}

function ownerResult(value: unknown) {
  return record(record(record(value).data).result);
}

type ProjectView = {
  slug: string;
  name: string;
  description: string;
  status: string;
  counts: Record<string, number>;
  data: Record<string, unknown>;
  sourceVersion: string;
};

function nativeProjects(items: UnifiedResource[]): ProjectView[] {
  const summaries = items.filter((item) => item.resource.kind === 'kanban-board');
  const controls = items.filter((item) => item.resource.kind === 'project');
  const map = new Map<string, ProjectView>();
  for (const item of [...controls, ...summaries]) {
    const slug = text(item.data.slug) || item.resource.nativeId;
    const current = map.get(slug);
    const counts = record(item.data.countsByLane);
    map.set(slug, {
      slug,
      name: text(item.data.name) || item.title || current?.name || slug,
      description: text(item.data.description) || current?.description || '',
      status:
        text(item.data.status) || text(item.data.lifecycleState) || current?.status || 'active',
      counts: Object.keys(counts).length ? numberRecord(counts) : (current?.counts ?? {}),
      data: { ...(current?.data ?? {}), ...item.data },
      sourceVersion: current?.sourceVersion ?? item.resource.sourceVersion ?? '',
    });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function taskLane(task: UnifiedResource): string {
  return text(task.data.lane) || 'triage';
}
function cronPaused(job: UnifiedResource): boolean {
  return (
    job.data.paused === true ||
    job.data.enabled === false ||
    ['paused', 'disabled'].includes(text(job.data.status))
  );
}
function cronFailed(job: UnifiedResource): boolean {
  return (
    ['failed', 'error'].includes(text(job.data.status)) || text(job.data.lastResult) === 'error'
  );
}
function projectForm(project?: ProjectView): ProjectForm {
  const agents = Array.isArray(project?.data.agentTeam)
    ? project!.data.agentTeam.map((item) => text(record(item).name)).filter(Boolean)
    : [];
  const defaults = record(project?.data.defaultAgents);
  return {
    slug: project?.slug ?? '',
    name: project?.name ?? '',
    goal: project?.description ?? '',
    workspace: text(project?.data.defaultWorkspacePath),
    projectManager: text(defaults.pm) || agents[0] || '',
    agents: agents.join(', '),
  };
}
function projectPayload(form: ProjectForm, startPmPlanning: boolean): Record<string, unknown> {
  const agents = form.agents
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const pm = form.projectManager.trim();
  return {
    slug: form.slug,
    name: form.name.trim(),
    description: form.goal.trim(),
    defaultWorkspacePath: form.workspace.trim() || undefined,
    projectManager: pm || undefined,
    agents: [...new Set([pm, ...agents].filter(Boolean))],
    startPmPlanning,
  };
}
function mutation(
  operationType: string,
  kind: string,
  nativeId: string,
  payload: Record<string, unknown>,
  confirmed = false,
): MutationRequest {
  return {
    operationType,
    target: { owner: 'hermes', kind, nativeId },
    payload,
    mode: 'execute',
    confirmed,
  };
}
function scheduleText(value: unknown): string {
  const schedule = record(value);
  if (text(schedule.kind) === 'at') return `at ${text(schedule.at)}`;
  if (text(schedule.kind) === 'every') return text(schedule.every);
  if (text(schedule.kind) === 'cron')
    return `${text(schedule.expression)} ${text(schedule.timezone) || 'UTC'}`;
  return text(value) || 'manual';
}
function workPageFromUrl(): WorkPage {
  const value = new URLSearchParams(window.location.search).get('workPage');
  return pageOptions.some((item) => item.value === value) ? (value as WorkPage) : 'overview';
}

function Empty({ text: value }: { text: string }) {
  return (
    <Paper withBorder p="xl">
      <Stack align="center">
        <IconClipboardList size={34} />
        <Text fw={700}>{value}</Text>
      </Stack>
    </Paper>
  );
}
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function numberRecord(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Number(item) || 0]));
}
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}
function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.failure.message
    : error instanceof Error
      ? error.message
      : 'Native work request failed';
}
