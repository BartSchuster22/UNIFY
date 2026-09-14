import { Alert, Code, Divider, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
export type AgentSections = { instructions: string; memory: string; userMemory: string };
export type AgentLimits = { instructions: number; memory: number; userMemory: number };
export const emptyAgentSections = (): AgentSections => ({ instructions: '', memory: '', userMemory: '' });
export const defaultAgentLimits: AgentLimits = { instructions: 65536, memory: 2200, userMemory: 1375 };
export function AgentEditorSections({ id, description, sections, limits, editing, disabled, idError, onId, onDescription, onSections }: {
  id: string; description: string; sections: AgentSections; limits: AgentLimits; editing: boolean; disabled: boolean; idError?: string | undefined;
  onId: (value: string) => void; onDescription: (value: string) => void; onSections: (value: AgentSections) => void;
}) {
  return <Stack>
    <Title order={3}>Identity</Title>
    <TextInput label="Agent ID" description="Native Hermes profile identity. Existing IDs use the separate Rename action." value={id} disabled={editing || disabled} error={idError} onChange={e => onId(e.currentTarget.value)} />
    <Textarea label="Agent description" description="Routing description, persisted in this profile's profile.yaml." minRows={3} maxLength={5000} value={description} disabled={disabled} onChange={e => onDescription(e.currentTarget.value)} />
    <Divider /><Title order={3}>Instructions</Title>
    <Text size="sm">Authoritative identity, role, and behavior: <Code>SOUL.md</Code>. An empty file uses Hermes's default identity. This does not edit project instructions.</Text>
    <Textarea label="Agent instructions (SOUL.md)" rows={8} styles={{ input: { resize: 'vertical' } }} value={sections.instructions} disabled={disabled} onChange={e => onSections({ ...sections, instructions: e.currentTarget.value })} description={`${sections.instructions.length} / ${limits.instructions} characters`} error={sections.instructions.length > limits.instructions ? 'Instructions exceed the supported limit' : undefined} />
    <Divider /><Title order={3}>Memory</Title>
    <Text size="sm">These are this profile's native persistent memory files—not conversation history or MemoryV4 scopes. Separate entries with a line containing §. Hermes normalizes surrounding whitespace and duplicate entries.</Text>
    <Textarea label="Agent memory (MEMORY.md)" rows={5} styles={{ input: { resize: 'vertical' } }} value={sections.memory} disabled={disabled} onChange={e => onSections({ ...sections, memory: e.currentTarget.value })} description={`${sections.memory.length} / ${limits.memory} characters; memories/MEMORY.md`} error={sections.memory.length > limits.memory ? 'Memory exceeds the configured limit' : undefined} />
    <Textarea label="User memory (USER.md)" rows={5} styles={{ input: { resize: 'vertical' } }} value={sections.userMemory} disabled={disabled} onChange={e => onSections({ ...sections, userMemory: e.currentTarget.value })} description={`${sections.userMemory.length} / ${limits.userMemory} characters; memories/USER.md`} error={sections.userMemory.length > limits.userMemory ? 'User memory exceeds the configured limit' : undefined} />
    <Alert color="blue">Human and agent edits share these files. Stale saves are rejected; backups precede file replacement. New sessions load the saved configuration; existing sessions can retain a frozen memory snapshot. Saving does not restart or run the agent.</Alert>
  </Stack>;
}
