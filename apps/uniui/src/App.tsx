import {
  ActionIcon,
  Alert,
  AppShell,
  Avatar,
  Badge,
  Box,
  Burger,
  Button,
  Card,
  Center,
  Code,
  ColorSwatch,
  Divider,
  Group,
  Loader,
  MantineProvider,
  Menu,
  NavLink,
  Paper,
  PasswordInput,
  Pill,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Timeline,
  Title,
  Tooltip,
  createTheme,
} from '@mantine/core';
import { useDisclosure, useHotkeys, useMediaQuery } from '@mantine/hooks';
import {
  IconActivity,
  IconBell,
  IconBooks,
  IconBrain,
  IconChevronRight,
  IconClipboardList,
  IconDatabase,
  IconGauge,
  IconHistory,
  IconLogout,
  IconMessages,
  IconMoon,
  IconNetwork,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSun,
  IconUserCircle,
  IconUsers,
} from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, gateway } from './api';
import type {
  ApiFailure,
  Collection,
  Principal,
  ResponseMeta,
  SessionSummary,
  TruthState,
  UnifiedResource,
} from './types';
import '@mantine/core/styles.css';
import './styles.css';

type ViewId =
  | 'overview'
  | 'frameworks'
  | 'models'
  | 'profiles'
  | 'work'
  | 'chat'
  | 'memory'
  | 'audit'
  | 'operations'
  | 'notifications'
  | 'settings'
  | 'search';

type Icon = typeof IconGauge;
interface NavItem {
  id: ViewId;
  label: string;
  icon: Icon;
  permission?: string;
}
const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: IconGauge },
  { id: 'frameworks', label: 'Frameworks', icon: IconNetwork, permission: 'frameworks.read' },
  { id: 'models', label: 'Models & providers', icon: IconDatabase, permission: 'models.read' },
  { id: 'profiles', label: 'Profiles', icon: IconUsers, permission: 'profiles.read' },
  { id: 'work', label: 'Work & Kanban', icon: IconClipboardList, permission: 'work.read' },
  { id: 'chat', label: 'Chat', icon: IconMessages, permission: 'chat.read' },
  { id: 'memory', label: 'Memory', icon: IconBrain, permission: 'memory.read' },
  { id: 'audit', label: 'Audit', icon: IconShieldCheck, permission: 'audit.read' },
  { id: 'operations', label: 'Operations', icon: IconActivity, permission: 'operations.read' },
  { id: 'notifications', label: 'Notifications', icon: IconBell },
  { id: 'settings', label: 'Settings', icon: IconSettings },
];
const theme = createTheme({
  primaryColor: 'ocean',
  colors: {
    ocean: [
      '#e6f6ff',
      '#cce9f6',
      '#99d1ea',
      '#65b7df',
      '#3aa2d6',
      '#178fcf',
      '#0876ad',
      '#005e8c',
      '#004f76',
      '#003f60',
    ],
  },
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  headings: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  defaultRadius: 'md',
});

export function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<ViewId>('overview');
  const [query, setQuery] = useState('');
  const [dark, setDark] = useState(() => localStorage.getItem('unify-color-scheme') === 'dark');
  const [opened, { toggle, close }] = useDisclosure(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useHotkeys([
    ['mod+K', () => searchRef.current?.focus()],
    ['/', () => searchRef.current?.focus()],
  ]);
  useEffect(() => {
    gateway
      .me()
      .then(setPrincipal)
      .catch(() => setPrincipal(null))
      .finally(() => setAuthLoading(false));
  }, []);
  const changeView = (next: ViewId) => {
    setView(next);
    close();
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) changeView('search');
  };
  if (authLoading)
    return (
      <MantineProvider theme={theme} forceColorScheme={dark ? 'dark' : 'light'}>
        <BootState />
      </MantineProvider>
    );
  if (!principal)
    return (
      <MantineProvider theme={theme} forceColorScheme={dark ? 'dark' : 'light'}>
        <Login onLogin={setPrincipal} />
      </MantineProvider>
    );
  const visible = NAV.filter(
    (item) => !item.permission || principal.permissions.includes(item.permission),
  );
  return (
    <MantineProvider theme={theme} forceColorScheme={dark ? 'dark' : 'light'}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AppShell
        header={{ height: 64 }}
        navbar={{ width: 260, breakpoint: 'md', collapsed: { mobile: !opened } }}
        padding="md"
      >
        <AppShell.Header className="ui-header">
          <Group h="100%" px="md" justify="space-between" wrap="nowrap">
            <Group wrap="nowrap">
              <Burger
                opened={opened}
                onClick={toggle}
                hiddenFrom="md"
                size="sm"
                aria-label="Toggle navigation"
              />
              <Group gap="xs" wrap="nowrap">
                <ThemeIcon
                  size="lg"
                  variant="gradient"
                  gradient={{ from: 'ocean.7', to: 'cyan.5' }}
                >
                  <IconNetwork size={20} />
                </ThemeIcon>
                <Box>
                  <Text fw={800} lh={1}>
                    UNIFY
                  </Text>
                  <Text size="xs" c="dimmed">
                    Operator console
                  </Text>
                </Box>
              </Group>
            </Group>
            <Box component="form" onSubmit={search} className="global-search">
              <TextInput
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search every owner…"
                aria-label="Global search"
                leftSection={<IconSearch size={16} />}
                rightSection={<Code>⌘K</Code>}
              />
            </Box>
            <Group gap="xs" wrap="nowrap">
              <Tooltip label={`Use ${dark ? 'light' : 'dark'} theme`}>
                <ActionIcon
                  variant="subtle"
                  size="lg"
                  onClick={() => {
                    const next = !dark;
                    setDark(next);
                    localStorage.setItem('unify-color-scheme', next ? 'dark' : 'light');
                  }}
                  aria-label={`Use ${dark ? 'light' : 'dark'} theme`}
                >
                  {dark ? <IconSun size={19} /> : <IconMoon size={19} />}
                </ActionIcon>
              </Tooltip>
              <Menu position="bottom-end">
                <Menu.Target>
                  <ActionIcon variant="subtle" size="lg" aria-label="User menu">
                    <Avatar size={30} color="ocean">
                      {principal.displayName.slice(0, 2).toUpperCase()}
                    </Avatar>
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>{principal.displayName}</Menu.Label>
                  <Menu.Item
                    leftSection={<IconSettings size={16} />}
                    onClick={() => changeView('settings')}
                  >
                    Settings
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    leftSection={<IconLogout size={16} />}
                    onClick={() => void gateway.logout().finally(() => setPrincipal(null))}
                  >
                    Sign out
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Group>
        </AppShell.Header>
        <AppShell.Navbar p="sm" aria-label="Primary navigation">
          <AppShell.Section grow component={ScrollArea}>
            <Stack gap={3}>
              {visible.map((item) => (
                <NavLink
                  key={item.id}
                  active={view === item.id}
                  label={item.label}
                  leftSection={<item.icon size={18} />}
                  onClick={() => changeView(item.id)}
                  aria-current={view === item.id ? 'page' : undefined}
                />
              ))}
            </Stack>
          </AppShell.Section>
          <AppShell.Section>
            <Divider mb="sm" />
            <Group gap="sm" px="xs">
              <Avatar size="sm" color="ocean">
                <IconUserCircle size={18} />
              </Avatar>
              <Box>
                <Text size="sm" fw={600}>
                  {principal.displayName}
                </Text>
                <Text size="xs" c="dimmed">
                  {principal.roles.join(', ')}
                </Text>
              </Box>
            </Group>
          </AppShell.Section>
        </AppShell.Navbar>
        <AppShell.Main id="main-content" tabIndex={-1}>
          <View view={view} principal={principal} searchQuery={query} />
        </AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
}

function BootState() {
  return (
    <Center h="100vh">
      <Stack align="center">
        <Loader aria-label="Loading UNIFY" />
        <Text c="dimmed">Connecting to Gateway…</Text>
      </Stack>
    </Center>
  );
}

function Login({ onLogin }: { onLogin: (principal: Principal) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setFailure(null);
    try {
      onLogin(await gateway.login(username, password));
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-page">
      <Paper
        component="form"
        onSubmit={(event) => void submit(event)}
        shadow="xl"
        p="xl"
        radius="lg"
        className="login-card"
      >
        <Stack>
          <Group>
            <ThemeIcon size={46} variant="gradient" gradient={{ from: 'ocean.7', to: 'cyan.5' }}>
              <IconNetwork />
            </ThemeIcon>
            <Box>
              <Title order={1} size="h2">
                Welcome to UNIFY
              </Title>
              <Text c="dimmed">Sign in with your named operator account.</Text>
            </Box>
          </Group>
          {failure && (
            <Alert color="red" title="Sign-in failed" role="alert">
              {failure.message}
            </Alert>
          )}
          <TextInput
            label="Username"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            autoFocus
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <Button type="submit" loading={loading} fullWidth>
            Sign in
          </Button>
          <Text size="xs" c="dimmed">
            Your session is secured with HttpOnly cookies and CSRF protection.
          </Text>
        </Stack>
      </Paper>
    </main>
  );
}

function View({
  view,
  principal,
  searchQuery,
}: {
  view: ViewId;
  principal: Principal;
  searchQuery: string;
}) {
  switch (view) {
    case 'overview':
      return <Overview />;
    case 'frameworks':
      return (
        <ResourcesView
          title="Frameworks"
          description="Authoritative Agency framework inventory."
          owner="agency"
          kinds={['framework']}
        />
      );
    case 'models':
      return (
        <ResourcesView
          title="Models & providers"
          description="DMM catalog, provider availability, and model inventory."
          owner="dmm"
          kinds={['provider', 'model', 'catalog-snapshot']}
          grouped
        />
      );
    case 'profiles':
      return (
        <ResourcesView
          title="Profiles"
          description="Hermes profiles exposed by their authoritative owner."
          owner="hermes"
          kinds={['profile', 'agent']}
        />
      );
    case 'work':
      return <WorkView />;
    case 'chat':
      return <ChatView />;
    case 'memory':
      return <MemoryView />;
    case 'audit':
      return <AuditView />;
    case 'operations':
      return <OperationsView />;
    case 'notifications':
      return <NotificationsView />;
    case 'settings':
      return <Settings principal={principal} />;
    case 'search':
      return <SearchView query={searchQuery} />;
  }
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg">
      <Box>
        <Title order={1}>{title}</Title>
        <Text c="dimmed">{description}</Text>
      </Box>
      {action}
    </Group>
  );
}

function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setLoading(true);
    setFailure(null);
    api<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setFailure(toFailure(error));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [path, revision]);
  return { data, failure, loading, reload };
}

function TruthPanel({
  meta,
  loading,
  failure,
  empty,
  onRetry,
  children,
}: {
  meta?: ResponseMeta | undefined;
  loading: boolean;
  failure: ApiFailure | null;
  empty: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading && !meta)
    return (
      <Stack aria-label="Loading content">
        <Skeleton height={90} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </Stack>
    );
  if (failure)
    return (
      <Alert
        color={failure.retryable ? 'orange' : 'red'}
        title={`${failure.code}: data could not be loaded`}
        role="alert"
      >
        {failure.message}
        <Button variant="light" size="xs" mt="sm" onClick={onRetry}>
          Try again
        </Button>
      </Alert>
    );
  const state = meta?.freshness ?? (empty ? 'empty' : 'current');
  return (
    <Stack>
      <TruthBanner state={state} meta={meta} />
      {empty ? <EmptyState /> : children}
    </Stack>
  );
}

function TruthBanner({ state, meta }: { state: TruthState; meta?: ResponseMeta | undefined }) {
  const color: Record<TruthState, string> = {
    current: 'teal',
    stale: 'yellow',
    partial: 'orange',
    empty: 'gray',
    unavailable: 'red',
    unsupported: 'gray',
    forbidden: 'red',
    failed: 'red',
    inconclusive: 'yellow',
  };
  const needsBanner = state !== 'current';
  return (
    <Box aria-live="polite">
      {needsBanner && (
        <Alert
          color={color[state]}
          title={`Source state: ${state}`}
          icon={<IconShieldCheck size={18} />}
        >
          {state === 'empty'
            ? 'The authoritative owner responded successfully and currently has no records.'
            : 'This view is showing a truthful degraded state; data has not been silently omitted.'}
          {meta?.warnings.map((warning) => (
            <Text size="sm" key={warning.code}>
              <Code>{warning.code}</Code> {warning.message}
            </Text>
          ))}
        </Alert>
      )}
      {state === 'current' && (
        <Group gap="xs">
          <Badge color="teal" variant="light">
            Authoritative · current
          </Badge>
          {meta?.observedAt && (
            <Text size="xs" c="dimmed">
              Observed {formatDate(meta.observedAt)}
            </Text>
          )}
        </Group>
      )}
    </Box>
  );
}
function EmptyState() {
  return (
    <Paper withBorder p="xl">
      <Center>
        <Stack align="center" gap="xs">
          <IconBooks size={36} stroke={1.4} />
          <Text fw={600}>No records</Text>
          <Text size="sm" c="dimmed">
            The authoritative source is available but returned an empty collection.
          </Text>
        </Stack>
      </Center>
    </Paper>
  );
}

function Overview() {
  const status = useData<{
    items: Array<{
      adapterId: string;
      owners: string[];
      status: TruthState;
      resourceCount: number;
      observedAt?: string;
      warnings: Array<{ code: string; message: string }>;
    }>;
  }>('/integrations');
  const notifications = useData<Collection<{ id: string }>>('/notifications?limit=1');
  return (
    <>
      <PageHeading
        title="Operational overview"
        description="A truthful, read-only view across every authoritative owner."
        action={
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={status.reload}>
            Refresh
          </Button>
        }
      />
      <TruthPanel
        loading={status.loading}
        failure={status.failure}
        empty={Boolean(status.data && status.data.items.length === 0)}
        onRetry={status.reload}
      >
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {status.data?.items.map((item) => (
            <Card withBorder key={item.adapterId}>
              <Group justify="space-between">
                <ThemeIcon variant="light">
                  <IconNetwork size={18} />
                </ThemeIcon>
                <StateBadge state={item.status} />
              </Group>
              <Text fw={700} mt="md">
                {item.owners.join(' + ')}
              </Text>
              <Text size="xl" fw={800}>
                {item.resourceCount.toLocaleString()}
              </Text>
              <Text size="xs" c="dimmed">
                authoritative resources
              </Text>
              {item.observedAt && (
                <Text size="xs" mt="sm">
                  Observed {formatDate(item.observedAt)}
                </Text>
              )}
            </Card>
          ))}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, md: 2 }} mt="lg">
          <Card withBorder>
            <Text fw={700}>Notification inbox</Text>
            <Text size="2rem" fw={800}>
              {notifications.data?.items.length ?? '—'}
            </Text>
            <Text c="dimmed" size="sm">
              Visible source notifications on this page
            </Text>
          </Card>
          <Card withBorder>
            <Text fw={700}>Safety posture</Text>
            <Group mt="md">
              <Badge color="teal">Read-only federation</Badge>
              <Badge color="blue">Named session</Badge>
              <Badge color="violet">Owner RBAC</Badge>
            </Group>
          </Card>
        </SimpleGrid>
      </TruthPanel>
    </>
  );
}
function StateBadge({ state }: { state: TruthState }) {
  const color =
    state === 'current'
      ? 'teal'
      : state === 'empty'
        ? 'gray'
        : state === 'partial'
          ? 'orange'
          : 'red';
  return (
    <Badge color={color} variant="light">
      {state}
    </Badge>
  );
}

function ResourcesView({
  title,
  description,
  owner,
  kinds,
  grouped = false,
}: {
  title: string;
  description: string;
  owner: string;
  kinds: string[];
  grouped?: boolean;
}) {
  const [kind, setKind] = useState(kinds[0] ?? '');
  const params = new URLSearchParams({ owner, kind, limit: '500' });
  const result = useData<Collection<UnifiedResource>>(`/resources?${params}`);
  return (
    <>
      <PageHeading
        title={title}
        description={description}
        action={
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={result.reload}>
            Refresh
          </Button>
        }
      />
      {kinds.length > 1 && (
        <SegmentedControl
          mb="md"
          fullWidth={useMediaQuery('(max-width: 48em)')}
          value={kind}
          onChange={setKind}
          data={kinds.map((value) => ({ value, label: label(value) }))}
          aria-label={`${title} resource type`}
        />
      )}
      <TruthPanel
        meta={result.data?.meta}
        loading={result.loading}
        failure={result.failure}
        empty={Boolean(result.data && result.data.items.length === 0)}
        onRetry={result.reload}
      >
        {grouped ? (
          <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
            {result.data?.items.map((item) => (
              <ResourceCard key={item.resource.canonicalId} item={item} />
            ))}
          </SimpleGrid>
        ) : (
          <ResourceTable items={result.data?.items ?? []} />
        )}
      </TruthPanel>
    </>
  );
}
function ResourceCard({ item }: { item: UnifiedResource }) {
  return (
    <Card withBorder>
      <Group justify="space-between">
        <Badge variant="light">{label(item.resource.kind)}</Badge>
        <StateBadge state={item.truth} />
      </Group>
      <Text fw={700} mt="sm" lineClamp={2}>
        {item.title}
      </Text>
      <Text size="xs" c="dimmed" mt="xs">
        {item.resource.owner} · {item.resource.nativeId}
      </Text>
      <Group mt="md" gap="xs">
        {summaryFields(item.data).map(([key, value]) => (
          <Pill key={key}>
            {label(key)}: {value}
          </Pill>
        ))}
      </Group>
    </Card>
  );
}
function ResourceTable({ items }: { items: UnifiedResource[] }) {
  return (
    <ScrollArea>
      <Table striped highlightOnHover verticalSpacing="sm" miw={680}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Resource</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Owner</Table.Th>
            <Table.Th>Truth</Table.Th>
            <Table.Th>Observed</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item) => (
            <Table.Tr key={item.resource.canonicalId}>
              <Table.Td>
                <Text fw={600}>{item.title}</Text>
                <Text size="xs" c="dimmed">
                  {item.resource.nativeId}
                </Text>
              </Table.Td>
              <Table.Td>{label(item.resource.kind)}</Table.Td>
              <Table.Td>{item.resource.owner}</Table.Td>
              <Table.Td>
                <StateBadge state={item.truth} />
              </Table.Td>
              <Table.Td>{formatDate(item.resource.observedAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function WorkView() {
  const [mode, setMode] = useState('board');
  const result = useData<Collection<UnifiedResource>>('/resources?owner=worker&limit=500');
  const tasks = result.data?.items.filter((item) => item.resource.kind === 'task') ?? [];
  const columns = ['backlog', 'todo', 'in-progress', 'review', 'done'];
  return (
    <>
      <PageHeading
        title="Work & Kanban"
        description="Projects, boards, tasks, and schedules owned by Worker."
        action={
          <SegmentedControl
            value={mode}
            onChange={setMode}
            data={[
              { value: 'board', label: 'Board' },
              { value: 'list', label: 'List' },
            ]}
          />
        }
      />
      <TruthPanel
        meta={result.data?.meta}
        loading={result.loading}
        failure={result.failure}
        empty={Boolean(result.data && result.data.items.length === 0)}
        onRetry={result.reload}
      >
        {mode === 'list' ? (
          <ResourceTable items={result.data?.items ?? []} />
        ) : (
          <ScrollArea type="auto">
            <Group align="flex-start" wrap="nowrap" className="kanban">
              {columns.map((column) => {
                const matching = tasks.filter((task) => taskStatus(task) === column);
                return (
                  <Paper withBorder p="sm" key={column} className="kanban-column">
                    <Group justify="space-between" mb="sm">
                      <Text fw={700}>{label(column)}</Text>
                      <Badge variant="light">{matching.length}</Badge>
                    </Group>
                    <Stack>
                      {matching.map((task) => (
                        <Card withBorder shadow="xs" key={task.resource.canonicalId}>
                          <Text fw={600}>{task.title}</Text>
                          <Text size="xs" c="dimmed">
                            {task.resource.nativeId}
                          </Text>
                        </Card>
                      ))}
                    </Stack>
                  </Paper>
                );
              })}
            </Group>
          </ScrollArea>
        )}
      </TruthPanel>
    </>
  );
}

function ChatView() {
  const [session, setSession] = useState('all');
  const sessions = useData<Collection<UnifiedResource>>(
    '/resources?owner=chat&kind=chat-session&limit=100',
  );
  const messages = useData<Collection<UnifiedResource>>(
    '/resources?owner=chat&kind=chat-message&limit=500',
  );
  const shown = (messages.data?.items ?? []).filter(
    (item) =>
      session === 'all' || String(item.data.session_id ?? item.data.sessionId ?? '') === session,
  );
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: shown.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 92,
    overscan: 8,
  });
  return (
    <>
      <PageHeading
        title="Chat"
        description="Virtualized, read-only message history from the authoritative Chat service."
      />
      <SimpleGrid cols={{ base: 1, md: 4 }}>
        <Paper withBorder p="sm">
          <Text fw={700} mb="sm">
            Sessions
          </Text>
          <ScrollArea h={{ base: 180, md: 560 }}>
            <NavLink
              active={session === 'all'}
              label="All sessions"
              onClick={() => setSession('all')}
            />
            {sessions.data?.items.map((item) => (
              <NavLink
                key={item.resource.canonicalId}
                active={session === item.resource.nativeId}
                label={item.title}
                description={item.resource.nativeId}
                onClick={() => setSession(item.resource.nativeId)}
              />
            ))}
          </ScrollArea>
        </Paper>
        <Box style={{ gridColumn: 'span 3' }}>
          <TruthPanel
            meta={messages.data?.meta}
            loading={messages.loading}
            failure={messages.failure}
            empty={Boolean(messages.data && shown.length === 0)}
            onRetry={messages.reload}
          >
            <div
              ref={parent}
              className="virtual-list"
              aria-label="Virtualized Chat messages"
              role="log"
            >
              <div style={{ height: virtual.getTotalSize(), width: '100%', position: 'relative' }}>
                {virtual.getVirtualItems().map((row) => {
                  const item = shown[row.index];
                  if (!item) return null;
                  return (
                    <div
                      key={item.resource.canonicalId}
                      ref={virtual.measureElement}
                      data-index={row.index}
                      className="virtual-row"
                      style={{ transform: `translateY(${row.start}px)` }}
                    >
                      <Paper withBorder p="sm">
                        <Group justify="space-between">
                          <Text fw={700}>
                            {stringField(item.data, ['role', 'sender', 'author']) || item.title}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatDate(item.resource.observedAt)}
                          </Text>
                        </Group>
                        <Text size="sm" lineClamp={5}>
                          {stringField(item.data, ['content', 'text', 'message']) ||
                            item.searchableText}
                        </Text>
                      </Paper>
                    </div>
                  );
                })}
              </div>
            </div>
          </TruthPanel>
        </Box>
      </SimpleGrid>
    </>
  );
}

function MemoryView() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const path = query
    ? `/search?q=${encodeURIComponent(query)}&owner=memory-v4&limit=100`
    : '/resources?owner=memory-v4&kind=memory-record&limit=100';
  const result = useData<Collection<UnifiedResource | { resource: UnifiedResource }>>(path);
  const items = (result.data?.items ?? []).map((item) => ('truth' in item ? item : item.resource));
  return (
    <>
      <PageHeading
        title="Memory explorer"
        description="Inspect authoritative MemoryV4 records and owner-native search results."
      />
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
        mb="md"
      >
        <TextInput
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          label="Search memory"
          placeholder="Search content and metadata"
          leftSection={<IconSearch size={16} />}
          rightSection={
            <ActionIcon type="submit" aria-label="Search memory">
              <IconChevronRight size={16} />
            </ActionIcon>
          }
        />
      </Box>
      <TruthPanel
        meta={result.data?.meta}
        loading={result.loading}
        failure={result.failure}
        empty={Boolean(result.data && items.length === 0)}
        onRetry={result.reload}
      >
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          {items.map((item) => (
            <Card withBorder key={item.resource.canonicalId}>
              <Group justify="space-between">
                <Text fw={700}>{item.title}</Text>
                <StateBadge state={item.truth} />
              </Group>
              <Text size="sm" mt="sm" lineClamp={5}>
                {stringField(item.data, ['content', 'text', 'value']) || item.searchableText}
              </Text>
              <Text size="xs" c="dimmed" mt="md">
                Scope: {stringField(item.data, ['scope_path', 'scope']) || 'global'} ·{' '}
                {formatDate(item.resource.observedAt)}
              </Text>
            </Card>
          ))}
        </SimpleGrid>
      </TruthPanel>
    </>
  );
}

interface AuditEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  outcome: string;
  requestId: string;
  resource: Record<string, unknown> | null;
  occurredAt: string;
  eventHash: string;
}
function AuditView() {
  const result = useData<Collection<AuditEvent>>('/audit?limit=200');
  return (
    <>
      <PageHeading
        title="Audit"
        description="Append-only, hash-chained Gateway security and governance events."
        action={
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={result.reload}>
            Refresh
          </Button>
        }
      />
      <TruthPanel
        meta={result.data?.meta}
        loading={result.loading}
        failure={result.failure}
        empty={Boolean(result.data && result.data.items.length === 0)}
        onRetry={result.reload}
      >
        <Timeline active={-1} bulletSize={28}>
          {result.data?.items.map((event) => (
            <Timeline.Item
              key={event.id}
              bullet={<IconHistory size={15} />}
              title={
                <Group gap="xs">
                  <Text fw={700}>{event.eventType}</Text>
                  <Badge color={event.outcome === 'success' ? 'teal' : 'red'}>
                    {event.outcome}
                  </Badge>
                </Group>
              }
            >
              <Text size="sm">
                Actor {event.actorId ?? 'system'} · request {event.requestId}
              </Text>
              <Text size="xs" c="dimmed">
                {formatDate(event.occurredAt)} · hash {event.eventHash.slice(0, 12)}…
              </Text>
            </Timeline.Item>
          ))}
        </Timeline>
      </TruthPanel>
    </>
  );
}
interface Operation {
  operationId: string;
  operationType: string;
  actorId: string;
  state: string;
  mode: string;
  policyDecision: string;
  createdAt: string;
  updatedAt: string;
  target: { owner: string; kind: string; nativeId: string };
}
function OperationsView() {
  const result = useData<Collection<Operation>>('/operations?limit=200');
  return (
    <>
      <PageHeading
        title="Operations"
        description="Evidence-linked operation lifecycle records. This console does not execute mutations."
      />
      <TruthPanel
        meta={result.data?.meta}
        loading={result.loading}
        failure={result.failure}
        empty={Boolean(result.data && result.data.items.length === 0)}
        onRetry={result.reload}
      >
        <ScrollArea>
          <Table striped miw={760}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Operation</Table.Th>
                <Table.Th>Target</Table.Th>
                <Table.Th>Mode</Table.Th>
                <Table.Th>Policy</Table.Th>
                <Table.Th>State</Table.Th>
                <Table.Th>Updated</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {result.data?.items.map((item) => (
                <Table.Tr key={item.operationId}>
                  <Table.Td>
                    <Text fw={600}>{item.operationType}</Text>
                    <Text size="xs" c="dimmed">
                      {item.operationId}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {item.target.owner}/{item.target.kind}/{item.target.nativeId}
                  </Table.Td>
                  <Table.Td>{item.mode}</Table.Td>
                  <Table.Td>
                    <Badge variant="light">{item.policyDecision}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={
                        item.state === 'verified'
                          ? 'teal'
                          : item.state === 'failed'
                            ? 'red'
                            : 'blue'
                      }
                    >
                      {item.state}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatDate(item.updatedAt)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </TruthPanel>
    </>
  );
}
interface Notification {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  source: string;
  state: string;
  createdAt: string;
}
function NotificationsView() {
  const result = useData<Collection<Notification>>('/notifications?limit=200');
  const color = { info: 'blue', warning: 'orange', error: 'red', critical: 'red' } as const;
  return (
    <>
      <PageHeading
        title="Notifications"
        description="Unified owner notices and truthful integration failures."
      />
      <TruthPanel
        meta={result.data?.meta}
        loading={result.loading}
        failure={result.failure}
        empty={Boolean(result.data && result.data.items.length === 0)}
        onRetry={result.reload}
      >
        <Stack>
          {result.data?.items.map((item) => (
            <Alert
              key={item.id}
              color={color[item.severity]}
              title={
                <Group gap="xs">
                  <Text fw={700}>{item.title}</Text>
                  <Badge>{item.source}</Badge>
                </Group>
              }
            >
              <Text>{item.body}</Text>
              <Text size="xs" mt="xs">
                {formatDate(item.createdAt)} · {item.state}
              </Text>
            </Alert>
          ))}
        </Stack>
      </TruthPanel>
    </>
  );
}
function Settings({ principal }: { principal: Principal }) {
  const sessions = useData<{ items: SessionSummary[] }>('/sessions');
  const revoke = async (id: string) => {
    await api<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    sessions.reload();
  };
  return (
    <>
      <PageHeading
        title="Settings"
        description="Account, accessibility, appearance, and active browser sessions."
      />
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card withBorder>
          <Group>
            <Avatar color="ocean" size="lg">
              {principal.displayName.slice(0, 2).toUpperCase()}
            </Avatar>
            <Box>
              <Text fw={700}>{principal.displayName}</Text>
              <Text c="dimmed">@{principal.username}</Text>
            </Box>
          </Group>
          <Divider my="md" />
          <Text size="sm" fw={600}>
            Roles
          </Text>
          <Group mt="xs">
            {principal.roles.map((role) => (
              <Badge key={role}>{role}</Badge>
            ))}
          </Group>
          <Text size="sm" fw={600} mt="md">
            Granted permissions
          </Text>
          <Group mt="xs">
            {principal.permissions.map((permission) => (
              <Pill key={permission}>{permission}</Pill>
            ))}
          </Group>
        </Card>
        <Card withBorder>
          <Text fw={700}>Accessibility & keyboard</Text>
          <Stack mt="md" gap="xs">
            <Text size="sm">
              <Code>⌘/Ctrl + K</Code> Focus global search
            </Text>
            <Text size="sm">
              <Code>/</Code> Focus global search
            </Text>
            <Text size="sm">
              Navigation, dialogs, tables, and forms expose semantic labels and visible focus.
            </Text>
            <Group>
              <ColorSwatch color="#0876ad" />
              <Text size="sm">WCAG-oriented ocean contrast palette</Text>
            </Group>
          </Stack>
        </Card>
      </SimpleGrid>
      <Title order={2} mt="xl" mb="md">
        Active sessions
      </Title>
      <TruthPanel
        loading={sessions.loading}
        failure={sessions.failure}
        empty={Boolean(sessions.data && sessions.data.items.length === 0)}
        onRetry={sessions.reload}
      >
        <Stack>
          {sessions.data?.items.map((item) => (
            <Paper withBorder p="md" key={item.id}>
              <Group justify="space-between">
                <Box>
                  <Text fw={600}>{item.deviceLabel ?? 'Unnamed device'}</Text>
                  <Text size="xs" c="dimmed">
                    Last active {formatDate(item.lastSeenAt)} · expires {formatDate(item.expiresAt)}
                  </Text>
                </Box>
                <Button color="red" variant="light" size="xs" onClick={() => void revoke(item.id)}>
                  Revoke
                </Button>
              </Group>
            </Paper>
          ))}
        </Stack>
      </TruthPanel>
    </>
  );
}
function SearchView({ query }: { query: string }) {
  const result = useData<
    Collection<{ resource: UnifiedResource; score: number; matchedFields: string[] }>
  >(query ? `/search?q=${encodeURIComponent(query)}&limit=200` : null);
  return (
    <>
      <PageHeading title="Search" description={`Cross-owner results for “${query}”.`} />
      <TruthPanel
        meta={result.data?.meta}
        loading={result.loading}
        failure={result.failure}
        empty={Boolean(result.data && result.data.items.length === 0)}
        onRetry={result.reload}
      >
        <Stack>
          {result.data?.items.map((hit) => (
            <ResourceCard key={hit.resource.resource.canonicalId} item={hit.resource} />
          ))}
        </Stack>
      </TruthPanel>
    </>
  );
}

function toFailure(error: unknown): ApiFailure {
  if (error instanceof ApiError) return error.failure;
  if (error instanceof Error)
    return { code: 'NETWORK_ERROR', message: error.message, retryable: true };
  return { code: 'UNKNOWN_ERROR', message: 'An unknown error occurred.' };
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function label(value: string) {
  return value
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function stringField(data: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string') return value;
  }
  return '';
}
function taskStatus(task: UnifiedResource) {
  const raw = stringField(task.data, ['status', 'state', 'column'])
    .toLowerCase()
    .replaceAll('_', '-');
  if (raw.includes('progress') || raw === 'doing') return 'in-progress';
  if (raw.includes('review')) return 'review';
  if (raw.includes('done') || raw.includes('complete') || raw === 'closed') return 'done';
  if (raw.includes('backlog')) return 'backlog';
  return 'todo';
}
function summaryFields(data: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(data)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => [key, String(value)]);
}
