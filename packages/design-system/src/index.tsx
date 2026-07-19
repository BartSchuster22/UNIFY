import {
  Alert,
  AppShell,
  Avatar,
  Box,
  Button,
  Center,
  Group,
  Loader,
  MantineProvider,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
  createTheme,
} from '@mantine/core';
import { IconBell, IconLogout, IconMessageCircle } from '@tabler/icons-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { GatewayClient, GatewayError, type Principal } from '@aquiero/auth-client';

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
});

export interface FocusedApplicationProps {
  name: string;
  description: string;
  client: GatewayClient;
  requiredPermission?: string;
  requiredAnyPermission?: string[];
  children: (principal: Principal) => ReactNode;
}

export function FocusedApplication({
  name,
  description,
  client,
  requiredPermission,
  requiredAnyPermission,
  children,
}: FocusedApplicationProps) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    client
      .me()
      .then(setPrincipal)
      .catch(() => setPrincipal(null))
      .finally(() => setLoading(false));
  }, [client]);
  return (
    <MantineProvider theme={theme}>
      {loading ? (
        <Center mih="100vh">
          <Loader aria-label="Checking authentication" />
        </Center>
      ) : !principal ? (
        <LoginPanel name={name} description={description} client={client} onLogin={setPrincipal} />
      ) : (requiredPermission && !principal.permissions.includes(requiredPermission)) ||
        (requiredAnyPermission &&
          !requiredAnyPermission.some((permission) =>
            principal.permissions.includes(permission),
          )) ? (
        <Center mih="100vh" p="md">
          <Alert color="red" title="Access denied">
            Your named account does not have permission to use this focused application.
          </Alert>
        </Center>
      ) : (
        <>
          <a className="focused-skip-link" href="#main-content">
            Skip to content
          </a>
          <AppShell header={{ height: 64 }} padding="md">
            <AppShell.Header px="md">
              <Group h="100%" justify="space-between" wrap="nowrap">
                <Group wrap="nowrap">
                  {name.toLowerCase().includes('chat') ? (
                    <IconMessageCircle aria-hidden="true" />
                  ) : (
                    <IconBell aria-hidden="true" />
                  )}
                  <Box>
                    <Text fw={800}>{name}</Text>
                    <Text size="xs" c="dimmed">
                      {description}
                    </Text>
                  </Box>
                </Group>
                <Group wrap="nowrap">
                  <Avatar size="sm" color="ocean">
                    {principal.displayName.slice(0, 2).toUpperCase()}
                  </Avatar>
                  <Text size="sm" visibleFrom="sm">
                    {principal.displayName}
                  </Text>
                  <Button
                    variant="subtle"
                    leftSection={<IconLogout size={16} />}
                    onClick={() => void client.logout().finally(() => setPrincipal(null))}
                  >
                    Sign out
                  </Button>
                </Group>
              </Group>
            </AppShell.Header>
            <AppShell.Main id="main-content" tabIndex={-1}>
              {children(principal)}
            </AppShell.Main>
          </AppShell>
        </>
      )}
    </MantineProvider>
  );
}

function LoginPanel({
  name,
  description,
  client,
  onLogin,
}: {
  name: string;
  description: string;
  client: GatewayClient;
  onLogin: (principal: Principal) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  useEffect(() => usernameRef.current?.focus(), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      onLogin(await client.login(username, password));
      setPassword('');
    } catch (error) {
      setFailure(error instanceof GatewayError ? error.failure.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Center mih="100vh" p="md">
      <Paper
        component="form"
        onSubmit={(event) => void submit(event)}
        withBorder
        shadow="md"
        p="xl"
        w="min(100%, 30rem)"
      >
        <Stack>
          <Box>
            <Title order={1}>Sign in to {name}</Title>
            <Text c="dimmed">{description}</Text>
          </Box>
          {failure && (
            <Alert color="red" title="Sign-in failed">
              {failure}
            </Alert>
          )}
          <TextInput
            ref={usernameRef}
            label="Username"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <Button type="submit" loading={busy}>
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}

export function AsyncState({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: string;
  empty: boolean;
  children: ReactNode;
}) {
  if (loading)
    return (
      <Center p="xl">
        <Loader aria-label="Loading" />
      </Center>
    );
  if (error)
    return (
      <Alert color="red" title="Unable to load">
        {error}
      </Alert>
    );
  if (empty)
    return (
      <Alert color="blue" title="Nothing here">
        The authoritative source returned no records.
      </Alert>
    );
  return children;
}
