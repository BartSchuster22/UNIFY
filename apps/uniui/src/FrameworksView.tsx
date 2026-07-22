import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

type FrameworkRegistration = {
  frameworkId: string;
  displayName: string;
  baseUrl: string;
  scopes: string[];
  contractVersion: string;
  frameworkVersion: string;
  frameworkCommit: string;
  status: 'verified' | 'disabled' | string;
  enabled: boolean;
  verifiedAt?: string;
};

type Provenance = {
  frameworkId: string;
  frameworkVersion: string;
  frameworkCommit: string;
  sourceVersion: string;
  observedAt: string;
};

type Capability = {
  status: 'supported' | 'unsupported' | 'unavailable' | 'forbidden' | string;
  modes?: string[];
  requiredScopes?: string[];
  reasonCode?: string;
};

type FrameworkRuntime = {
  health?: {
    meta: Provenance;
    data: { status: string; checks: Record<string, { status: string }> };
  };
  capabilities?: {
    meta: Provenance;
    data: { capabilities: Record<string, Capability> };
  };
  failure?: string;
};

export function FrameworksView() {
  const [frameworks, setFrameworks] = useState<FrameworkRegistration[]>([]);
  const [runtime, setRuntime] = useState<Record<string, FrameworkRuntime>>({});
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [checkedAt, setCheckedAt] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setFailure('');
    try {
      const registry = await api<{ items: FrameworkRegistration[] }>('/frameworks');
      setFrameworks(registry.items);
      const entries = await Promise.all(
        registry.items.map(async (framework): Promise<[string, FrameworkRuntime]> => {
          try {
            const [health, capabilities] = await Promise.all([
              api<NonNullable<FrameworkRuntime['health']>>(
                `/frameworks/${encodeURIComponent(framework.frameworkId)}/health`,
              ),
              api<NonNullable<FrameworkRuntime['capabilities']>>(
                `/frameworks/${encodeURIComponent(framework.frameworkId)}/capabilities`,
              ),
            ]);
            return [framework.frameworkId, { health, capabilities }];
          } catch (cause) {
            return [
              framework.frameworkId,
              {
                failure: cause instanceof Error ? cause.message : 'Framework runtime probe failed',
              },
            ];
          }
        }),
      );
      setRuntime(Object.fromEntries(entries));
      setCheckedAt(new Date().toISOString());
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Framework registry unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} tt="uppercase">
            Hermes control plane
          </Text>
          <Title order={1}>Frameworks</Title>
          <Text c="dimmed">
            Registered framework health, declared capabilities, reconnect probes and source
            evidence.
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={() => void load()}
        >
          Recheck now
        </Button>
      </Group>
      {checkedAt ? (
        <Text size="xs" c="dimmed" aria-live="polite">
          Last runtime check {new Date(checkedAt).toLocaleString()}; automatic reconnect probe every
          30 seconds.
        </Text>
      ) : null}
      {failure ? (
        <Alert color="red" title="Framework registry unavailable">
          {failure}
        </Alert>
      ) : null}
      {loading && !frameworks.length ? <Loader aria-label="Loading frameworks" /> : null}
      {!loading && !failure && !frameworks.length ? (
        <Paper withBorder p="xl">
          <Text fw={700}>No framework registered</Text>
          <Text c="dimmed">
            Domain controls remain unavailable until an exact framework is verified.
          </Text>
        </Paper>
      ) : null}
      <SimpleGrid cols={{ base: 1, xl: 2 }}>
        {frameworks.map((framework) => {
          const state = runtime[framework.frameworkId];
          const health = state?.health?.data;
          const capabilities = state?.capabilities?.data.capabilities ?? {};
          const provenance = state?.health?.meta ?? state?.capabilities?.meta;
          return (
            <Card withBorder key={framework.frameworkId} aria-label={framework.displayName}>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={800}>{framework.displayName}</Text>
                  <Code>{framework.frameworkId}</Code>
                </div>
                <Group gap="xs">
                  <Badge color={framework.enabled ? 'teal' : 'gray'}>{framework.status}</Badge>
                  <Badge
                    color={
                      health?.status === 'healthy'
                        ? 'teal'
                        : health?.status === 'degraded'
                          ? 'yellow'
                          : 'red'
                    }
                  >
                    {state?.failure ? 'unavailable' : (health?.status ?? 'checking')}
                  </Badge>
                </Group>
              </Group>
              {state?.failure ? (
                <Alert color="red" mt="md" title="Reconnect probe failed">
                  {state.failure}
                </Alert>
              ) : null}
              {health ? (
                <Group gap="xs" mt="md">
                  {Object.entries(health.checks).map(([name, check]) => (
                    <Badge
                      key={name}
                      variant="light"
                      color={check.status === 'healthy' ? 'teal' : 'orange'}
                    >
                      {name}: {check.status}
                    </Badge>
                  ))}
                </Group>
              ) : null}
              <ScrollArea mt="md">
                <Table striped miw={620}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Capability</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Modes</Table.Th>
                      <Table.Th>Reason</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {Object.entries(capabilities).map(([name, capability]) => (
                      <Table.Tr key={name}>
                        <Table.Td>
                          <Code>{name}</Code>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={
                              capability.status === 'supported'
                                ? 'teal'
                                : capability.status === 'unavailable'
                                  ? 'orange'
                                  : 'gray'
                            }
                          >
                            {capability.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{capability.modes?.join(', ') || '—'}</Table.Td>
                        <Table.Td>{capability.reasonCode ?? '—'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
              <Stack gap={2} mt="md">
                <Text size="xs" c="dimmed">
                  Contract {framework.contractVersion} · Framework {framework.frameworkVersion}
                </Text>
                <Text size="xs" c="dimmed">
                  Commit <Code>{provenance?.frameworkCommit ?? framework.frameworkCommit}</Code>
                </Text>
                <Text size="xs" c="dimmed">
                  Source <Code>{provenance?.sourceVersion ?? 'not observed'}</Code>
                </Text>
                <Text size="xs" c="dimmed">
                  Observed{' '}
                  {provenance?.observedAt ? new Date(provenance.observedAt).toLocaleString() : '—'}
                </Text>
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
