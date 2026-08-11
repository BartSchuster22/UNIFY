import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Group,
  Loader,
  NumberInput,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

type RolloutPlan = {
  planId: string;
  state: string;
  operationKind: 'release' | 'rollback';
  sourcePlanId?: string;
  policySnapshot: Record<string, unknown>;
  rollbackReason?: string;
  createdAt: string;
  approvedAt?: string;
  observationStartedAt?: string;
  observationDeadlineAt?: string;
  observationCompletedAt?: string;
  promotedBy?: string;
  promotedAt?: string;
  failureCode?: string;
  failureReason?: string;
  targets: Array<{
    frameworkId: 'hermes-alica' | 'hermes-herman';
    state: string;
    progress: number;
    targetFrameworkVersion: string;
    targetFrameworkCommit: string;
    targetImageDigest: string;
    dryRunChecks: Record<string, unknown>;
    convergenceChecks: Record<string, unknown>;
    observationChecks: Record<string, unknown>;
    safeErrorCode?: string;
    safeErrorReason?: string;
  }>;
  events: Array<{
    eventId: string;
    frameworkId?: string;
    state: string;
    progress: number;
    safeMessage: string;
    details: Record<string, unknown>;
    occurredAt: string;
  }>;
  observations: Array<{
    observationId: string;
    frameworkId: string;
    healthy: boolean;
    imageIdentity: boolean;
    releaseIdentity: boolean;
    commitIdentity: boolean;
    details: Record<string, unknown>;
    observedAt: string;
  }>;
};

export type FrameworkUpdateSnapshot = {
  mode: 'governed-rollout';
  releasePolicy: {
    canaryFrameworkId: 'hermes-alica' | 'hermes-herman';
    observationWindowSeconds: number;
    requiredHealthySamples: number;
    manualPromotionRequired: true;
    updatedBy?: string;
    updatedAt: string;
  };
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
  candidateAssessment: null | {
    assessmentId: string;
    state: 'ready' | 'blocked';
    sourceCommit: string;
    sourceArchiveDigest: string;
    imageReference?: string;
    imageDigest?: string;
    adapterRelease: string;
    contractVersion: string;
    contractPassed: boolean;
    acceptancePassed: boolean;
    evidenceDigest: string;
    safeFailureCode?: string;
    safeFailureReason?: string;
    assessedAt: string;
  };
  rollouts: RolloutPlan[];
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
      status:
        'current' | 'not_assessed' | 'installed_ahead' | 'unavailable' | 'compatible' | 'blocked';
      reason: string;
    };
  }>;
};

export function FrameworkUpdatesView() {
  const [snapshot, setSnapshot] = useState<FrameworkUpdateSnapshot | null>(null);
  const [failure, setFailure] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Array<'hermes-alica' | 'hermes-herman'>>([]);
  const [busy, setBusy] = useState('');
  const [rollbackReason, setRollbackReason] = useState('Operator-requested governed rollback');
  const [policyCanary, setPolicyCanary] = useState<'hermes-alica' | 'hermes-herman'>(
    'hermes-alica',
  );
  const [policyWindow, setPolicyWindow] = useState(300);
  const [policySamples, setPolicySamples] = useState(3);
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
  useEffect(() => {
    if (!snapshot) return;
    setPolicyCanary(snapshot.releasePolicy.canaryFrameworkId);
    setPolicyWindow(snapshot.releasePolicy.observationWindowSeconds);
    setPolicySamples(snapshot.releasePolicy.requiredHealthySamples);
  }, [snapshot?.releasePolicy.updatedAt]);
  const activeRollout = snapshot?.rollouts.find(
    (plan) => !['succeeded', 'partial', 'failed', 'cancelled'].includes(plan.state),
  );
  useEffect(() => {
    if (!activeRollout || !['queued', 'executing', 'observing'].includes(activeRollout.state))
      return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [activeRollout?.planId, activeRollout?.state, load]);

  async function createPlan() {
    setBusy('plan');
    setFailure('');
    try {
      await api<RolloutPlan>('/framework-updates/rollouts', {
        method: 'POST',
        body: JSON.stringify({ frameworkIds: selected }),
      });
      setSelected([]);
      await load();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not create rollout plan');
    } finally {
      setBusy('');
    }
  }

  async function transition(plan: RolloutPlan, action: 'dry-run' | 'approve' | 'execute') {
    setBusy(action);
    setFailure('');
    try {
      await api<RolloutPlan>(`/framework-updates/rollouts/${plan.planId}/${action}`, {
        method: 'POST',
      });
      await load();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : `Could not ${action} rollout`);
    } finally {
      setBusy('');
    }
  }

  async function updatePolicy() {
    setBusy('policy');
    setFailure('');
    try {
      await api('/framework-updates/policies/default', {
        method: 'PUT',
        body: JSON.stringify({
          canaryFrameworkId: policyCanary,
          observationWindowSeconds: policyWindow,
          requiredHealthySamples: policySamples,
        }),
      });
      await load();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not update release policy');
    } finally {
      setBusy('');
    }
  }

  async function promote(plan: RolloutPlan) {
    setBusy(`promote-${plan.planId}`);
    setFailure('');
    try {
      await api(`/framework-updates/rollouts/${plan.planId}/promote`, { method: 'POST' });
      await load();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not promote canary');
    } finally {
      setBusy('');
    }
  }

  async function rollback(plan: RolloutPlan) {
    setBusy(`rollback-${plan.planId}`);
    setFailure('');
    try {
      await api(`/framework-updates/rollouts/${plan.planId}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ reason: rollbackReason }),
      });
      await load();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not queue governed rollback');
    } finally {
      setBusy('');
    }
  }

  if (loading && !snapshot) return <Loader aria-label="Loading framework updates" />;
  return (
    <Stack gap="md">
      <div>
        <Text size="xs" fw={800} tt="uppercase">
          Hermes release visibility
        </Text>
        <Title order={1}>Framework updates</Title>
        <Text c="dimmed">
          Deployed Alica and Herman runtimes, trusted Hermes releases, and immutable candidate build
          assessment evidence.
        </Text>
      </div>
      <Alert color="blue" title="Governed rollout">
        Plan exact Alica and Herman targets independently, prove every precondition in a dry-run,
        approve the immutable plan, then execute it through the host rollout worker. Runtime health,
        image identity, release, and commit must converge automatically or that target is restored.
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
      {snapshot?.candidateAssessment ? (
        <Card withBorder aria-label="Candidate assessment status">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={800}>Candidate assessment</Text>
              <Title order={3}>
                {snapshot.candidateAssessment.state === 'ready' ? 'Ready' : 'Blocked'}
              </Title>
              <Text size="sm" c="dimmed">
                Assessed {formatDate(snapshot.candidateAssessment.assessedAt)}
              </Text>
            </div>
            <Badge color={snapshot.candidateAssessment.state === 'ready' ? 'teal' : 'red'}>
              {snapshot.candidateAssessment.state}
            </Badge>
          </Group>
          <Table mt="md" withRowBorders={false}>
            <Table.Tbody>
              <Row
                label="Exact source commit"
                value={snapshot.candidateAssessment.sourceCommit}
                code
              />
              <Row
                label="Source archive digest"
                value={snapshot.candidateAssessment.sourceArchiveDigest}
                code
              />
              <Row
                label="Contract tests"
                value={snapshot.candidateAssessment.contractPassed ? 'Passed' : 'Failed'}
              />
              <Row
                label="Runtime acceptance"
                value={snapshot.candidateAssessment.acceptancePassed ? 'Passed' : 'Failed'}
              />
              {snapshot.candidateAssessment.imageDigest ? (
                <Row
                  label="Immutable image digest"
                  value={snapshot.candidateAssessment.imageDigest}
                  code
                />
              ) : null}
              <Row
                label="Evidence digest"
                value={snapshot.candidateAssessment.evidenceDigest}
                code
              />
            </Table.Tbody>
          </Table>
          {snapshot.candidateAssessment.state === 'blocked' ? (
            <Alert color="red" mt="md" title={snapshot.candidateAssessment.safeFailureCode}>
              {snapshot.candidateAssessment.safeFailureReason}
            </Alert>
          ) : (
            <Alert color="teal" mt="md" title="Candidate is ready for approval review">
              Exact source, contract, acceptance, and immutable image checks passed. No deployment
              approval has been granted.
            </Alert>
          )}
        </Card>
      ) : snapshot?.latestCandidate ? (
        <Alert color="yellow" title="Candidate not assessed">
          No immutable build and acceptance evidence is stored for this trusted release.
        </Alert>
      ) : null}
      {snapshot ? (
        <Card withBorder aria-label="Release policy controls">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={3}>Release policy</Title>
              <Text size="sm" c="dimmed">
                Canary order, mandatory health observation, and manual second-instance promotion are
                snapshotted into every immutable plan.
              </Text>
            </div>
            <Badge color="violet">Manual promotion required</Badge>
          </Group>
          <Group mt="md" align="end">
            <Select
              label="Canary instance"
              value={policyCanary}
              data={[
                { value: 'hermes-alica', label: 'Alica' },
                { value: 'hermes-herman', label: 'Herman' },
              ]}
              onChange={(value) =>
                value && setPolicyCanary(value as 'hermes-alica' | 'hermes-herman')
              }
              allowDeselect={false}
            />
            <NumberInput
              label="Observation window (seconds)"
              value={policyWindow}
              min={1}
              max={86400}
              allowDecimal={false}
              onChange={(value) => setPolicyWindow(Number(value))}
            />
            <NumberInput
              label="Required healthy samples"
              value={policySamples}
              min={1}
              max={1000}
              allowDecimal={false}
              onChange={(value) => setPolicySamples(Number(value))}
            />
            <Button
              variant="light"
              onClick={() => void updatePolicy()}
              loading={busy === 'policy'}
              disabled={Boolean(busy) || Boolean(activeRollout)}
            >
              Save release policy
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt="sm">
            Updated {formatDate(snapshot.releasePolicy.updatedAt)}
          </Text>
        </Card>
      ) : null}
      {snapshot?.candidateAssessment?.state === 'ready' ? (
        <Card withBorder aria-label="Governed rollout controls">
          <Title order={3}>Plan rollout targets</Title>
          <Text c="dimmed" size="sm" mb="md">
            Targets are independent. Select only the runtime instances intended for this plan.
          </Text>
          <Group>
            {(['hermes-alica', 'hermes-herman'] as const).map((frameworkId) => (
              <Checkbox
                key={frameworkId}
                label={frameworkId === 'hermes-alica' ? 'Alica' : 'Herman'}
                checked={selected.includes(frameworkId)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.currentTarget.checked
                      ? [...current, frameworkId]
                      : current.filter((item) => item !== frameworkId),
                  )
                }
              />
            ))}
            <Button
              onClick={() => void createPlan()}
              disabled={selected.length === 0 || Boolean(busy) || Boolean(activeRollout)}
              loading={busy === 'plan'}
            >
              Create immutable plan
            </Button>
          </Group>
          {activeRollout ? (
            <Text mt="sm" size="sm" c="dimmed">
              A rollout is executing. New plans remain disabled until it finishes.
            </Text>
          ) : null}
        </Card>
      ) : null}
      {snapshot?.rollouts.map((plan) => (
        <Card withBorder key={plan.planId} aria-label={`Rollout ${plan.planId}`}>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={800}>
                {plan.operationKind === 'rollback' ? 'Governed rollback' : 'Release rollout'}
              </Text>
              <Code>{plan.planId}</Code>
              <Text size="sm" c="dimmed">
                Created {formatDate(plan.createdAt)}
                {plan.sourcePlanId ? ` · source ${plan.sourcePlanId}` : ''}
              </Text>
            </div>
            <Badge color={rolloutColor(plan.state)}>{plan.state.replaceAll('_', ' ')}</Badge>
          </Group>
          <Stack gap="sm" mt="md">
            {plan.targets.map((target) => (
              <div key={target.frameworkId}>
                <Group justify="space-between">
                  <Text fw={700}>{target.frameworkId === 'hermes-alica' ? 'Alica' : 'Herman'}</Text>
                  <Text size="sm">
                    {target.state.replaceAll('_', ' ')} · {target.progress}%
                  </Text>
                </Group>
                <Progress
                  value={target.progress}
                  color={
                    target.state === 'failed' || target.state === 'cancelled'
                      ? 'red'
                      : target.state === 'converged'
                        ? 'teal'
                        : 'blue'
                  }
                  aria-label={`${target.frameworkId} rollout progress`}
                />
                <Text size="xs" c="dimmed" mt={4}>
                  Target {target.targetFrameworkVersion} ·{' '}
                  {target.targetFrameworkCommit.slice(0, 12)} ·{' '}
                  {target.targetImageDigest.slice(0, 20)}…
                </Text>
                <CheckSummary
                  label="Dry-run"
                  checks={target.dryRunChecks}
                  keys={[
                    'candidateReady',
                    'assessmentImmutable',
                    'deploymentUnchanged',
                    'targetDigestPinned',
                    'independentTarget',
                  ]}
                />
                <CheckSummary
                  label="Convergence"
                  checks={target.convergenceChecks}
                  keys={['healthy', 'imageIdentity', 'commitLabel', 'releaseLabel', 'rolledBack']}
                />
                <CheckSummary
                  label="Observation"
                  checks={target.observationChecks}
                  keys={['healthy', 'rollbackVerified']}
                />
                {target.safeErrorReason ? (
                  <Alert color="red" mt="xs">
                    {target.safeErrorReason}
                  </Alert>
                ) : null}
              </div>
            ))}
          </Stack>
          {plan.state === 'observing' || plan.state === 'awaiting_promotion' ? (
            <Alert
              color={plan.state === 'awaiting_promotion' ? 'teal' : 'blue'}
              mt="md"
              title="Canary policy gate"
            >
              Window: {formatDate(plan.observationStartedAt)} →{' '}
              {formatDate(plan.observationDeadlineAt)} · Healthy samples:{' '}
              {plan.observations.filter((item) => item.healthy).length}/
              {String(plan.policySnapshot.requiredHealthySamples ?? '—')}
            </Alert>
          ) : null}
          {plan.failureReason ? (
            <Alert color="red" mt="md" title={plan.failureCode ?? 'ROLLOUT_FAILED'}>
              {plan.failureReason}
            </Alert>
          ) : null}
          <Group mt="md">
            {plan.state === 'planned' ? (
              <Button
                onClick={() => void transition(plan, 'dry-run')}
                loading={busy === 'dry-run'}
                disabled={Boolean(busy)}
              >
                Run dry-run
              </Button>
            ) : null}
            {plan.state === 'dry_run_passed' ? (
              <Button
                onClick={() => void transition(plan, 'approve')}
                loading={busy === 'approve'}
                disabled={Boolean(busy)}
              >
                Approve exact plan
              </Button>
            ) : null}
            {plan.state === 'approved' ? (
              <Button
                color="teal"
                onClick={() => void transition(plan, 'execute')}
                loading={busy === 'execute'}
                disabled={Boolean(busy)}
              >
                Execute approved rollout
              </Button>
            ) : null}
            {plan.state === 'awaiting_promotion' ? (
              <Button
                color="violet"
                onClick={() => void promote(plan)}
                loading={busy === `promote-${plan.planId}`}
                disabled={Boolean(busy)}
              >
                Promote canary to second instance
              </Button>
            ) : null}
            {plan.operationKind === 'release' && ['succeeded', 'partial'].includes(plan.state) ? (
              <>
                <TextInput
                  aria-label="Rollback reason"
                  value={rollbackReason}
                  onChange={(event) => setRollbackReason(event.currentTarget.value)}
                  w={320}
                />
                <Button
                  color="red"
                  variant="light"
                  onClick={() => void rollback(plan)}
                  loading={busy === `rollback-${plan.planId}`}
                  disabled={
                    Boolean(busy) || Boolean(activeRollout) || rollbackReason.trim().length < 3
                  }
                >
                  One-click governed rollback
                </Button>
              </>
            ) : null}
          </Group>
          {plan.events[0] ? (
            <Text size="sm" c="dimmed" mt="md">
              Latest: {plan.events[0].safeMessage} · {formatDate(plan.events[0].occurredAt)}
            </Text>
          ) : null}
          <Accordion mt="md" variant="contained">
            <Accordion.Item value="evidence">
              <Accordion.Control>Complete audit and evidence</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <div>
                    <Text size="sm" fw={700}>
                      Immutable policy snapshot
                    </Text>
                    <Code block>{JSON.stringify(plan.policySnapshot, null, 2)}</Code>
                  </div>
                  {plan.rollbackReason ? (
                    <Text size="sm">
                      <b>Rollback reason:</b> {plan.rollbackReason}
                    </Text>
                  ) : null}
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Time</Table.Th>
                        <Table.Th>Target</Table.Th>
                        <Table.Th>State</Table.Th>
                        <Table.Th>Evidence</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {plan.events.map((event) => (
                        <Table.Tr key={event.eventId}>
                          <Table.Td>{formatDate(event.occurredAt)}</Table.Td>
                          <Table.Td>{event.frameworkId ?? 'plan'}</Table.Td>
                          <Table.Td>{event.state}</Table.Td>
                          <Table.Td>
                            {event.safeMessage}
                            <Code block>{JSON.stringify(event.details, null, 2)}</Code>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  <Text size="sm" fw={700}>
                    Observation evidence ({plan.observations.length})
                  </Text>
                  <Code block>{JSON.stringify(plan.observations, null, 2)}</Code>
                  <Text size="sm" fw={700}>
                    Per-target proof
                  </Text>
                  <Code block>{JSON.stringify(plan.targets, null, 2)}</Code>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Card>
      ))}
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
                color={compatibilityColor(framework.compatibility.status)}
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

function CheckSummary({
  label,
  checks,
  keys,
}: {
  label: string;
  checks: Record<string, unknown>;
  keys: string[];
}) {
  const present = keys.filter((key) => key in checks);
  if (present.length === 0) return null;
  return (
    <Group gap="xs" mt={4} aria-label={`${label} checks`}>
      <Text size="xs" fw={700}>
        {label}:
      </Text>
      {present.map((key) => (
        <Badge key={key} size="xs" color={checks[key] === true ? 'teal' : 'red'} variant="light">
          {key.replaceAll(/([A-Z])/g, ' $1')} {checks[key] === true ? 'passed' : 'failed'}
        </Badge>
      ))}
    </Group>
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

function compatibilityColor(status: string): string {
  if (status === 'current' || status === 'compatible') return 'teal';
  if (status === 'blocked') return 'red';
  return 'yellow';
}

function rolloutColor(state: string): string {
  if (state === 'succeeded') return 'teal';
  if (state === 'failed' || state === 'partial' || state === 'cancelled') return 'red';
  if (state === 'approved' || state === 'dry_run_passed') return 'cyan';
  return 'blue';
}

function relationColor(relation?: string): string {
  if (relation === 'current') return 'teal';
  if (relation === 'update_available') return 'blue';
  return 'yellow';
}
