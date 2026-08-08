import {
  Alert,
  Button,
  Checkbox,
  Code,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconEdit, IconShieldCheck } from '@tabler/icons-react';
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiError, memoryMutation } from './api';
import type { MemoryEntity, MemoryRecord } from './types';

type Action =
  | 'record-create'
  | 'record-edit'
  | 'entity-create'
  | 'entity-edit'
  | 'relation-create'
  | 'artifact-create'
  | 'record-promote'
  | 'record-supersede'
  | 'record-transition';

type EditorProps = {
  scope: string;
  selectedRecord: MemoryRecord | null;
  selectedEntity: MemoryEntity | null;
  canWrite: boolean;
  canPromote: boolean;
  canAdmin: boolean;
  onChanged: () => Promise<void>;
};

const roles = ['active', 'evidence', 'exhaust', 'canonical'].map((value) => ({
  value,
  label: value,
}));
const lifecycles = ['working', 'live'].map((value) => ({ value, label: value }));
const transitionStates = ['live', 'working', 'archived', 'expired'].map((value) => ({
  value,
  label: value,
}));
const policies = ['author_only', 'team_editable', 'admin_only', 'immutable'].map((value) => ({
  value,
  label: value,
}));
const objectKinds = ['record', 'entity', 'artifact'].map((value) => ({ value, label: value }));

function initialForm(action: Action, record: MemoryRecord | null, entity: MemoryEntity | null) {
  if (action === 'record-edit' && record)
    return {
      title: record.title,
      content: record.content,
      topic: record.topic ?? '',
      tags: record.tags.join(', '),
      confidence: record.confidence?.toString() ?? '',
      writePolicy: record.write_policy,
      entityType: record.entity?.entity_type ?? '',
      entityId: record.entity?.id ?? '',
      sourceRefs: record.source_refs.join('\n'),
      provenance: JSON.stringify(record.provenance, null, 2),
      attrs: JSON.stringify(record.attrs, null, 2),
    };
  if (action === 'entity-edit' && entity)
    return { name: entity.name, attrs: JSON.stringify(entity.attrs, null, 2) };
  if (action === 'record-supersede' && record)
    return {
      title: record.title,
      content: record.content,
      topic: record.topic ?? '',
      tags: record.tags.join(', '),
      confidence: record.confidence?.toString() ?? '',
      writePolicy: record.write_policy,
      sourceRefs: record.source_refs.join('\n'),
      provenance: JSON.stringify(record.provenance, null, 2),
      attrs: JSON.stringify(record.attrs, null, 2),
      reason: '',
    };
  return {
    role: 'active',
    lifecycle: 'working',
    writePolicy: 'author_only',
    provenance: '{}',
    attrs: '{}',
    fromKind: 'record',
    toKind: 'record',
    transition: 'archived',
  };
}

export function MemoryEditor(props: EditorProps) {
  const actions = useMemo(() => {
    const available: Array<{ value: Action; label: string }> = [];
    if (props.canWrite) {
      available.push(
        { value: 'record-create', label: 'Create record' },
        { value: 'entity-create', label: 'Create entity' },
        { value: 'relation-create', label: 'Create relation' },
        { value: 'artifact-create', label: 'Create artifact' },
      );
      if (props.selectedRecord)
        available.splice(1, 0, { value: 'record-edit', label: 'Edit selected record' });
      if (props.selectedEntity)
        available.push({ value: 'entity-edit', label: 'Edit selected entity' });
    }
    if (props.canPromote && props.selectedRecord)
      available.push({ value: 'record-promote', label: 'Promote selected record' });
    if (props.canAdmin && props.selectedRecord)
      available.push(
        { value: 'record-supersede', label: 'Supersede selected record' },
        { value: 'record-transition', label: 'Transition selected record' },
      );
    return available;
  }, [
    props.canAdmin,
    props.canPromote,
    props.canWrite,
    props.selectedEntity,
    props.selectedRecord,
  ]);
  const [action, setAction] = useState<Action>(actions[0]?.value ?? 'record-create');
  const [form, setForm] = useState<Record<string, string>>(() =>
    initialForm(action, props.selectedRecord, props.selectedEntity),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!actions.some((item) => item.value === action))
      setAction(actions[0]?.value ?? 'record-create');
  }, [action, actions]);
  useEffect(() => {
    setForm(initialForm(action, props.selectedRecord, props.selectedEntity));
    setConfirmed(false);
    setFailure('');
    setSuccess('');
  }, [action, props.selectedEntity, props.selectedRecord]);

  const field = (name: string) => ({
    value: form[name] ?? '',
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      setForm((current) => ({ ...current, [name]: value }));
    },
  });
  const select = (name: string) => ({
    value: form[name] ?? null,
    onChange: (value: string | null) => setForm((current) => ({ ...current, [name]: value ?? '' })),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setFailure('');
    setSuccess('');
    try {
      const result = await executeAction(action, form, props);
      const object = result as { id?: string; title?: string; name?: string; version?: number };
      setSuccess(
        `${actionLabel(action)} completed${object.id ? ` for ${object.title ?? object.name ?? object.id}` : ''}${object.version ? ` at version ${object.version}` : ''}.`,
      );
      setConfirmed(false);
      await props.onChanged();
    } catch (cause) {
      setFailure(editorFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!actions.length)
    return (
      <Alert color="yellow" title="No governed mutation permission">
        Your role can read MemoryV4 but cannot create, edit, promote, supersede or transition
        memory.
      </Alert>
    );

  return (
    <Stack gap="md">
      <div>
        <Text size="xs" fw={800} tt="uppercase">
          Governed mutation workspace
        </Text>
        <Title order={2}>Edit authoritative memory</Title>
        <Text c="dimmed">
          Every action uses the allowlisted Gateway adapter, CSRF protection, a unique idempotency
          key, delegated named-user identity and durable Gateway plus MemoryV4 evidence.
        </Text>
      </div>
      <Alert color="blue" icon={<IconShieldCheck size={18} />} title="Fail-closed governance">
        Versioned actions use the selected object version as an If-Match precondition. A concurrent
        change is reported as a conflict and is never overwritten silently. There is no delete
        action.
      </Alert>
      <Paper withBorder p="lg" component="form" onSubmit={(event) => void submit(event)}>
        <Stack gap="md">
          <Select
            label="Governed action"
            data={actions}
            value={action}
            onChange={(value) => value && setAction(value as Action)}
            allowDeselect={false}
          />
          <SelectionEvidence
            record={props.selectedRecord}
            entity={props.selectedEntity}
            action={action}
          />
          <ActionFields
            action={action}
            form={form}
            field={field}
            select={select}
            canPromote={props.canPromote}
          />
          {props.scope ? (
            <Text size="xs" c="dimmed">
              Mutation scope: <Code>{props.scope}</Code>
            </Text>
          ) : (
            <Text size="xs" c="dimmed">
              Mutation scope: configured adapter root, injected by Gateway.
            </Text>
          )}
          <Checkbox
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            label="I reviewed the target, scope and authoritative effect of this action."
          />
          {failure ? (
            <Alert color="red" title="Governed action rejected" role="alert">
              {failure}
            </Alert>
          ) : null}
          {success ? (
            <Alert color="teal" title="Authoritative change accepted" role="status">
              {success}
            </Alert>
          ) : null}
          <Button
            type="submit"
            loading={busy}
            disabled={!confirmed}
            leftSection={<IconEdit size={16} />}
          >
            {actionLabel(action)}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

type FieldProps = {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};
type SelectProps = { value: string | null; onChange: (value: string | null) => void };

function ActionFields({
  action,
  form,
  field,
  select,
  canPromote,
}: {
  action: Action;
  form: Record<string, string>;
  field: (name: string) => FieldProps;
  select: (name: string) => SelectProps;
  canPromote: boolean;
}) {
  if (action === 'record-create' || action === 'record-edit' || action === 'record-supersede')
    return (
      <Stack gap="sm">
        <TextInput label="Title" required maxLength={240} {...field('title')} />
        <Textarea label="Content" required minRows={8} {...field('content')} />
        {action === 'record-create' ? (
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select
              label="Role"
              data={canPromote ? roles : roles.filter(({ value }) => value !== 'canonical')}
              allowDeselect={false}
              {...select('role')}
            />
            <Select
              label="Lifecycle"
              data={lifecycles}
              allowDeselect={false}
              {...select('lifecycle')}
            />
            <Select
              label="Write policy"
              data={policies}
              allowDeselect={false}
              {...select('writePolicy')}
            />
          </SimpleGrid>
        ) : (
          <Select
            label="Write policy"
            data={policies}
            allowDeselect={false}
            {...select('writePolicy')}
          />
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Topic" maxLength={240} {...field('topic')} />
          <TextInput label="Tags" description="Comma-separated, unique tags" {...field('tags')} />
          <TextInput
            label="Confidence"
            description="Optional number from 0 to 1"
            inputMode="decimal"
            {...field('confidence')}
          />
          <TextInput label="Entity type" {...field('entityType')} />
          <TextInput label="Entity ID" {...field('entityId')} />
        </SimpleGrid>
        <Textarea
          label="Source references"
          description="One inert reference per line"
          minRows={2}
          {...field('sourceRefs')}
        />
        <Textarea label="Provenance JSON object" minRows={3} {...field('provenance')} />
        <Textarea label="Attributes JSON object" minRows={3} {...field('attrs')} />
        {action === 'record-supersede' ? <ReasonField field={field} /> : null}
      </Stack>
    );
  if (action === 'entity-create' || action === 'entity-edit')
    return (
      <Stack gap="sm">
        {action === 'entity-create' ? (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Entity type" required maxLength={100} {...field('entityType')} />
            <TextInput
              label="Entity ID"
              description="Stable identifier; generated upstream if blank"
              maxLength={200}
              {...field('entityId')}
            />
          </SimpleGrid>
        ) : null}
        <TextInput label="Entity name" required maxLength={240} {...field('name')} />
        <Textarea label="Attributes JSON object" minRows={5} {...field('attrs')} />
      </Stack>
    );
  if (action === 'relation-create')
    return (
      <Stack gap="sm">
        <TextInput label="Relation type" required maxLength={100} {...field('relationType')} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="From kind"
            data={objectKinds}
            allowDeselect={false}
            {...select('fromKind')}
          />
          <TextInput label="From ID" required {...field('fromId')} />
          {form.fromKind === 'entity' ? (
            <TextInput label="From entity type" required {...field('fromEntityType')} />
          ) : null}
          <Select label="To kind" data={objectKinds} allowDeselect={false} {...select('toKind')} />
          <TextInput label="To ID" required {...field('toId')} />
          {form.toKind === 'entity' ? (
            <TextInput label="To entity type" required {...field('toEntityType')} />
          ) : null}
        </SimpleGrid>
        <Textarea label="Provenance JSON object" minRows={3} {...field('provenance')} />
      </Stack>
    );
  if (action === 'artifact-create')
    return (
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Artifact type" required maxLength={100} {...field('artifactType')} />
          <TextInput label="URI" required maxLength={2048} {...field('uri')} />
          <TextInput
            label="Checksum"
            description="Optional algorithm:digest"
            {...field('checksum')}
          />
          <TextInput label="Record ID" {...field('recordId')} />
          <TextInput label="Entity type" {...field('entityType')} />
          <TextInput label="Entity ID" {...field('entityId')} />
        </SimpleGrid>
        <Textarea label="Provenance JSON object" minRows={3} {...field('provenance')} />
      </Stack>
    );
  if (action === 'record-transition')
    return (
      <Stack gap="sm">
        <Select
          label="Target lifecycle"
          data={transitionStates}
          allowDeselect={false}
          {...select('transition')}
        />
        <ReasonField field={field} />
      </Stack>
    );
  return <ReasonField field={field} />;
}

function ReasonField({ field }: { field: (name: string) => FieldProps }) {
  return (
    <Textarea
      label="Governance reason"
      description="Required durable reason, at least 8 characters"
      required
      minLength={8}
      minRows={3}
      {...field('reason')}
    />
  );
}

function SelectionEvidence({
  record,
  entity,
  action,
}: {
  record: MemoryRecord | null;
  entity: MemoryEntity | null;
  action: Action;
}) {
  if (action.startsWith('record-') && action !== 'record-create' && record)
    return (
      <Alert color="gray" title="Selected record">
        {record.title} · <Code>{record.id}</Code> · version {record.version} · {record.scope_path}
      </Alert>
    );
  if (action === 'entity-edit' && entity)
    return (
      <Alert color="gray" title="Selected entity">
        {entity.name} ·{' '}
        <Code>
          {entity.entity_type}:{entity.id}
        </Code>{' '}
        · version {entity.version}
      </Alert>
    );
  return null;
}

async function executeAction(action: Action, form: Record<string, string>, props: EditorProps) {
  const scope = props.scope ? { scope_path: props.scope } : {};
  if (action === 'record-create')
    return memoryMutation<MemoryRecord>('/memory/records', 'POST', {
      body: { ...recordBody(form), role: form.role, lifecycle: form.lifecycle, ...scope },
    });
  if (action === 'record-edit' && props.selectedRecord)
    return memoryMutation<MemoryRecord>(
      `/memory/records/${encodeURIComponent(props.selectedRecord.id)}`,
      'PATCH',
      {
        body: recordBody(form),
        version: props.selectedRecord.version,
      },
    );
  if (action === 'record-supersede' && props.selectedRecord)
    return memoryMutation<MemoryRecord>(
      `/memory/records/${encodeURIComponent(props.selectedRecord.id)}/supersede`,
      'POST',
      {
        body: recordBody(form),
        version: props.selectedRecord.version,
        reason: required(form.reason, 'Governance reason'),
      },
    );
  if (action === 'record-promote' && props.selectedRecord)
    return memoryMutation<MemoryRecord>(
      `/memory/records/${encodeURIComponent(props.selectedRecord.id)}/promote`,
      'POST',
      {
        version: props.selectedRecord.version,
        reason: required(form.reason, 'Governance reason'),
      },
    );
  if (action === 'record-transition' && props.selectedRecord)
    return memoryMutation<MemoryRecord>(
      `/memory/records/${encodeURIComponent(props.selectedRecord.id)}/transition`,
      'POST',
      {
        body: { lifecycle: required(form.transition, 'Target lifecycle') },
        version: props.selectedRecord.version,
        reason: required(form.reason, 'Governance reason'),
      },
    );
  if (action === 'entity-create')
    return memoryMutation<MemoryEntity>('/memory/entities', 'POST', {
      body: {
        ...(form.entityId?.trim() ? { id: form.entityId.trim() } : {}),
        entity_type: required(form.entityType, 'Entity type'),
        name: required(form.name, 'Entity name'),
        attrs: jsonObject(form.attrs, 'Attributes'),
        ...scope,
      },
    });
  if (action === 'entity-edit' && props.selectedEntity)
    return memoryMutation<MemoryEntity>(
      `/memory/entities/${encodeURIComponent(props.selectedEntity.entity_type)}/${encodeURIComponent(props.selectedEntity.id)}`,
      'PATCH',
      {
        body: {
          name: required(form.name, 'Entity name'),
          attrs: jsonObject(form.attrs, 'Attributes'),
        },
        version: props.selectedEntity.version,
      },
    );
  if (action === 'relation-create')
    return memoryMutation('/memory/relations', 'POST', {
      body: {
        from: objectRef(form.fromKind, form.fromId, form.fromEntityType),
        to: objectRef(form.toKind, form.toId, form.toEntityType),
        relation_type: required(form.relationType, 'Relation type'),
        provenance: jsonObject(form.provenance, 'Provenance'),
        ...scope,
      },
    });
  if (action === 'artifact-create') {
    const recordId = form.recordId?.trim();
    const entityId = form.entityId?.trim();
    if (!recordId && !entityId) throw new Error('A record ID or entity target is required.');
    return memoryMutation('/memory/artifacts', 'POST', {
      body: {
        record_id: recordId || null,
        entity: entityId
          ? { entity_type: required(form.entityType, 'Entity type'), id: entityId }
          : null,
        artifact_type: required(form.artifactType, 'Artifact type'),
        uri: required(form.uri, 'URI'),
        checksum: form.checksum?.trim() || null,
        provenance: jsonObject(form.provenance, 'Provenance'),
        ...scope,
      },
    });
  }
  throw new Error('Select an authoritative object before using this action.');
}

function recordBody(form: Record<string, string>) {
  const confidence = form.confidence?.trim();
  const entityId = form.entityId?.trim();
  return {
    title: required(form.title, 'Title'),
    content: required(form.content, 'Content'),
    write_policy: required(form.writePolicy, 'Write policy'),
    topic: form.topic?.trim() || null,
    tags: commaList(form.tags),
    confidence: confidence ? boundedConfidence(confidence) : null,
    entity: entityId
      ? { entity_type: required(form.entityType, 'Entity type'), id: entityId }
      : null,
    source_refs: lineList(form.sourceRefs),
    provenance: jsonObject(form.provenance, 'Provenance'),
    attrs: jsonObject(form.attrs, 'Attributes'),
  };
}
function objectRef(
  kind: string | undefined,
  id: string | undefined,
  entityType: string | undefined,
) {
  return {
    kind: required(kind, 'Object kind'),
    id: required(id, 'Object ID'),
    ...(kind === 'entity' ? { entity_type: required(entityType, 'Entity type') } : {}),
  };
}
function required(value: string | undefined, label: string) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}
function commaList(value: string | undefined) {
  const values = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (new Set(values).size !== values.length) throw new Error('Tags must be unique.');
  return values;
}
function lineList(value: string | undefined) {
  return (value ?? '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}
function jsonObject(value: string | undefined, label: string) {
  try {
    const parsed = JSON.parse(value?.trim() || '{}') as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be a valid JSON object.`);
  }
}
function boundedConfidence(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1)
    throw new Error('Confidence must be between 0 and 1.');
  return number;
}
function actionLabel(action: Action) {
  return (
    {
      'record-create': 'Create record',
      'record-edit': 'Save record edit',
      'entity-create': 'Create entity',
      'entity-edit': 'Save entity edit',
      'relation-create': 'Create relation',
      'artifact-create': 'Create artifact',
      'record-promote': 'Promote record',
      'record-supersede': 'Supersede record',
      'record-transition': 'Transition record',
    } satisfies Record<Action, string>
  )[action];
}
function editorFailure(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 403)
      return 'Your UNIFY role does not permit this governed MemoryV4 action.';
    if (cause.status === 412)
      return 'The object changed after it was loaded. Refresh and review the latest version before retrying.';
    return `${cause.failure.message}${cause.failure.requestId ? ` (request ${cause.failure.requestId})` : ''}`;
  }
  return cause instanceof Error ? cause.message : 'The governed MemoryV4 action failed.';
}
