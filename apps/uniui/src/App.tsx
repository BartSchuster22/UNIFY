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
  Checkbox,
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
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Timeline,
  Title,
  Tooltip,
  createTheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { NotificationInbox } from '@aquiero/notification-components';
import {
  IconActivity,
  IconBell,
  IconBolt,
  IconBooks,
  IconClipboardList,
  IconDatabase,
  IconGauge,
  IconHistory,
  IconLogout,
  IconMessages,
  IconMoon,
  IconNetwork,
  IconRefresh,
  IconSettings,
  IconShieldCheck,
  IconSun,
  IconUserCircle,
  IconUsers,
} from '@tabler/icons-react';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, gateway } from './api';
import { WorkView } from './WorkView';
import { ProfilesView } from './ProfilesView';
import { ModelsView } from './ModelsView';
import { ChatView } from './ChatView';
import { FrameworksView } from './FrameworksView';
import { MemoryView } from './MemoryView';
import { FrameworkProvider, useFrameworkContext } from './FrameworkContext';
import type {
  ApiFailure,
  Collection,
  MutationRequest,
  MutationResponse,
  Principal,
  ResponseMeta,
  SessionSummary,
  TruthState,
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
  | 'mutations'
  | 'notifications'
  | 'settings';

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
  { id: 'memory', label: 'Memory & knowledge', icon: IconBooks, permission: 'memory.read' },

  { id: 'audit', label: 'Audit', icon: IconShieldCheck, permission: 'audit.read' },
  { id: 'operations', label: 'Operations', icon: IconActivity, permission: 'operations.read' },
  { id: 'mutations', label: 'Safety actions', icon: IconBolt },
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
  const [view, setView] = useState<ViewId>(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    return NAV.some((item) => item.id === requested) ? (requested as ViewId) : 'overview';
  });
  const [dark, setDark] = useState(() => localStorage.getItem('unify-color-scheme') === 'dark');
  const [opened, { toggle, close }] = useDisclosure(false);
  useEffect(() => {
    gateway
      .me()
      .then(setPrincipal)
      .catch(() => setPrincipal(null))
      .finally(() => setAuthLoading(false));
  }, []);
  const changeView = (next: ViewId) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
    close();
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
  const visible = NAV.filter((item) =>
    item.id === 'mutations'
      ? ACTION_PRESETS.some((preset) => principal.permissions.includes(preset.permission))
      : !item.permission || principal.permissions.includes(item.permission),
  );
  const activeView = visible.some((item) => item.id === view) ? view : 'overview';
  return (
    <MantineProvider theme={theme} forceColorScheme={dark ? 'dark' : 'light'}>
      <FrameworkProvider>
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
                    active={activeView === item.id}
                    label={item.label}
                    leftSection={<item.icon size={18} />}
                    onClick={() => changeView(item.id)}
                    aria-current={activeView === item.id ? 'page' : undefined}
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
            <View view={activeView} principal={principal} />
          </AppShell.Main>
        </AppShell>
      </FrameworkProvider>
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

function View({ view, principal }: { view: ViewId; principal: Principal }) {
  switch (view) {
    case 'overview':
      return <Overview />;
    case 'frameworks':
      return <FrameworksView />;
    case 'models':
      return (
        <ModelsView
          canManageCredentials={principal.permissions.includes('credentials.manage')}
          canManageModels={principal.permissions.includes('models.manage')}
        />
      );
    case 'profiles':
      return <ProfilesView canManage={false} canManageModels={false} canDelete={false} />;
    case 'work':
      return <WorkView canManage={principal.permissions.includes('work.manage')} />;
    case 'chat':
      return <ChatView canUse={principal.permissions.includes('chat.use')} />;
    case 'memory':
      return (
        <MemoryView
          canReadAudit={principal.permissions.includes('audit.read')}
          canWrite={principal.permissions.includes('memory.write')}
          canPromote={principal.permissions.includes('memory.promote')}
          canAdmin={principal.permissions.includes('memory.admin')}
        />
      );

    case 'audit':
      return <AuditView />;
    case 'operations':
      return <OperationsView />;
    case 'mutations':
      return <MutationConsole principal={principal} />;
    case 'notifications':
      return <NotificationsView />;
    case 'settings':
      return <Settings principal={principal} />;
  }
}

type ActionPreset = {
  value: string;
  label: string;
  owner: MutationRequest['target']['owner'];
  kind: string;
  permission: string;
  destructive?: boolean;
  payload: Record<string, unknown>;
};

const ACTION_PRESETS: ActionPreset[] = [
  {
    value: 'framework.reconcile',
    label: 'Hermes · Reconcile framework state',
    owner: 'hermes',
    kind: 'framework',
    permission: 'frameworks.manage',
    payload: { families: ['profiles', 'providers', 'work', 'conversations'] },
  },
];

function MutationConsole({ principal }: { principal: Principal }) {
  const {
    frameworks,
    frameworkId,
    loading: frameworksLoading,
    error: frameworkError,
    selectionIssue,
    selectFramework,
  } = useFrameworkContext();
  const available = ACTION_PRESETS.filter((item) =>
    principal.permissions.includes(item.permission),
  );
  const [action, setAction] = useState(available[0]?.value ?? '');
  const preset = available.find((item) => item.value === action) ?? available[0];
  const [mode, setMode] = useState<MutationRequest['mode']>('validate');
  const [confirmed, setConfirmed] = useState(false);
  const [payload, setPayload] = useState(() =>
    JSON.stringify(available[0]?.payload ?? {}, null, 2),
  );
  const [result, setResult] = useState<MutationResponse | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = (value: string | null) => {
    if (!value) return;
    const next = available.find((item) => item.value === value);
    setAction(value);
    setPayload(JSON.stringify(next?.payload ?? {}, null, 2));
    setConfirmed(false);
    setResult(null);
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preset || !frameworkId) return;
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Payload must be a JSON object.');
      const response = await gateway.mutate({
        operationType: preset.value,
        target: {
          owner: preset.owner,
          kind: preset.kind,
          nativeId: frameworkId,
          ...(preset.owner === 'hermes' ? { frameworkId } : {}),
        },
        payload: parsed as Record<string, unknown>,
        mode,
        confirmed,
      });
      setResult(response);
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error.failure
          : {
              code: 'INVALID_MUTATION',
              message: error instanceof Error ? error.message : 'Mutation failed',
            },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeading
        title="Hermes control validation"
        description="Validate and dry-run exact framework reconciliation commands through the versioned Hermes control contract."
      />
      {!preset ? (
        <Alert color="red" title="No mutation permissions">
          Your current roles do not permit owner mutations.
        </Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Paper withBorder p="lg" component="form" onSubmit={submit}>
            <Stack>
              <Select
                label="Operation"
                data={available.map(({ value, label }) => ({ value, label }))}
                value={action}
                onChange={choose}
                searchable
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Authoritative native ID" required value={frameworkId} readOnly />
                {preset.owner === 'hermes' && (
                  <Select
                    label="Framework"
                    required
                    value={frameworkId || null}
                    data={frameworks.map((item) => ({
                      value: item.frameworkId,
                      label: item.displayName,
                    }))}
                    onChange={(value) => selectFramework(value ?? '')}
                    disabled={frameworksLoading}
                  />
                )}
              </SimpleGrid>
              {frameworkError || selectionIssue ? (
                <Alert color="red" title="Framework selection unavailable">
                  {frameworkError || selectionIssue}
                </Alert>
              ) : null}
              <Group gap="xs">
                <Badge>{preset.owner}</Badge>
                <Badge variant="outline">{preset.kind}</Badge>
                {preset.destructive && <Badge color="red">destructive</Badge>}
              </Group>

              <Textarea
                label="Owner payload (JSON)"
                required
                minRows={12}
                autosize
                maxRows={24}
                value={payload}
                onChange={(event) => setPayload(event.currentTarget.value)}
                styles={{ input: { fontFamily: 'monospace' } }}
              />
              <SegmentedControl
                fullWidth
                value={mode}
                onChange={(value) => setMode(value as MutationRequest['mode'])}
                data={[
                  { label: 'Validate', value: 'validate' },
                  { label: 'Dry run', value: 'dry-run' },
                ]}
              />
              <Checkbox
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
                label="I explicitly confirm this destructive operation"
                color="red"
              />

              {failure && (
                <Alert color="red" title={failure.code}>
                  {failure.message}
                </Alert>
              )}
              <Button
                type="submit"
                loading={busy}
                disabled={!frameworkId}
                color={preset.destructive && mode === 'execute' ? 'red' : 'ocean'}
                leftSection={<IconBolt size={16} />}
              >
                {mode === 'execute'
                  ? 'Execute action'
                  : mode === 'dry-run'
                    ? 'Run owner dry-run'
                    : 'Validate action'}
              </Button>
            </Stack>
          </Paper>
          <Stack>
            <Paper withBorder p="lg">
              <Stack>
                <Title order={3}>Operation result</Title>
                {result ? (
                  <>
                    <Group>
                      <StateBadge
                        state={result.operation.state === 'verified' ? 'current' : 'inconclusive'}
                      />
                      <Code>{result.operation.operationId}</Code>
                      {result.replayed && <Badge>replayed</Badge>}
                    </Group>
                    <Code block>{JSON.stringify(result.result, null, 2)}</Code>
                  </>
                ) : (
                  <Text c="dimmed">No action has been submitted.</Text>
                )}
              </Stack>
            </Paper>
          </Stack>
        </SimpleGrid>
      )}
    </>
  );
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
  const frameworks = useData<{
    items: Array<{
      frameworkId: string;
      displayName: string;
      enabled: boolean;
      status: string;
      frameworkVersion: string;
      frameworkCommit: string;
    }>;
  }>('/frameworks');
  const operations = useData<Collection<Operation>>('/operations?limit=8');
  const notifications = useData<Collection<Notification>>('/notifications?limit=100');
  const healthyFrameworks =
    frameworks.data?.items.filter((item) => item.enabled && item.status === 'verified').length ?? 0;
  const unresolvedAlerts =
    notifications.data?.items.filter((item) => item.state !== 'acknowledged').length ?? 0;
  const failedOperations =
    operations.data?.items.filter((item) => ['failed', 'inconclusive'].includes(item.state))
      .length ?? 0;
  const reload = () => {
    frameworks.reload();
    operations.reload();
    notifications.reload();
  };
  return (
    <>
      <PageHeading
        title="Control plane"
        description="Live Hermes framework registration, governed operations, alerts and immutable evidence."
        action={
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={reload}>
            Recheck all
          </Button>
        }
      />
      <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} mb="md">
        {[
          ['Registered frameworks', frameworks.data?.items.length ?? 0],
          ['Verified and enabled', healthyFrameworks],
          ['Unresolved alerts', unresolvedAlerts],
          ['Failed operations', failedOperations],
        ].map(([label, value]) => (
          <Card withBorder key={String(label)}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              {label}
            </Text>
            <Text size="2rem" fw={800}>
              {value}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
      {(frameworks.failure || operations.failure || notifications.failure) && (
        <Alert color="red" title="Control-plane data incomplete" mb="md">
          {frameworks.failure?.message ??
            operations.failure?.message ??
            notifications.failure?.message}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, xl: 2 }}>
        <Card withBorder>
          <Group justify="space-between" mb="md">
            <Text fw={800}>Framework runtime</Text>
            {frameworks.loading ? <Loader size="xs" /> : null}
          </Group>
          <Stack gap="sm">
            {frameworks.data?.items.map((framework) => (
              <Paper withBorder p="sm" key={framework.frameworkId}>
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text fw={700}>{framework.displayName}</Text>
                    <Text size="xs" c="dimmed">
                      {framework.frameworkId} · {framework.frameworkVersion} ·{' '}
                      {framework.frameworkCommit.slice(0, 12)}
                    </Text>
                  </div>
                  <Badge
                    color={framework.enabled && framework.status === 'verified' ? 'teal' : 'red'}
                  >
                    {framework.enabled ? framework.status : 'disabled'}
                  </Badge>
                </Group>
              </Paper>
            ))}
            {!frameworks.loading && frameworks.data?.items.length === 0 ? (
              <Text c="dimmed">No framework is registered.</Text>
            ) : null}
          </Stack>
        </Card>
        <Card withBorder>
          <Group justify="space-between" mb="md">
            <Text fw={800}>Recent governed operations</Text>
            {operations.loading ? <Loader size="xs" /> : null}
          </Group>
          <Stack gap="sm">
            {operations.data?.items.map((operation) => (
              <Paper withBorder p="sm" key={operation.operationId}>
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text fw={700}>{operation.operationType}</Text>
                    <Text size="xs" c="dimmed">
                      {operation.target.owner} · {operation.target.kind}:{operation.target.nativeId}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {formatDate(operation.updatedAt)} · evidence {operation.evidenceIds.length}
                    </Text>
                  </div>
                  <Badge
                    color={
                      operation.state === 'verified'
                        ? 'teal'
                        : operation.state === 'failed'
                          ? 'red'
                          : 'blue'
                    }
                  >
                    {operation.state}
                  </Badge>
                </Group>
              </Paper>
            ))}
            {!operations.loading && operations.data?.items.length === 0 ? (
              <Text c="dimmed">No governed operation has been recorded.</Text>
            ) : null}
          </Stack>
        </Card>
      </SimpleGrid>
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
  evidenceIds: string[];
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
                <Table.Th>Evidence</Table.Th>
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
                  <Table.Td>
                    <Text fw={700}>{item.evidenceIds.length}</Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {item.evidenceIds.join(', ') || 'No evidence references'}
                    </Text>
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
  state: 'unread' | 'read' | 'acknowledged';
  createdAt: string;
  deepLink?: string;
}
function NotificationsView() {
  const result = useData<Collection<Notification>>('/notifications?limit=200');
  const [acknowledging, setAcknowledging] = useState('');
  const [actionFailure, setActionFailure] = useState('');
  const acknowledge = async (id: string) => {
    setAcknowledging(id);
    setActionFailure('');
    try {
      await api<void>(`/notifications/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
      result.reload();
    } catch (error) {
      setActionFailure(
        error instanceof ApiError ? error.failure.message : 'Acknowledgement failed',
      );
    } finally {
      setAcknowledging('');
    }
  };
  return (
    <>
      <PageHeading
        title="Notifications"
        description="Unified owner notices, grouping, acknowledgement, and authoritative deep links."
      />
      {actionFailure && (
        <Alert color="red" title="Notification action failed">
          {actionFailure}
        </Alert>
      )}
      <TruthPanel
        meta={result.data?.meta}
        loading={result.loading}
        failure={result.failure}
        empty={Boolean(result.data && result.data.items.length === 0)}
        onRetry={result.reload}
      >
        <NotificationInbox
          notifications={result.data?.items ?? []}
          acknowledgingId={acknowledging}
          onAcknowledge={(id: string) => void acknowledge(id)}
        />
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
