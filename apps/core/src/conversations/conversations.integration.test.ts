import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { ulid } from 'ulid';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import { migrateDatabase, verifyDatabase } from '../database/migrations.js';
import {
  NativeConversationError,
  NativeConversationService,
  type ConversationCommand,
  type ConversationRouter,
} from './service.js';

const databaseUrl = process.env.UNIFY_CONVERSATION_TEST_DATABASE_URL;
const FRAMEWORK_ID = `frm_${ulid()}`;
const PROFILE_ID = `prf_${ulid()}`;
const USER_ID = `usr_${ulid()}`;
const OTHER_USER_ID = `usr_${ulid()}`;
const SERVICE_ID = `svc_${ulid()}`;
const actor = principal('user', USER_ID, ['chat.read', 'chat.use', 'chat.manage']);
const otherActor = principal('user', OTHER_USER_ID, ['chat.read', 'chat.use']);
const channelActor = principal('service', SERVICE_ID, ['chat.read', 'chat.use', 'chat.manage']);
const context: RequestContext = {
  remoteAddress: '127.0.0.1',
  requestId: `req_${ulid()}`,
  correlationId: `cor_${ulid()}`,
};
let sequence = 0;
const command = (
  suffix: string,
  expectedVersion?: number,
  expectedSourceVersion?: number,
): ConversationCommand => ({
  commandId: `cmd_${ulid()}`,
  idempotencyKey: `phase9:${suffix}:${++sequence}:${ulid()}`,
  ...(expectedVersion === undefined ? {} : { expectedVersion }),
  ...(expectedSourceVersion === undefined ? {} : { expectedSourceVersion }),
});

test(
  'native conversations provide authorized durable sessions, attachments, routing, replay and duplicate protection on PostgreSQL',
  { skip: !databaseUrl },
  async () => {
    const parsed = new URL(databaseUrl!);
    assert.match(
      parsed.pathname,
      /^\/unify_core_conversation_test(?:_|$)/,
      'integration database name must start with unify_core_conversation_test',
    );
    const pool = new Pool({ connectionString: databaseUrl, max: 12 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS core CASCADE');
      const migrated = await migrateDatabase(pool);
      assert.deepEqual(migrated.applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      await verifyDatabase(pool);
      await seed(pool);

      const authorized: string[] = [];
      const authentication = {
        authorize: async (_actor: unknown, permission: string) => {
          authorized.push(permission);
        },
      } as unknown as AuthenticationService;
      const service = new NativeConversationService(pool, authentication);

      const agents = await service.agents(actor, context);
      assert.equal(agents.length, 1);
      assert.equal(agents[0]?.profile_id, PROFILE_ID);
      assert.equal(agents[0]?.selectable, true);

      const create = command('create');
      const created = await service.createConversation(
        { profileId: PROFILE_ID, title: 'Native conversation' },
        create,
        actor,
        context,
      );
      const conversation = created.conversation as Record<string, unknown>;
      const conversationId = String(conversation.id);
      assert.equal(conversation.ownership, 'core');
      assert.equal(conversation.owner_id, USER_ID);
      const replay = await service.createConversation(
        { profileId: PROFILE_ID, title: 'Native conversation' },
        create,
        actor,
        context,
      );
      assert.equal(replay.replayed, true);
      assert.equal((replay.conversation as Record<string, unknown>).id, conversationId);
      await rejectsCode(
        service.createConversation(
          { profileId: PROFILE_ID, title: 'Changed payload' },
          create,
          actor,
          context,
        ),
        'idempotency_conflict',
      );
      await rejectsCode(
        service.conversation(conversationId, otherActor, context),
        'conversation_forbidden',
      );

      const content = Buffer.from('phase-9-attachment');
      const digest = createHash('sha256').update(content).digest('hex');
      const uploaded = await service.createAttachment(
        { filename: 'evidence.txt', mediaType: 'text/plain', content, sha256: digest },
        command('attachment'),
        actor,
        context,
      );
      const attachmentId = String((uploaded.attachment as Record<string, unknown>).id);
      const downloaded = await service.attachment(attachmentId, actor, context);
      assert.equal(downloaded.body.toString(), content.toString());
      await rejectsCode(
        service.attachment(attachmentId, otherActor, context),
        'conversation_forbidden',
      );

      const send = await service.sendMessage(
        conversationId,
        {
          clientMessageId: 'client-message:0001',
          blocks: [
            { kind: 'text', text: 'Process this attachment' },
            { kind: 'attachment', attachmentId, caption: 'Evidence' },
          ],
          delivery: 'conversation',
        },
        command('send'),
        actor,
        context,
      );
      assert.equal(send.duplicate, false);
      const duplicate = await service.sendMessage(
        conversationId,
        {
          clientMessageId: 'client-message:0001',
          blocks: [
            { kind: 'text', text: 'Process this attachment' },
            { kind: 'attachment', attachmentId, caption: 'Evidence' },
          ],
          delivery: 'conversation',
        },
        command('send-duplicate'),
        actor,
        context,
      );
      assert.equal(duplicate.duplicate, true);
      await rejectsCode(
        service.sendMessage(
          conversationId,
          {
            clientMessageId: 'client-message:0001',
            blocks: [{ kind: 'text', text: 'Different content' }],
          },
          command('send-conflict'),
          actor,
          context,
        ),
        'duplicate_send_conflict',
      );

      const concurrent = await Promise.all(
        ['0002', '0003', '0004', '0005'].map((suffix) =>
          service.sendMessage(
            conversationId,
            {
              clientMessageId: `client-message:${suffix}`,
              blocks: [{ kind: 'text' as const, text: `message ${suffix}` }],
            },
            command(`send-${suffix}`),
            actor,
            context,
          ),
        ),
      );
      assert.equal(concurrent.length, 4);

      const routed: Array<{ dispatchId: string; external: boolean }> = [];
      const router: ConversationRouter = {
        async send(input) {
          routed.push({ dispatchId: input.dispatchId, external: Boolean(input.externalRoute) });
          return { blocks: [{ kind: 'text', text: `response ${input.dispatchId}` }] };
        },
      };
      const dispatchResults = (
        await Promise.all([
          service.processDispatches('worker-a', router, 20),
          service.processDispatches('worker-b', router, 20),
        ])
      ).flat();
      assert.equal(dispatchResults.length, 5);
      assert.equal(new Set(routed.map((item) => item.dispatchId)).size, 5);
      assert.equal(
        routed.every((item) => !item.external),
        true,
      );

      const history = await service.history(conversationId, actor, context, { limit: 50 });
      assert.equal(history.messages.length, 10);
      assert.deepEqual(
        history.messages.map((item) => Number(item.sequence)),
        Array.from({ length: 10 }, (_, index) => index + 1),
      );
      const link = await pool.query(
        `SELECT 1 FROM core.conversation_message_attachments WHERE attachment_id=$1`,
        [attachmentId],
      );
      assert.equal(link.rowCount, 1);

      const firstEvents = await service.events(actor, context, { limit: 2 });
      assert.equal(firstEvents.events.length, 2);
      const resumed = await service.events(actor, context, {
        cursor: firstEvents.cursor,
        limit: 500,
      });
      assert.equal(
        resumed.events.some(
          (item) => BigInt(String(item.global_position)) <= BigInt(firstEvents.cursor),
        ),
        false,
      );
      const sse = await service.sseBatch(actor, context, firstEvents.cursor, 10);
      assert.match(sse.body, /^id: \d+\nevent: conversation\./);
      const acknowledged = await service.acknowledgeCursor(
        'dashboard-primary',
        firstEvents.cursor,
        actor,
        context,
      );
      assert.equal(String(acknowledged.global_position), firstEvents.cursor);
      await service.acknowledgeCursor('dashboard-primary', resumed.cursor, actor, context);
      await rejectsCode(
        service.acknowledgeCursor('dashboard-primary', firstEvents.cursor, actor, context),
        'version_conflict',
      );
      await rejectsCode(
        service.acknowledgeCursor('cursor-too-far', '9223372036854775807', actor, context),
        'conversation_constraint_invalid',
      );

      const channelCreated = await service.createChannel(
        {
          profileId: PROFILE_ID,
          kind: 'telegram',
          label: 'Telegram support',
          secretReference: 'secret://channels/telegram/support',
          externalIdentity: '@support',
          sessionPolicy: 'per-external-conversation',
        },
        command('channel'),
        channelActor,
        context,
      );
      const channelId = String((channelCreated.channel as Record<string, unknown>).id);
      const inbound = {
        channelId,
        externalConversationReference: 'telegram:chat:42:thread:7',
        sourceMessageId: 'telegram-update:00000001',
        title: 'Telegram thread 7',
        blocks: [{ kind: 'text' as const, text: 'External inbound message' }],
      };
      const ingested = await service.ingestExternal(
        inbound,
        command('external-inbound'),
        channelActor,
        context,
      );
      const externalConversation = ingested.conversation as Record<string, unknown>;
      const externalConversationId = String(externalConversation.id);
      assert.equal(externalConversation.ownership, 'external');
      assert.equal(externalConversation.channel_id, channelId);
      const inboundDuplicate = await service.ingestExternal(
        inbound,
        command('external-duplicate'),
        channelActor,
        context,
      );
      assert.equal(inboundDuplicate.duplicate, true);
      await rejectsCode(
        service.ingestExternal(
          { ...inbound, blocks: [{ kind: 'text', text: 'Conflicting inbound content' }] },
          command('external-conflict'),
          channelActor,
          context,
        ),
        'duplicate_send_conflict',
      );
      await rejectsCode(
        service.sendMessage(
          externalConversationId,
          {
            clientMessageId: 'external-reply:00000001',
            blocks: [{ kind: 'text', text: 'Wrong route' }],
            delivery: 'conversation',
          },
          command('external-wrong-delivery'),
          channelActor,
          context,
        ),
        'message_delivery_invalid',
      );
      await service.sendMessage(
        externalConversationId,
        {
          clientMessageId: 'external-reply:00000001',
          blocks: [{ kind: 'text', text: 'Native external reply' }],
          delivery: 'external-channel',
        },
        command('external-reply'),
        channelActor,
        context,
      );
      await service.processDispatches('worker-external', router, 10);
      assert.equal(routed.filter((item) => item.external).length, 2);

      const current = await service.conversation(conversationId, actor, context);
      await service.archiveConversation(
        conversationId,
        command('archive', Number(current.version), Number(current.source_version)),
        actor,
        context,
      );
      await rejectsCode(
        service.sendMessage(
          conversationId,
          {
            clientMessageId: 'client-message:archived',
            blocks: [{ kind: 'text', text: 'Must not send' }],
          },
          command('send-archived'),
          actor,
          context,
        ),
        'conversation_archived',
      );

      await assert.rejects(
        pool.query(
          `INSERT INTO core.conversation_messages(id,conversation_id,sender_kind,sender_id,sequence,state,blocks)
           VALUES($1,$2,'profile',$3,999,'complete',$4)`,
          [
            `msg_${ulid()}`,
            externalConversationId,
            PROFILE_ID,
            JSON.stringify([{ kind: 'text', text: 'bad' }]),
          ],
        ),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
      assert.equal(authorized.includes('chat.read'), true);
      assert.equal(authorized.includes('chat.use'), true);
      assert.equal(authorized.includes('chat.manage'), true);
    } finally {
      await pool.end();
    }
  },
);

function principal(
  kind: 'user' | 'service',
  id: string,
  permissions: string[],
): AuthenticatedPrincipal {
  if (kind === 'service')
    return {
      kind,
      id,
      name: 'Conversation Channel',
      roles: ['core.admin'],
      permissions,
      credentialId: `crd_${ulid()}`,
      credentialScopes: permissions,
    };
  return {
    kind,
    id,
    username: 'user-conversation-test',
    displayName: 'User Conversation Test',
    roles: ['core.admin'],
    permissions,
    mfaVerified: true,
    passwordChangeRequired: false,
    sessionId: `ses_${ulid()}`,
  };
}

async function seed(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO core.frameworks(id,name,endpoint,credential_reference,desired_state)
     VALUES($1,'Conversation Test','https://10.80.0.3','secret://frameworks/conversation-test','active')`,
    [FRAMEWORK_ID],
  );
  await pool.query(
    `INSERT INTO core.profiles(id,framework_id,native_reference,name,desired_state,observed_state)
     VALUES($1,$2,'conversation-agent','Conversation Agent','active','active')`,
    [PROFILE_ID, FRAMEWORK_ID],
  );
  await pool.query(
    `INSERT INTO core.identities(id,username,display_name,password_hash) VALUES
      ($1,'conversation-owner','Conversation Owner','$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      ($2,'conversation-other','Conversation Other','$argon2id$v=19$m=65536,t=3,p=4$BBBBBBBBBBBBBBBBBBBBBB$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')`,
    [USER_ID, OTHER_USER_ID],
  );
  await pool.query(
    `INSERT INTO core.service_principals(id,name) VALUES($1,'conversation-channel')`,
    [SERVICE_ID],
  );
}

async function rejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof NativeConversationError && error.code === code,
  );
}
