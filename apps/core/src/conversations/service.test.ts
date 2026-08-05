import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import { NativeConversationError, NativeConversationService } from './service.js';

const actor: AuthenticatedPrincipal = {
  kind: 'user',
  id: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  username: 'conversation-unit',
  displayName: 'Conversation Unit',
  roles: ['core.admin'],
  permissions: ['chat.read', 'chat.use', 'chat.manage'],
  mfaVerified: true,
  passwordChangeRequired: false,
  sessionId: 'ses_01ARZ3NDEKTSV4RRFFQ69G5FAW',
};
const context: RequestContext = { remoteAddress: '127.0.0.1' };
const authentication = {
  authorize: async () => undefined,
} as unknown as AuthenticationService;
const unavailablePool = {} as Pool;
const service = new NativeConversationService(unavailablePool, authentication);

test('rejects malformed message blocks and client identifiers before persistence', async () => {
  await rejectsCode(
    service.sendMessage(
      'cvs_01ARZ3NDEKTSV4RRFFQ69G5FAX',
      { clientMessageId: 'short', blocks: [{ kind: 'text', text: 'valid' }] },
      command(),
      actor,
      context,
    ),
    'client_message_id_invalid',
  );
  await rejectsCode(
    service.sendMessage(
      'cvs_01ARZ3NDEKTSV4RRFFQ69G5FAX',
      { clientMessageId: 'client-message:valid', blocks: [{ kind: 'text', text: '   ' }] },
      command(),
      actor,
      context,
    ),
    'message_text_invalid',
  );
});

test('rejects unsafe attachment metadata, content, and digests before persistence', async () => {
  await rejectsCode(
    service.createAttachment(
      { filename: '../', mediaType: 'text/plain', content: Buffer.from('x') },
      command(),
      actor,
      context,
    ),
    'attachment_filename_invalid',
  );
  await rejectsCode(
    service.createAttachment(
      { filename: 'safe.txt', mediaType: 'not a media type', content: Buffer.from('x') },
      command(),
      actor,
      context,
    ),
    'attachment_media_type_invalid',
  );
  await rejectsCode(
    service.createAttachment(
      {
        filename: 'safe.txt',
        mediaType: 'text/plain',
        content: Buffer.from('x'),
        sha256: '0'.repeat(64),
      },
      command(),
      actor,
      context,
    ),
    'attachment_digest_mismatch',
  );
});

test('rejects invalid durable cursors and dispatch worker identifiers before database use', async () => {
  await rejectsCode(service.events(actor, context, { cursor: '-1' }), 'cursor_invalid');
  await rejectsCode(
    service.acknowledgeCursor('BAD KEY', '1', actor, context),
    'cursor_key_invalid',
  );
  await rejectsCode(
    service.processDispatches('?', { send: async () => ({ blocks: [] }) }),
    'worker_id_invalid',
  );
});

function command() {
  return {
    commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAY',
    idempotencyKey: 'conversation-unit:00000001',
  };
}
async function rejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof NativeConversationError && error.code === code,
  );
}
