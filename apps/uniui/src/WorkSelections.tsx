import { Alert, Button, Group, MultiSelect, Select, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { gateway } from './api';

type Option = { value: string; label: string; disabled?: boolean };
type State = { frameworkId: string; ready: boolean; error: string; agents: Option[]; workspaces: Option[] };
export type ProjectSelections = { workspace: string; projectManager: string; agents: string };
export function useWorkInventory(frameworkId: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ frameworkId: '', ready: false, error: '', agents: [], workspaces: [] });
  useEffect(() => {
    let active = true;
    setState({ frameworkId, ready: false, error: '', agents: [], workspaces: [] });
    if (!frameworkId) return;
    Promise.all([gateway.hermesProfiles(frameworkId), gateway.hermesWorkspaces(frameworkId)]).then(([profiles, workspaces]) => {
      if (!active) return;
      setState({ frameworkId, ready: true, error: '',
        agents: profiles.items.map(p => ({ value: String(p.id), label: `${p.displayName || p.id} (${p.id})${p.description ? ' — ' + p.description : ''}` })),
        workspaces: workspaces.items.map(w => ({ value: String(w.path), label: String(w.path) })),
      });
    }).catch(() => { if (active) setState({ frameworkId, ready: false, error: 'Workspace or agent inventory unavailable. Refresh before saving; no manual IDs or paths will be substituted.', agents: [], workspaces: [] }); });
    return () => { active = false; };
  }, [frameworkId, revision]);
  const current = state.frameworkId === frameworkId ? state : { frameworkId, ready: false, error: '', agents: [], workspaces: [] };
  return { ...current, refresh: () => setRevision(n => n + 1) };
}
export type WorkInventory = ReturnType<typeof useWorkInventory>;
export function workerIds(value: string) { return value.split(',').map(v => v.trim()).filter(Boolean); }
export function validSelections(inventory: WorkInventory, form: ProjectSelections) {
  return inventory.ready && (!form.workspace || inventory.workspaces.some(w => w.value === form.workspace)) &&
    (!form.projectManager || inventory.agents.some(a => a.value === form.projectManager)) &&
    workerIds(form.agents).every(id => inventory.agents.some(a => a.value === id));
}
function optionsWithMissing(options: Option[], values: string[]): Option[] {
  return [...options, ...values.filter(v => v && !options.some(o => o.value === v)).map(value => ({ value, label: `${value} — unavailable; select a current entry`, disabled: true }))];
}
export function InventoryControls({ inventory }: { inventory: WorkInventory }) {
  return <div>
    <Group><Button variant="subtle" onClick={inventory.refresh}>Refresh workspace and agent inventory</Button>
      <Button component="a" href={`/agents?framework=${encodeURIComponent(inventory.frameworkId)}`} target="_blank" rel="noopener noreferrer" variant="subtle">Manage agents (new tab)</Button></Group>
    <Text size="xs" c="dimmed">Inventory belongs to {inventory.frameworkId}. Workspace paths are execution directories, not MemoryV4 scopes. Refresh after creating an agent; this form stays open.</Text>
    {inventory.error && <Alert color="red">{inventory.error}</Alert>}
    {!inventory.ready && !inventory.error && <Text role="status">Loading workspace and agent inventory…</Text>}
    {inventory.ready && !inventory.workspaces.length && <Alert color="yellow">No approved writable workspaces are available in this runtime.</Alert>}
  </div>;
}
export function ProjectSelectionFields({ inventory, value, onChange, disabled = false }: {
  inventory: WorkInventory; value: ProjectSelections; onChange: (field: keyof ProjectSelections, value: string) => void; disabled?: boolean;
}) {
  const inactive = disabled || !inventory.ready;
  return <>
    <Select label="Default workspace path" placeholder="Select an approved workspace" searchable allowDeselect={false}
      value={value.workspace || null} data={optionsWithMissing(inventory.workspaces, [value.workspace])} disabled={inactive}
      error={inventory.ready && value.workspace && !inventory.workspaces.some(w => w.value === value.workspace) ? 'Workspace no longer available' : undefined}
      onChange={v => onChange('workspace', v ?? '')} />
    <Select label="Project manager agent" placeholder="Select a project manager" searchable clearable
      value={value.projectManager || null} data={optionsWithMissing(inventory.agents, [value.projectManager])} disabled={inactive}
      error={inventory.ready && value.projectManager && !inventory.agents.some(a => a.value === value.projectManager) ? 'Manager no longer available' : undefined}
      onChange={v => onChange('projectManager', v ?? '')} />
    <MultiSelect label="Worker agents" placeholder="Select worker agents" searchable clearable hidePickedOptions
      value={workerIds(value.agents)} data={optionsWithMissing(inventory.agents, workerIds(value.agents))} disabled={inactive}
      error={inventory.ready && workerIds(value.agents).some(id => !inventory.agents.some(a => a.value === id)) ? 'Remove unavailable workers before saving' : undefined}
      onChange={v => onChange('agents', v.join(', '))} />
  </>;
}
export function TaskAgentSelect({ inventory, value, onChange }: { inventory: WorkInventory; value: string; onChange: (value: string) => void }) {
  return <Select label="Assigned agent" placeholder="Select an agent" searchable clearable value={value || null}
    data={optionsWithMissing(inventory.agents, [value])} disabled={!inventory.ready}
    error={inventory.ready && value && !inventory.agents.some(a => a.value === value) ? 'Agent no longer available' : undefined}
    onChange={v => onChange(v ?? '')} />;
}
