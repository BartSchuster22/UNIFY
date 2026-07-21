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
import {
  IconActivity,
  IconCalendar,
  IconClipboardList,
  IconPlus,
  IconRefresh,
  IconSettings,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, gateway } from './api';
import type { Collection, MutationRequest, UnifiedResource } from './types';

type WorkPage = 'overview' | 'projects' | 'board' | 'details' | 'add' | 'cronjobs' | 'settings';
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

const lanes = ['triage', 'todo', 'ready', 'running', 'blocked', 'done', 'archived'] as const;
const pageOptions: Array<{ value: WorkPage; label: string }> = [
  { value: 'overview', label: 'Hermes overview' },
  { value: 'projects', label: 'Kanban overview' },
  { value: 'board', label: 'Kanban project' },
  { value: 'details', label: 'Project details' },
  { value: 'add', label: 'Add new' },
  { value: 'cronjobs', label: 'Cronjobs' },
  { value: 'settings', label: 'Settings' },
];

export function WorkView({ canManage }: { canManage: boolean }) {
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

  async function load() {
    setLoading(true);
    setFailure(undefined);
    try {
      const response = await loadHermesWork();
      setData(response);
      const projects = workerProjects(response.items);
      setSelectedProject((current) => current || projects[0]?.slug || '');
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const projects = useMemo(() => workerProjects(data.items), [data.items]);
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
    url.searchParams.set('view', 'work');
    url.searchParams.set('workPage', next);
    if (project) url.searchParams.set('project', project);
    else url.searchParams.delete('project');
    window.history.replaceState(null, '', url);
  }

  async function mutate(request: MutationRequest, success: string) {
    setBusy(true);
    setFailure(undefined);
    setNotice(undefined);
    try {
      const response = await gateway.mutate(request);
      setNotice(success);
      await load();
      return response.result;
    } catch (error) {
      setFailure(errorMessage(error));
      return undefined;
    } finally {
      setBusy(false);
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
        <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void load()}>
          Refresh
        </Button>
      </Group>

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
            <Text>Loading Worker data…</Text>
          </Group>
        </Paper>
      ) : (
        <>
          {page === 'overview' && (
            <WorkerOverview
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
              canManage={canManage}
              busy={busy}
            />
          )}
          {page === 'details' && (
            <ProjectDetails
              project={selected}
              projects={projects}
              onSelect={setSelectedProject}
              onMutate={mutate}
              canManage={canManage}
              busy={busy}
            />
          )}
          {page === 'add' && (
            <AddNew
              projects={projects}
              selectedProject={selected?.slug ?? ''}
              onMutate={mutate}
              onCreated={(slug) => navigate('board', slug)}
              canManage={canManage}
              busy={busy}
            />
          )}
          {page === 'cronjobs' && (
            <Cronjobs jobs={cronjobs} onMutate={mutate} canManage={canManage} busy={busy} />
          )}
          {page === 'settings' && <NotificationSettings />}
        </>
      )}
    </Stack>
  );
}

function WorkerOverview({
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
        <Card withBorder className="worker-summary-card">
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
        <Card withBorder className="worker-summary-card" onClick={() => onNavigate('projects')}>
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
        <Card withBorder className="worker-summary-card" onClick={() => onNavigate('cronjobs')}>
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
        ...(name === 'block' ? { reason: 'Blocked from UNIFY Work & Kanban' } : {}),
      }),
      `${name} succeeded for ${id}.`,
    );
  };
  return (
    <Card withBorder shadow="xs" className="worker-task-card">
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
      mutation('work.project.rename', 'project', project.slug, { name: form.name.trim() }),
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
                  mutation('work.project.archive', 'project', project.slug, {}, true),
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
              onChange={(event) =>
                setProject((current) => ({ ...current, name: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Project slug optional"
              placeholder={slugify(project.name)}
              value={project.slug}
              onChange={(event) =>
                setProject((current) => ({ ...current, slug: event.currentTarget.value }))
              }
            />
            <Textarea
              label="Project goal"
              minRows={4}
              value={project.goal}
              onChange={(event) =>
                setProject((current) => ({ ...current, goal: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Default workspace path"
              value={project.workspace}
              onChange={(event) =>
                setProject((current) => ({ ...current, workspace: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Project manager agent"
              value={project.projectManager}
              onChange={(event) =>
                setProject((current) => ({ ...current, projectManager: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Project agents"
              description="Comma-separated profiles"
              value={project.agents}
              onChange={(event) =>
                setProject((current) => ({ ...current, agents: event.currentTarget.value }))
              }
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
              onChange={(event) =>
                setTask((current) => ({ ...current, title: event.currentTarget.value }))
              }
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
              onChange={(event) =>
                setTask((current) => ({ ...current, prompt: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Assigned agent"
              value={task.agent}
              onChange={(event) =>
                setTask((current) => ({ ...current, agent: event.currentTarget.value }))
              }
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
        {},
        name === 'delete',
      ),
      `${name} succeeded for ${job.title}.`,
    );
  const create = async () => {
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
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.currentTarget.value }))
            }
          />
          <TextInput
            label="Title"
            required
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.currentTarget.value }))
            }
          />
          <Textarea
            label="Prompt"
            required
            minRows={4}
            value={form.prompt}
            onChange={(event) =>
              setForm((current) => ({ ...current, prompt: event.currentTarget.value }))
            }
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
            onChange={(event) =>
              setForm((current) => ({ ...current, schedule: event.currentTarget.value }))
            }
          />
          <TextInput
            label="Timezone"
            description="Hermes cron currently uses its configured scheduler timezone."
            value={form.timezone}
            disabled
          />
          <Button
            loading={busy}
            disabled={!form.title || !form.prompt || !form.schedule}
            onClick={() => void create()}
          >
            Save Cronjob
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

function NotificationSettings() {
  const [rules, setRules] = useState(() => notificationRules());
  const update = (key: keyof NotificationRules, value: string | boolean) =>
    setRules((current: NotificationRules) => ({ ...current, [key]: value }));
  const save = () => {
    localStorage.setItem('unify-worker-notification-rules', JSON.stringify(rules));
  };
  return (
    <Stack>
      <Group>
        <IconSettings size={26} />
        <Box>
          <Title order={2}>Settings</Title>
          <Text c="dimmed">Hermes Work notification rules setup.</Text>
        </Box>
      </Group>
      <Card withBorder>
        <Group justify="space-between">
          <Box>
            <Text size="xs" fw={800} tt="uppercase" c="dimmed">
              Notifications
            </Text>
            <Title order={3}>Notification rules setup</Title>
            <Text c="dimmed">
              Choose how Hermes project events surface in UNIFY and external channels.
            </Text>
          </Box>
          <IconActivity size={24} />
        </Group>
        <SimpleGrid cols={{ base: 1, md: 2 }} mt="lg">
          <Select
            label="Toast minimum severity"
            value={rules.severity}
            onChange={(value) => update('severity', value ?? 'warning')}
            data={[
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'critical', label: 'Critical' },
            ]}
          />
          <TextInput
            label="Telegram destination"
            value={rules.telegramDestination}
            onChange={(event) => update('telegramDestination', event.currentTarget.value)}
            placeholder="chat or topic ID"
          />
          <Checkbox
            label="UNIFY inbox and realtime"
            checked={rules.inbox}
            onChange={(event) => update('inbox', event.currentTarget.checked)}
          />
          <Checkbox
            label="Browser toast"
            checked={rules.toast}
            onChange={(event) => update('toast', event.currentTarget.checked)}
          />
          <Checkbox
            label="Telegram notifications"
            checked={rules.telegram}
            onChange={(event) => update('telegram', event.currentTarget.checked)}
          />
          <Checkbox
            label="Notify on blocked cards"
            checked={rules.blocked}
            onChange={(event) => update('blocked', event.currentTarget.checked)}
          />
          <Checkbox
            label="Notify on failed cronjobs"
            checked={rules.cronFailed}
            onChange={(event) => update('cronFailed', event.currentTarget.checked)}
          />
          <Checkbox
            label="Notify on project completion"
            checked={rules.completed}
            onChange={(event) => update('completed', event.currentTarget.checked)}
          />
        </SimpleGrid>
        <Group mt="lg">
          <Button onClick={save}>Save notification rules</Button>
          <Button
            variant="light"
            onClick={() => {
              const defaults = defaultNotificationRules();
              setRules(defaults);
              localStorage.setItem('unify-worker-notification-rules', JSON.stringify(defaults));
            }}
          >
            Reset notifications
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          These are UNIFY display rules. Project-specific Worker delivery targets remain part of
          each project setup.
        </Text>
      </Card>
    </Stack>
  );
}

type Mutate = (request: MutationRequest, success: string) => Promise<unknown>;

async function loadHermesWork(): Promise<Collection<UnifiedResource>> {
  const [projects, boards, cronjobs] = await Promise.all([
    gateway.hermesProjects(),
    gateway.hermesBoards(),
    gateway.hermesCronjobs(),
  ]);
  const taskCollections = await Promise.all(
    boards.items.map(async (board) => ({
      boardId: text(board.id),
      response: await gateway.hermesTasks(text(board.id)),
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
        canonicalId: `hermes-main:${kind}:${nativeId}`,
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
};
type NotificationRules = {
  severity: string;
  inbox: boolean;
  toast: boolean;
  telegram: boolean;
  telegramDestination: string;
  blocked: boolean;
  cronFailed: boolean;
  completed: boolean;
};

function workerProjects(items: UnifiedResource[]): ProjectView[] {
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
    target: { owner: 'hermes', kind, nativeId, frameworkId: 'hermes-main' },
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
function defaultNotificationRules(): NotificationRules {
  return {
    severity: 'warning',
    inbox: true,
    toast: true,
    telegram: false,
    telegramDestination: '',
    blocked: true,
    cronFailed: true,
    completed: false,
  };
}
function notificationRules(): NotificationRules {
  try {
    return {
      ...defaultNotificationRules(),
      ...record(JSON.parse(localStorage.getItem('unify-worker-notification-rules') ?? '{}')),
    } as NotificationRules;
  } catch {
    return defaultNotificationRules();
  }
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
      : 'Worker request failed';
}
