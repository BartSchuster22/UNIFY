import { useState } from 'react';
import { Accordion, Alert, Button, Checkbox, Group, ScrollArea, Select, Stack, Text, TextInput, Title } from '@mantine/core';
export type AgentModelRef = { provider: string; model: string; ref?: string };
export type AgentRuntimeSettings = { primary: AgentModelRef | null; fallbacks: AgentModelRef[]; tools: Record<string, boolean>; skills: Record<string, boolean> };
export type AgentRuntimeInventory = {
  available: boolean; reason?: string; settings?: AgentRuntimeSettings;
  models?: Array<AgentModelRef & { authenticated: boolean }>;
  tools?: Array<{ id: string; label: string; platform: string; configured: boolean; tools: string[] }>;
  skills?: Array<{ id: string; description: string }>;
};
export function AgentRuntimeSections({ inventory, value, disabled, onChange }: { inventory: AgentRuntimeInventory | undefined; value: AgentRuntimeSettings | undefined; disabled: boolean; onChange: (value: AgentRuntimeSettings) => void }) {
  const [toolFilter, setToolFilter] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  if (!inventory?.available || !value) return <Alert color="yellow">{inventory?.reason ?? 'Runtime options load from an existing profile. Create the agent first, then Edit to configure its actual models, tools and installed skills.'} No runtime settings will be replaced.</Alert>;
  const key = (m: AgentModelRef) => JSON.stringify({ provider: m.provider, model: m.model });
  const options: Array<{ value: string; label: string; disabled?: boolean }> = (inventory.models ?? []).map(m => ({ value: key(m), label: `${m.model} · ${m.provider}${m.authenticated ? '' : ' (needs authorization)'}` }));
  for (const m of [value.primary, ...value.fallbacks]) if (m?.model && !options.some(o => o.value === key(m))) options.push({ value: key(m), disabled: true, label: `${m.model} · ${m.provider} (saved; absent from current catalog)` });
  const choose = (s: string | null): AgentModelRef | null => s ? JSON.parse(s) as AgentModelRef : null;
  const updateFallback = (i: number, m: AgentModelRef) => onChange({ ...value, fallbacks: value.fallbacks.map((old, index) => index === i ? { ...m, ...(old.ref && old.provider === m.provider ? { ref: old.ref } : {}) } : old) });
  const move = (i: number, delta: number) => { const rows = [...value.fallbacks]; [rows[i], rows[i + delta]] = [rows[i + delta]!, rows[i]!]; onChange({ ...value, fallbacks: rows }); };
  return <Stack>
    <Title order={3}>Models and ordered fallbacks</Title>
    <Text size="sm">Choices come from this profile's native provider/model catalog. Authorization status is not a connectivity, quota or failover test. Save does not make a model request or copy credentials.</Text>
    <Select label="Primary model" searchable data={options} value={value.primary ? key(value.primary) : null} placeholder="Native default—not explicitly selected" disabled={disabled} onChange={s => { const m = choose(s); if (m) onChange({ ...value, primary: m }); }} />
    {value.fallbacks.map((m, i) => <Stack key={i} gap="xs">
      <Select label={`Fallback ${i + 1} model`} searchable data={options} value={m.model ? key(m) : null} disabled={disabled} onChange={s => { const next = choose(s); if (next) updateFallback(i, next); }} />
      <Group><Button size="compact-xs" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move fallback ${i + 1} up`}>Up</Button><Button size="compact-xs" disabled={disabled || i === value.fallbacks.length - 1} onClick={() => move(i, 1)} aria-label={`Move fallback ${i + 1} down`}>Down</Button><Button size="compact-xs" color="red" disabled={disabled} onClick={() => onChange({ ...value, fallbacks: value.fallbacks.filter((_, n) => n !== i) })} aria-label={`Remove fallback ${i + 1}`}>Remove</Button></Group>
    </Stack>)}
    <Button variant="light" disabled={disabled || value.fallbacks.length >= 20} onClick={() => onChange({ ...value, fallbacks: [...value.fallbacks, { provider: '', model: '' }] })}>Add fallback</Button>
    <Text size="xs" c="dimmed">Order is the native fallback chain. Existing advanced route fields are preserved for unchanged routes. Changing a provider uses native endpoint/credential-reset semantics; provider credential stores are not edited.</Text>
    <Accordion multiple>
      <Accordion.Item value="tools"><Accordion.Control>Tools</Accordion.Control><Accordion.Panel><Stack>
        <Text size="sm">Native configurable toolsets, with their configuration platform and prerequisite status. Enabled does not mean usable without setup. MCP configuration and other platform overrides are preserved.</Text>
        <TextInput label="Filter native toolsets" value={toolFilter} onChange={e => setToolFilter(e.currentTarget.value)} />
        <ScrollArea h={260}><Stack>{(inventory.tools ?? []).filter(t => `${t.id} ${t.label}`.toLowerCase().includes(toolFilter.toLowerCase())).map(t => <Checkbox key={t.id} aria-label={`Enable toolset ${t.id}`} label={`${t.label} (${t.platform})`} description={`${t.configured ? 'Prerequisites configured' : 'Needs setup'} · ${t.tools.join(', ') || 'Native configuration capability'}`} checked={value.tools[t.id] === true} disabled={disabled} onChange={e => onChange({ ...value, tools: { ...value.tools, [t.id]: e.currentTarget.checked } })} />)}</Stack></ScrollArea>
      </Stack></Accordion.Panel></Accordion.Item>
      <Accordion.Item value="skills"><Accordion.Control>Skills</Accordion.Control><Accordion.Panel><Stack>
        <Text size="sm">Actual installed skills visible to this profile. Toggles change the native global disabled list; platform-specific restrictions still apply. No installs, deletions or skill content edits.</Text>
        <TextInput label="Filter installed skills" value={skillFilter} onChange={e => setSkillFilter(e.currentTarget.value)} />
        <ScrollArea h={260}><Stack>{(inventory.skills ?? []).filter(s => `${s.id} ${s.description}`.toLowerCase().includes(skillFilter.toLowerCase())).map(s => <Checkbox key={s.id} aria-label={`Enable skill ${s.id}`} label={s.id} description={s.description} checked={value.skills[s.id] === true} disabled={disabled} onChange={e => onChange({ ...value, skills: { ...value.skills, [s.id]: e.currentTarget.checked } })} />)}</Stack></ScrollArea>
      </Stack></Accordion.Panel></Accordion.Item>
    </Accordion>
  </Stack>;
}
