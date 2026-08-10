import {
  Accordion,
  Alert,
  Badge,
  Card,
  Code,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export type FrameworkUpdateSnapshot = {
  mode: 'read-only';
  source: {
    sourceId: string;
    repository: string;
    trusted: true;
    lastCheckedAt?: string;
    lastSuccessAt?: string;
    safeError?: string;
  };
  latestCandidate: null | {
    candidateId: string;
    tagName: string;
    releaseName: string;
    commitSha: string;
    releaseUrl: string;
    releaseNotes: string;
    publishedAt: string;
    discoveredAt: string;
  };
  frameworks: Array<{
    frameworkId: string;
    displayName: string;
    currentDeployment: null | {
      releaseId: string;
      imageReference: string;
      imageDigest: string;
      frameworkVersion: string;
      frameworkCommit: string;
      recordedAt: string;
    };
    comparison: null | {
      relation: 'current' | 'update_available' | 'installed_ahead' | 'diverged' | 'unknown';
      aheadBy: number;
      behindBy: number;
      checkedAt: string;
    };
    compatibility: {
      status: 'current' | 'not_assessed' | 'installed_ahead' | 'unavailable';
      reason: string;
    };
  }>;
};

export function FrameworkUpdatesView() {
  const [snapshot, setSnapshot] = useState<FrameworkUpdateSnapshot | null>(null);
  const [failure, setFailure] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setFailure('');
    try {
      setSnapshot(await api<FrameworkUpdateSnapshot>('/framework-updates'));
    } catch (cause) {
      setFailure(
        cause instanceof Error ? cause.message : 'Framework update visibility unavailable',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !snapshot) return <Loader aria-label="Loading framework updates" />;
  return (
    <Stack gap="md">
      <div>
        <Text size="xs" fw={800} tt="uppercase">
          Hermes release visibility
        </Text>
        <Title order={1}>Framework updates</Title>
        <Text c="dimmed">
          Read-only comparison of deployed Alica and Herman runtimes with the latest trusted stable
          Hermes release.
        </Text>
      </div>
      <Alert color="blue" title="Phase 1 is read-only">
        This page discovers and compares releases. It cannot build, approve, deploy, or roll back an
        update.
      </Alert>
      {failure ? (
        <Alert color="red" title="Update visibility unavailable">
          {failure}
        </Alert>
      ) : null}
      {snapshot?.source.safeError ? (
        <Alert color="yellow" title="Upstream discovery degraded">
          {snapshot.source.safeError}. The latest stored successful result remains visible.
        </Alert>
      ) : null}
      {snapshot ? (
        <Card withBorder>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={800}>Trusted upstream</Text>
              <Text>{snapshot.source.repository}</Text>
            </div>
            <Badge color="teal">Trusted</Badge>
          </Group>
          <Text size="sm" c="dimmed" mt="sm">
            Last checked: {formatDate(snapshot.source.lastCheckedAt)} · Last successful discovery:{' '}
            {formatDate(snapshot.source.lastSuccessAt)}
          </Text>
        </Card>
      ) : null}
      {snapshot?.latestCandidate ? (
        <Card withBorder>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={800}>Latest trusted stable release</Text>
              <Title order={3}>{snapshot.latestCandidate.releaseName}</Title>
              <Text size="sm" c="dimmed">
                Published {formatDate(snapshot.latestCandidate.publishedAt)}
              </Text>
            </div>
            <Badge color="blue">{snapshot.latestCandidate.tagName}</Badge>
          </Group>
          <Table mt="md" withRowBorders={false}>
            <Table.Tbody>
              <Table.Tr>
                <Table.Th>Commit</Table.Th>
                <Table.Td>
                  <Code>{snapshot.latestCandidate.commitSha}</Code>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Release</Table.Th>
                <Table.Td>
                  <Text
                    component="a"
                    href={snapshot.latestCandidate.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open trusted GitHub release notes
                  </Text>
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          <Accordion mt="md">
            <Accordion.Item value="notes">
              <Accordion.Control>Stored release notes</Accordion.Control>
              <Accordion.Panel>
                <Text component="pre" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                  {snapshot.latestCandidate.releaseNotes || 'No release notes were published.'}
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Card>
      ) : (
        !failure && (
          <Alert color="yellow">No trusted stable Hermes release has been discovered yet.</Alert>
        )
      )}
      <SimpleGrid cols={{ base: 1, xl: 2 }}>
        {snapshot?.frameworks.map((framework) => {
          const deployment = framework.currentDeployment;
          return (
            <Card
              withBorder
              key={framework.frameworkId}
              aria-label={`${framework.displayName} update status`}
            >
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={3}>{framework.displayName}</Title>
                  <Code>{framework.frameworkId}</Code>
                </div>
                <Badge color={relationColor(framework.comparison?.relation)}>
                  {relationLabel(framework.comparison?.relation)}
                </Badge>
              </Group>
              {deployment ? (
                <Table mt="md" withRowBorders={false}>
                  <Table.Tbody>
                    <Row label="Installed version" value={deployment.frameworkVersion} />
                    <Row label="Installed commit" value={deployment.frameworkCommit} code />
                    <Row label="Platform release" value={deployment.releaseId} />
                    <Row label="Image digest" value={deployment.imageDigest} code />
                    <Row
                      label="Commits behind candidate"
                      value={String(framework.comparison?.aheadBy ?? 0)}
                    />
                  </Table.Tbody>
                </Table>
              ) : (
                <Alert color="yellow" mt="md">
                  No deployed image/release metadata is stored for this framework.
                </Alert>
              )}
              <Alert
                mt="md"
                color={framework.compatibility.status === 'current' ? 'teal' : 'yellow'}
                title={`Compatibility: ${framework.compatibility.status.replace('_', ' ')}`}
              >
                {framework.compatibility.reason}
              </Alert>
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

function Row({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return (
    <Table.Tr>
      <Table.Th>{label}</Table.Th>
      <Table.Td>{code ? <Code>{value}</Code> : value}</Table.Td>
    </Table.Tr>
  );
}

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleString() : 'Not available';
}

function relationLabel(relation?: string): string {
  return relation?.replaceAll('_', ' ') ?? 'comparison unavailable';
}

function relationColor(relation?: string): string {
  if (relation === 'current') return 'teal';
  if (relation === 'update_available') return 'blue';
  return 'yellow';
}
