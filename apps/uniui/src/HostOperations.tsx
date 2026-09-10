import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Stack, Table, Text, Title } from '@mantine/core';
import { api } from './api';

type Report = {
  observedAt: number; stale: boolean; ageSeconds: number; maintenance: boolean;
  snapshot: { dockerAvailable: boolean; ownershipVerified: boolean; storagePressure: boolean;
    storageAvailableBytes: number; memoryAvailableBytes: number;
    nativeWork: { active: number | null; observed: boolean };
    services: Record<string, { state: string; reason: string; running: boolean }> };
  decisions: Record<string, string>;
  incidents: { id: string; service: string; reason: string; state: string }[];
  audit: { seq: number; at: number; action: string; service: string; outcome: string }[];
};

export function HostOperations() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(Date.now());
  const stale = !!report && (report.stale || now / 1000 - report.observedAt > 20 || now / 1000 < report.observedAt - 1);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const value = await api<Report>('/host-operations', { signal: AbortSignal.timeout(8000) }); if (active) { setReport(value); setNow(Date.now()); setError(null); } }
      catch { if (active) { setError('Host operations unavailable. Health is unknown; do not infer recovery.'); setReport(null); } }
    };
    void refresh(); const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [tick]);
  return <Stack gap="sm" mb="xl" aria-label="Host operations">
    <Group justify="space-between"><Title order={3}>Host operations · Doghouse DSH</Title>
      <Button size="xs" variant="light" onClick={() => setTick(tick + 1)}>Refresh host status</Button></Group>
    {error && <Alert color="red">{error}</Alert>}
    {report && <>
      {stale && <Alert color="red">STALE observation — current health is unknown. Check the host observer and broker.</Alert>}
      {report.maintenance && <Alert color="yellow">Maintenance enabled. Automatic recovery is suppressed.</Alert>}
      <Text size="sm">Observed {Math.max(0, Math.round(now / 1000 - report.observedAt))}s ago · Docker {report.snapshot.dockerAvailable ? 'reachable' : 'unavailable'} · Ownership {report.snapshot.ownershipVerified ? 'verified' : 'UNVERIFIED'}</Text>
      <Text size="sm">Available memory {(report.snapshot.memoryAvailableBytes / 1024 ** 3).toFixed(2)} GiB · Free storage {(report.snapshot.storageAvailableBytes / 1024 ** 3).toFixed(2)} GiB{report.snapshot.storagePressure ? ' — PRESSURE' : ''} · Native active work {report.snapshot.nativeWork.observed ? report.snapshot.nativeWork.active : 'unknown'}</Text>
      <Table striped withTableBorder><Table.Thead><Table.Tr><Table.Th>Service</Table.Th><Table.Th>Health</Table.Th><Table.Th>Recovery decision</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
        {Object.entries(report.snapshot.services).map(([name, value]) => <Table.Tr key={name}><Table.Td>{name}</Table.Td><Table.Td><Badge color={!stale && value.state === 'healthy' ? 'green' : 'red'}>{stale ? 'unknown / stale' : value.state}</Badge></Table.Td><Table.Td>{report.decisions[name] ?? 'manual lifecycle owner'}</Table.Td></Table.Tr>)}
      </Table.Tbody></Table>
      <Title order={4}>Persistent incidents</Title>
      {report.incidents.length === 0 ? <Text size="sm">No recorded incidents.</Text> : report.incidents.map(i => <Text size="sm" key={i.id}>{i.service}: {i.reason} — {i.state.startsWith('resolved:') ? 'resolved' : i.state} · {i.id}</Text>)}
      <Text size="sm">Actionable exceptions: inspect dependency health, capacity, native work and the incident ID. Only the host operator may clear maintenance or acknowledge an uncertain/circuit-open recovery. Do not replay business work from this screen.</Text>
      <Title order={4}>Redacted operational audit</Title>
      {report.audit.slice(0, 15).map(a => <Text size="xs" key={a.seq}>{new Date(a.at * 1000).toISOString()} · {a.service} · {a.action} · {a.outcome}</Text>)}
      <Text size="xs" c="dimmed">Provenance: Linux resource observations and native Kanban read-only counts. These are not model-token or billing measurements. Raw application logs, prompts, credentials and callback bodies are not exposed.</Text>
    </>}
  </Stack>;
}
