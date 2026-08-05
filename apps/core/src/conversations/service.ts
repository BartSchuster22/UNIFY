import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ulid } from 'ulid';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';

export type ConversationBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'attachment'; readonly attachmentId: string; readonly caption?: string };
export interface ConversationCommand {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly expectedVersion?: number;
  readonly expectedSourceVersion?: number;
}
export interface ConversationRouter {
  send(input: {
    readonly dispatchId: string;
    readonly frameworkId: string;
    readonly profileId: string;
    readonly nativeReference: string;
    readonly conversationId: string;
    readonly messages: readonly { sender: string; blocks: readonly ConversationBlock[] }[];
    readonly externalRoute?: {
      readonly channelId: string;
      readonly channelKind: string;
      readonly secretReference: string;
      readonly externalConversationReference: string;
    };
  }): Promise<{ readonly blocks: readonly ConversationBlock[] }>;
}
export class NativeConversationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409 | 422,
  ) {
    super(message);
    this.name = 'NativeConversationError';
  }
}
interface ResourceRow extends QueryResultRow {
  id: string;
  version: string | number;
  source_version: string | number;
  [key: string]: unknown;
}
interface OperationRow extends QueryResultRow {
  command_type: string;
  payload_digest: Buffer;
  status: string;
  result: Record<string, unknown> | null;
}

export class NativeConversationService {
  constructor(
    private readonly pool: Pool,
    private readonly authentication: AuthenticationService,
  ) {}

  async agents(actor: AuthenticatedPrincipal, context: RequestContext) {
    await this.authentication.authorize(actor, 'chat.read', undefined, context);
    const result = await this.pool.query(
      `SELECT profile.id AS profile_id,profile.framework_id,profile.name AS label,
        CASE WHEN profile.desired_state='active' AND profile.observed_state='active' THEN 'active'
             WHEN profile.desired_state='deleted' THEN 'archived' ELSE 'inactive' END AS state
        ,(profile.desired_state='active' AND profile.observed_state='active') AS selectable
       FROM core.profiles profile JOIN core.frameworks framework ON framework.id=profile.framework_id
       WHERE profile.desired_state<>'deleted' AND framework.desired_state='active'
       ORDER BY profile.name,profile.id`,
    );
    return result.rows;
  }

  async conversations(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    includeArchived = false,
  ) {
    await this.authentication.authorize(actor, 'chat.read', undefined, context);
    const manage = can(actor, 'chat.manage');
    const result = await this.pool.query(
      `SELECT * FROM core.conversations
       WHERE ($1::boolean OR (owner_kind=$2 AND owner_id=$3)) AND ($4::boolean OR state='active')
       ORDER BY updated_at DESC,id`,
      [manage, actor.kind, actor.id, includeArchived],
    );
    return result.rows;
  }

  async conversation(id: string, actor: AuthenticatedPrincipal, context: RequestContext) {
    await this.authentication.authorize(actor, 'chat.read', undefined, context);
    return this.ownedConversation(this.pool, id, actor);
  }

  async history(
    conversationId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    options: { afterSequence?: number; limit?: number } = {},
  ) {
    await this.authentication.authorize(actor, 'chat.read', undefined, context);
    await this.ownedConversation(this.pool, conversationId, actor);
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const result = await this.pool.query(
      `SELECT * FROM core.conversation_messages
       WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3`,
      [conversationId, options.afterSequence ?? 0, limit + 1],
    );
    return {
      messages: result.rows.slice(0, limit),
      hasMore: result.rows.length > limit,
      nextSequence: result.rows.length > limit ? number(result.rows[limit - 1]!.sequence) : null,
    };
  }

  async attachment(
    attachmentId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<{ body: Buffer; mediaType: string; filename: string }> {
    await this.authentication.authorize(actor, 'chat.read', undefined, context);
    const result = await this.pool.query(
      `SELECT * FROM core.conversation_attachments WHERE id=$1`,
      [attachmentId],
    );
    const row = result.rows[0];
    if (!row) throw missing('attachment_not_found');
    if (!can(actor, 'chat.manage') && (row.owner_kind !== actor.kind || row.owner_id !== actor.id))
      throw forbidden();
    if (row.state !== 'available')
      throw new NativeConversationError('attachment_unavailable', 'Attachment is unavailable', 409);
    return {
      body: row.content as Buffer,
      mediaType: String(row.media_type),
      filename: String(row.filename),
    };
  }

  async createConversation(
    input: { profileId: string; title?: string },
    command: ConversationCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'chat.use', undefined, context);
    const conversationId = id('cvs');
    const title = input.title?.trim() || 'New conversation';
    if (title.length > 500) throw invalid('conversation_title_invalid');
    return this.execute(
      'conversation.create.v1',
      conversationId,
      input,
      command,
      actor,
      context,
      async (client) => {
        await availableProfile(client, input.profileId);
        const inserted = await client.query<ResourceRow>(
          `INSERT INTO core.conversations(id,profile_id,title,owner_kind,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [conversationId, input.profileId, title, actor.kind, actor.id],
        );
        return { conversation: inserted.rows[0]! };
      },
    );
  }

  async updateConversation(
    conversationId: string,
    input: { title?: string; state?: 'active' | 'archived' },
    command: ConversationCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'chat.use', undefined, context);
    if (!input.title && !input.state) throw invalid('conversation_update_empty');
    return this.execute(
      'conversation.update.v1',
      conversationId,
      input,
      command,
      actor,
      context,
      async (client) => {
        const before = await this.ownedConversation(client, conversationId, actor, true);
        expected(before, command);
        if (input.title !== undefined && (!input.title.trim() || input.title.length > 500))
          throw invalid('conversation_title_invalid');
        const updated = await client.query<ResourceRow>(
          `UPDATE core.conversations SET title=coalesce($2,title),state=coalesce($3,state),source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [conversationId, input.title ?? null, input.state ?? null],
        );
        return { conversation: updated.rows[0]! };
      },
    );
  }

  async archiveConversation(
    conversationId: string,
    command: ConversationCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'chat.use', undefined, context);
    return this.execute(
      'conversation.delete.v1',
      conversationId,
      {},
      command,
      actor,
      context,
      async (client) => {
        const before = await this.ownedConversation(client, conversationId, actor, true);
        expected(before, command);
        if (before.state === 'archived') return { conversation: before, deleted: true };
        const updated = await client.query<ResourceRow>(
          `UPDATE core.conversations SET state='archived',source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [conversationId],
        );
        return { conversation: updated.rows[0]!, deleted: true };
      },
    );
  }

  async createAttachment(
    input: { filename: string; mediaType: string; content: Buffer; sha256?: string },
    command: ConversationCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'chat.use', undefined, context);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,254}$/.test(input.filename) ||
      input.filename.includes('..')
    )
      throw invalid('attachment_filename_invalid');
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(input.mediaType))
      throw invalid('attachment_media_type_invalid');
    if (!input.content.length || input.content.length > 52_428_800)
      throw invalid('attachment_size_invalid');
    const digest = createHash('sha256').update(input.content).digest('hex');
    if (input.sha256 && input.sha256 !== digest) throw invalid('attachment_digest_mismatch');
    const attachmentId = id('att');
    return this.execute(
      'conversation.attachment.create.v1',
      attachmentId,
      {
        filename: input.filename,
        mediaType: input.mediaType,
        sizeBytes: input.content.length,
        sha256: digest,
      },
      command,
      actor,
      context,
      async (client) => {
        const inserted = await client.query<ResourceRow>(
          `INSERT INTO core.conversation_attachments(id,owner_kind,owner_id,filename,media_type,size_bytes,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,owner_kind,owner_id,filename,media_type,size_bytes,sha256,state,version,created_at,updated_at`,
          [
            attachmentId,
            actor.kind,
            actor.id,
            input.filename,
            input.mediaType,
            input.content.length,
            digest,
            input.content,
          ],
        );
        return { attachment: inserted.rows[0]! };
      },
    );
  }

  async sendMessage(
    conversationId: string,
    input: {
      clientMessageId: string;
      blocks: readonly ConversationBlock[];
      delivery?: 'conversation' | 'external-channel';
    },
    command: ConversationCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'chat.use', undefined, context);
    validateBlocks(input.blocks);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(input.clientMessageId))
      throw invalid('client_message_id_invalid');
    const messageId = id('msg');
    const dispatchId = id('run');
    const contentDigest = createHash('sha256').update(stable(input.blocks)).digest();
    return this.execute(
      'conversation.message.create.v1',
      conversationId,
      input,
      command,
      actor,
      context,
      async (client) => {
        const conversation = await this.ownedConversation(client, conversationId, actor, true);
        if (conversation.state !== 'active')
          throw new NativeConversationError(
            'conversation_archived',
            'Conversation is archived',
            409,
          );
        const delivery = input.delivery ?? 'conversation';
        if (
          (conversation.ownership === 'core' && delivery !== 'conversation') ||
          (conversation.ownership === 'external' && delivery !== 'external-channel')
        )
          throw invalid('message_delivery_invalid');
        const duplicate = await client.query<ResourceRow>(
          `SELECT * FROM core.conversation_messages WHERE conversation_id=$1 AND client_message_id=$2`,
          [conversationId, input.clientMessageId],
        );
        if (duplicate.rows[0]) {
          const existingDigest = createHash('sha256')
            .update(stable(duplicate.rows[0].blocks))
            .digest();
          if (!existingDigest.equals(contentDigest))
            throw new NativeConversationError(
              'duplicate_send_conflict',
              'Client message identifier has different content',
              409,
            );
          return { message: duplicate.rows[0], duplicate: true };
        }
        const sequence = await nextSequence(client, conversationId);
        const inserted = await client.query<ResourceRow>(
          `INSERT INTO core.conversation_messages(id,conversation_id,sender_kind,sender_id,sequence,state,blocks,client_message_id) VALUES($1,$2,$3,$4,$5,'complete',$6,$7) RETURNING *`,
          [
            messageId,
            conversationId,
            actor.kind,
            actor.id,
            sequence,
            JSON.stringify(input.blocks),
            input.clientMessageId,
          ],
        );
        await linkAttachments(client, messageId, input.blocks);
        await client.query(
          `INSERT INTO core.conversation_dispatches(id,conversation_id,request_message_id,profile_id) VALUES($1,$2,$3,$4)`,
          [dispatchId, conversationId, messageId, conversation.profile_id],
        );
        return { message: inserted.rows[0]!, dispatchId, duplicate: false };
      },
    );
  }

  async createChannel(
    input: {
      profileId: string;
      kind: 'telegram' | 'whatsapp' | 'custom';
      label: string;
      secretReference: string;
      externalIdentity?: string;
      sessionPolicy: 'per-external-conversation' | 'single-channel-conversation';
    },
    command: ConversationCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'chat.manage', undefined, context);
    const channelId = id('chn');
    return this.execute(
      'conversation.channel.create.v1',
      channelId,
      input,
      command,
      actor,
      context,
      async (client) => {
        await availableProfile(client, input.profileId);
        const inserted = await client.query<ResourceRow>(
          `INSERT INTO core.conversation_channels(id,profile_id,kind,label,secret_reference,external_identity,session_policy) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            channelId,
            input.profileId,
            input.kind,
            input.label,
            input.secretReference,
            input.externalIdentity ?? null,
            input.sessionPolicy,
          ],
        );
        return { channel: inserted.rows[0]! };
      },
    );
  }

  async channels(actor: AuthenticatedPrincipal, context: RequestContext) {
    await this.authentication.authorize(actor, 'chat.manage', undefined, context);
    return (
      await this.pool.query(`SELECT * FROM core.conversation_channels ORDER BY created_at,id`)
    ).rows;
  }

  async ingestExternal(
    input: {
      channelId: string;
      externalConversationReference: string;
      sourceMessageId: string;
      title: string;
      blocks: readonly ConversationBlock[];
    },
    command: ConversationCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'chat.manage', undefined, context);
    validateBlocks(input.blocks);
    return this.execute(
      'conversation.external-message.ingest.v1',
      input.channelId,
      input,
      command,
      actor,
      context,
      async (client) => {
        const channel = await lock(client, 'conversation_channels', input.channelId);
        if (channel.state !== 'active')
          throw new NativeConversationError('channel_inactive', 'Channel is inactive', 409);
        let conversation = (
          await client.query<ResourceRow>(
            `SELECT * FROM core.conversations WHERE channel_id=$1 AND external_conversation_reference=$2 FOR UPDATE`,
            [input.channelId, input.externalConversationReference],
          )
        ).rows[0];
        if (!conversation) {
          const conversationId = id('cvs');
          conversation = (
            await client.query<ResourceRow>(
              `INSERT INTO core.conversations(id,profile_id,title,ownership,owner_kind,owner_id,channel_id,external_conversation_reference) VALUES($1,$2,$3,'external',$4,$5,$6,$7) RETURNING *`,
              [
                conversationId,
                channel.profile_id,
                input.title,
                actor.kind,
                actor.id,
                input.channelId,
                input.externalConversationReference,
              ],
            )
          ).rows[0]!;
        }
        const existing = (
          await client.query<ResourceRow>(
            `SELECT * FROM core.conversation_messages WHERE conversation_id=$1 AND client_message_id=$2`,
            [conversation.id, input.sourceMessageId],
          )
        ).rows[0];
        if (existing) {
          if (stable(existing.blocks) !== stable(input.blocks))
            throw new NativeConversationError(
              'duplicate_send_conflict',
              'Source message identifier has different content',
              409,
            );
          return { conversation, message: existing, duplicate: true };
        }
        const sequence = await nextSequence(client, conversation.id);
        const message = (
          await client.query<ResourceRow>(
            `INSERT INTO core.conversation_messages(id,conversation_id,sender_kind,sender_id,sequence,state,blocks,client_message_id) VALUES($1,$2,'system',NULL,$3,'complete',$4,$5) RETURNING *`,
            [
              id('msg'),
              conversation.id,
              sequence,
              JSON.stringify(input.blocks),
              input.sourceMessageId,
            ],
          )
        ).rows[0]!;
        await linkAttachments(client, message.id, input.blocks);
        await client.query(
          `INSERT INTO core.conversation_dispatches(id,conversation_id,request_message_id,profile_id) VALUES($1,$2,$3,$4)`,
          [id('run'), conversation.id, message.id, conversation.profile_id],
        );
        return { conversation, message, duplicate: false };
      },
    );
  }

  async processDispatches(
    workerId: string,
    router: ConversationRouter,
    limit = 10,
  ): Promise<readonly Record<string, unknown>[]> {
    if (!/^[A-Za-z0-9._:-]{3,200}$/.test(workerId)) throw invalid('worker_id_invalid');
    const claimed = await this.claimDispatches(workerId, limit);
    const results: Record<string, unknown>[] = [];
    for (const dispatch of claimed) {
      try {
        const history = await this.pool.query(
          `SELECT sender_kind AS sender,blocks FROM core.conversation_messages WHERE conversation_id=$1 ORDER BY sequence`,
          [dispatch.conversation_id],
        );
        const routed = await router.send({
          dispatchId: String(dispatch.id),
          frameworkId: String(dispatch.framework_id),
          profileId: String(dispatch.profile_id),
          nativeReference: String(dispatch.native_reference),
          conversationId: String(dispatch.conversation_id),
          messages: history.rows,
          ...(dispatch.channel_id
            ? {
                externalRoute: {
                  channelId: String(dispatch.channel_id),
                  channelKind: String(dispatch.channel_kind),
                  secretReference: String(dispatch.secret_reference),
                  externalConversationReference: String(dispatch.external_conversation_reference),
                },
              }
            : {}),
        });
        validateBlocks(routed.blocks);
        results.push(await this.completeDispatch(String(dispatch.id), workerId, routed.blocks));
      } catch (error) {
        results.push(await this.failDispatch(String(dispatch.id), workerId, safeError(error)));
      }
    }
    return results;
  }

  async events(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    options: { cursor?: string; limit?: number } = {},
  ) {
    await this.authentication.authorize(actor, 'chat.read', undefined, context);
    const cursor = parseCursor(options.cursor);
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const manage = can(actor, 'chat.manage');
    const result = await this.pool.query(
      `SELECT event.* FROM core.events event
       LEFT JOIN core.conversations conversation ON event.aggregate_kind='conversation' AND conversation.id=event.aggregate_id
       LEFT JOIN core.conversation_attachments attachment ON event.aggregate_kind='attachment' AND attachment.id=event.aggregate_id
       WHERE event.aggregate_kind IN ('conversation','attachment','channel') AND event.global_position>$1
         AND ($2::boolean OR (conversation.owner_kind=$3 AND conversation.owner_id=$4)
              OR (attachment.owner_kind=$3 AND attachment.owner_id=$4))
       ORDER BY event.global_position LIMIT $5`,
      [cursor, manage, actor.kind, actor.id, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const next = rows.length ? String(rows[rows.length - 1]!.global_position) : String(cursor);
    return { events: rows, cursor: next, hasMore: result.rows.length > limit };
  }

  async sseBatch(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    lastEventId?: string,
    limit = 100,
  ) {
    const page =
      lastEventId === undefined
        ? await this.events(actor, context, { limit })
        : await this.events(actor, context, { cursor: lastEventId, limit });
    return {
      ...page,
      body: page.events
        .map(
          (event) =>
            `id: ${event.global_position}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join(''),
    };
  }

  async acknowledgeCursor(
    cursorKey: string,
    position: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'chat.read', undefined, context);
    if (!/^[a-z][a-z0-9._:-]{2,127}$/.test(cursorKey)) throw invalid('cursor_key_invalid');
    const value = parseCursor(position);
    try {
      const result = await this.pool.query(
        `INSERT INTO core.conversation_event_cursors(principal_kind,principal_id,cursor_key,global_position)
         VALUES($1,$2,$3,$4) ON CONFLICT(principal_kind,principal_id,cursor_key)
         DO UPDATE SET global_position=excluded.global_position RETURNING *`,
        [actor.kind, actor.id, cursorKey, value],
      );
      return result.rows[0];
    } catch (error) {
      throw translate(error);
    }
  }

  private async claimDispatches(workerId: string, limit: number) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `WITH candidates AS (
          SELECT id FROM core.conversation_dispatches
          WHERE state='pending' OR (state='dispatching' AND lease_expires_at<clock_timestamp())
          ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
        ) UPDATE core.conversation_dispatches dispatch SET state='dispatching',attempt_count=attempt_count+1,
          lease_owner=$2,lease_expires_at=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
          FROM candidates WHERE dispatch.id=candidates.id
          RETURNING dispatch.*,
            (SELECT framework_id FROM core.profiles WHERE id=dispatch.profile_id) AS framework_id,
            (SELECT native_reference FROM core.profiles WHERE id=dispatch.profile_id) AS native_reference,
            (SELECT channel_id FROM core.conversations WHERE id=dispatch.conversation_id) AS channel_id,
            (SELECT external_conversation_reference FROM core.conversations WHERE id=dispatch.conversation_id) AS external_conversation_reference,
            (SELECT kind FROM core.conversation_channels WHERE id=(SELECT channel_id FROM core.conversations WHERE id=dispatch.conversation_id)) AS channel_kind,
            (SELECT secret_reference FROM core.conversation_channels WHERE id=(SELECT channel_id FROM core.conversations WHERE id=dispatch.conversation_id)) AS secret_reference`,
        [Math.max(1, Math.min(limit, 100)), workerId],
      );
      await client.query('COMMIT');
      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw translate(error);
    } finally {
      client.release();
    }
  }

  private async completeDispatch(
    dispatchId: string,
    workerId: string,
    blocks: readonly ConversationBlock[],
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const dispatch = (
        await client.query<ResourceRow>(
          `SELECT * FROM core.conversation_dispatches WHERE id=$1 FOR UPDATE`,
          [dispatchId],
        )
      ).rows[0];
      if (!dispatch) throw missing('dispatch_not_found');
      if (dispatch.state === 'succeeded') {
        await client.query('COMMIT');
        return { dispatch, replayed: true };
      }
      if (dispatch.state !== 'dispatching' || dispatch.lease_owner !== workerId)
        throw new NativeConversationError(
          'dispatch_lease_lost',
          'Dispatch lease is not owned',
          409,
        );
      const sequence = await nextSequence(client, String(dispatch.conversation_id));
      const messageId = id('msg');
      const message = (
        await client.query<ResourceRow>(
          `INSERT INTO core.conversation_messages(id,conversation_id,sender_kind,sender_id,sequence,state,blocks) VALUES($1,$2,'profile',$3,$4,'complete',$5) RETURNING *`,
          [
            messageId,
            dispatch.conversation_id,
            dispatch.profile_id,
            sequence,
            JSON.stringify(blocks),
          ],
        )
      ).rows[0]!;
      await linkAttachments(client, messageId, blocks);
      const done = (
        await client.query<ResourceRow>(
          `UPDATE core.conversation_dispatches SET state='succeeded',response_message_id=$2,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [dispatchId, messageId],
        )
      ).rows[0]!;
      await this.insertEvent(
        client,
        null,
        'conversation.message.completed.v1',
        String(dispatch.conversation_id),
        id('cor'),
        { messageId, dispatchId },
      );
      await client.query('COMMIT');
      return { dispatch: done, message, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw translate(error);
    } finally {
      client.release();
    }
  }

  private async failDispatch(dispatchId: string, workerId: string, code: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const dispatch = (
        await client.query<ResourceRow>(
          `SELECT * FROM core.conversation_dispatches WHERE id=$1 FOR UPDATE`,
          [dispatchId],
        )
      ).rows[0];
      if (!dispatch) throw missing('dispatch_not_found');
      if (dispatch.state === 'succeeded' || dispatch.state === 'failed') {
        await client.query('COMMIT');
        return { dispatch, replayed: true };
      }
      if (dispatch.lease_owner !== workerId)
        throw new NativeConversationError(
          'dispatch_lease_lost',
          'Dispatch lease is not owned',
          409,
        );
      const failed = (
        await client.query<ResourceRow>(
          `UPDATE core.conversation_dispatches SET state='failed',safe_error_code=$2,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [dispatchId, code],
        )
      ).rows[0]!;
      await this.insertEvent(
        client,
        null,
        'conversation.dispatch.failed.v1',
        String(dispatch.conversation_id),
        id('cor'),
        { dispatchId, code },
      );
      await client.query('COMMIT');
      return { dispatch: failed, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw translate(error);
    } finally {
      client.release();
    }
  }

  private async ownedConversation(
    database: Pool | PoolClient,
    conversationId: string,
    actor: AuthenticatedPrincipal,
    lockRow = false,
  ): Promise<ResourceRow> {
    const result = await database.query<ResourceRow>(
      `SELECT * FROM core.conversations WHERE id=$1${lockRow ? ' FOR UPDATE' : ''}`,
      [conversationId],
    );
    const row = result.rows[0];
    if (!row) throw missing('conversation_not_found');
    if (!can(actor, 'chat.manage') && (row.owner_kind !== actor.kind || row.owner_id !== actor.id))
      throw forbidden();
    return row;
  }

  private async execute(
    commandType: string,
    targetId: string,
    payload: unknown,
    command: ConversationCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    work: (client: PoolClient, operationId: string) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    validateCommand(command);
    const digest = createHash('sha256').update(stable(payload)).digest();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<OperationRow>(
        `SELECT command_type,payload_digest,status,result FROM core.operations WHERE actor_kind=$1 AND actor_id=$2 AND idempotency_key=$3 FOR UPDATE`,
        [actor.kind, actor.id, command.idempotencyKey],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.command_type !== commandType || !row.payload_digest.equals(digest))
          throw new NativeConversationError(
            'idempotency_conflict',
            'Idempotency key was used for a different command',
            409,
          );
        if (row.status !== 'succeeded' || !row.result)
          throw new NativeConversationError(
            'operation_in_progress',
            'Operation is not complete',
            409,
          );
        await client.query('COMMIT');
        return { ...row.result, replayed: true };
      }
      const operationId = id('opc');
      const targetKind = targetId.startsWith('att_')
        ? 'attachment'
        : targetId.startsWith('chn_')
          ? 'channel'
          : 'conversation';
      await client.query(
        `INSERT INTO core.operations(id,command_id,command_type,actor_kind,actor_id,target_kind,target_id,expected_resource_version,idempotency_key,payload_digest,payload,status,started_at,attempt_count)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'running',clock_timestamp(),1)`,
        [
          operationId,
          command.commandId,
          commandType,
          actor.kind,
          actor.id,
          targetKind,
          targetId,
          command.expectedVersion ?? null,
          command.idempotencyKey,
          digest,
          payload,
        ],
      );
      const result = await work(client, operationId);
      const stored = { ...result, operationId, replayed: false };
      await client.query(
        `UPDATE core.operations SET status='succeeded',result=$2,finished_at=clock_timestamp() WHERE id=$1`,
        [operationId, stored],
      );
      await this.insertEvent(
        client,
        operationId,
        commandType.replace(/\.v1$/, '.succeeded.v1'),
        eventConversationId(result, targetId),
        context.correlationId && /^cor_[0-9A-HJKMNP-TV-Z]{26}$/.test(context.correlationId)
          ? context.correlationId
          : id('cor'),
        safeEventPayload(stored),
      );
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      await client.query('ROLLBACK');
      throw translate(error);
    } finally {
      client.release();
    }
  }

  private async insertEvent(
    client: PoolClient,
    operationId: string | null,
    eventType: string,
    conversationId: string,
    correlationId: string,
    payload: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO core.events(id,event_type,aggregate_kind,aggregate_id,operation_id,correlation_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,
      [
        id('evt'),
        eventType,
        conversationId.startsWith('att_')
          ? 'attachment'
          : conversationId.startsWith('chn_')
            ? 'channel'
            : 'conversation',
        conversationId,
        operationId,
        correlationId,
        payload,
      ],
    );
  }
}

async function availableProfile(client: PoolClient, profileId: string) {
  const result = await client.query(`SELECT * FROM core.profiles WHERE id=$1 FOR SHARE`, [
    profileId,
  ]);
  const row = result.rows[0];
  if (!row) throw missing('profile_not_found');
  if (row.desired_state !== 'active' || row.observed_state !== 'active')
    throw new NativeConversationError(
      'profile_unavailable',
      'Selected conversation agent is unavailable',
      409,
    );
  return row;
}
async function lock(
  client: PoolClient,
  table: 'conversation_channels',
  resourceId: string,
): Promise<ResourceRow> {
  const row = (
    await client.query<ResourceRow>(`SELECT * FROM core.${table} WHERE id=$1 FOR UPDATE`, [
      resourceId,
    ])
  ).rows[0];
  if (!row) throw missing('channel_not_found');
  return row;
}
async function nextSequence(client: PoolClient, conversationId: string): Promise<number> {
  const result = await client.query<{ last_sequence: string | number }>(
    `UPDATE core.conversations SET last_sequence=last_sequence+1 WHERE id=$1 RETURNING last_sequence`,
    [conversationId],
  );
  if (!result.rows[0]) throw missing('conversation_not_found');
  return number(result.rows[0].last_sequence);
}
async function linkAttachments(
  client: PoolClient,
  messageId: string,
  blocks: readonly ConversationBlock[],
) {
  for (const block of blocks)
    if (block.kind === 'attachment')
      await client.query(
        `INSERT INTO core.conversation_message_attachments(message_id,attachment_id) VALUES($1,$2)`,
        [messageId, block.attachmentId],
      );
}
function validateBlocks(blocks: readonly ConversationBlock[]) {
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > 100)
    throw invalid('message_blocks_invalid');
  for (const block of blocks) {
    if (block.kind === 'text') {
      if (!block.text.trim() || block.text.length > 100_000) throw invalid('message_text_invalid');
    } else if (block.kind === 'attachment') {
      if (
        !/^att_[0-9A-HJKMNP-TV-Z]{26}$/.test(block.attachmentId) ||
        (block.caption?.length ?? 0) > 5_000
      )
        throw invalid('message_attachment_invalid');
    } else throw invalid('message_block_invalid');
  }
}
function expected(row: ResourceRow, command: ConversationCommand) {
  if (command.expectedVersion === undefined || command.expectedSourceVersion === undefined)
    throw invalid('expected_versions_required');
  if (
    number(row.version) !== command.expectedVersion ||
    number(row.source_version) !== command.expectedSourceVersion
  )
    throw new NativeConversationError('version_conflict', 'Conversation version conflict', 409);
}
function eventConversationId(result: Record<string, unknown>, fallback: string): string {
  const conversation = result.conversation as Record<string, unknown> | undefined;
  const message = result.message as Record<string, unknown> | undefined;
  return String(conversation?.id ?? message?.conversation_id ?? fallback);
}
function safeEventPayload(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {
    operationId: value.operationId,
    replayed: value.replayed,
  };
  for (const key of ['dispatchId', 'duplicate', 'deleted'])
    if (key in value) output[key] = value[key];
  for (const key of ['conversation', 'message', 'attachment', 'channel']) {
    const item = value[key] as Record<string, unknown> | undefined;
    if (item?.id) output[`${key}Id`] = item.id;
  }
  return output;
}
function parseCursor(cursor?: string): string {
  if (cursor === undefined || cursor === '') return '0';
  if (!/^\d{1,20}$/.test(cursor)) throw invalid('cursor_invalid');
  try {
    const value = BigInt(cursor);
    if (value > 9_223_372_036_854_775_807n) throw invalid('cursor_invalid');
    return value.toString();
  } catch (error) {
    if (error instanceof NativeConversationError) throw error;
    throw invalid('cursor_invalid');
  }
}
function can(actor: AuthenticatedPrincipal, permission: string): boolean {
  return actor.permissions.includes(permission) || actor.permissions.includes('*');
}
function forbidden() {
  return new NativeConversationError(
    'conversation_forbidden',
    'Conversation is not owned by this principal',
    403,
  );
}
function validateCommand(command: ConversationCommand) {
  if (!/^cmd_[0-9A-HJKMNP-TV-Z]{26}$/.test(command.commandId)) throw invalid('command_id_invalid');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/.test(command.idempotencyKey))
    throw invalid('idempotency_key_invalid');
}
function stable(value: unknown): string {
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString('base64'));
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function id(prefix: string) {
  return `${prefix}_${ulid()}`;
}
function number(value: unknown) {
  return Number(value);
}
function invalid(code: string) {
  return new NativeConversationError(code, code.replaceAll('_', ' '), 422);
}
function missing(code: string) {
  return new NativeConversationError(code, code.replaceAll('_', ' '), 404);
}
function safeError(error: unknown) {
  const code = error instanceof NativeConversationError ? error.code : 'router_failed';
  return /^[a-z][a-z0-9_]{2,127}$/.test(code) ? code : 'router_failed';
}
function translate(error: unknown): unknown {
  if (error instanceof NativeConversationError) return error;
  const candidate = error as { code?: string };
  if (candidate.code === '23505')
    return new NativeConversationError(
      'conversation_conflict',
      'Conversation resource conflicts with existing state',
      409,
    );
  if (candidate.code === '23503') return invalid('conversation_reference_invalid');
  if (candidate.code === '23514' || candidate.code === '22023')
    return invalid('conversation_constraint_invalid');
  if (candidate.code === '40001')
    return new NativeConversationError('version_conflict', 'Resource version conflict', 409);
  return error;
}
