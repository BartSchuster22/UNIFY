# Phase 09 — Native agent conversations

## Ownership boundary

UNIFY Core is the sole system of record for conversation agents, sessions, ordered messages, attachments, channels, external-thread ownership, dispatch state, events, and durable consumer cursors. Frameworks execute selected profiles through explicit dispatch adapters; they do not own UNIFY conversation history.

The retired `/CHAT` service is not a reader, writer, fallback, realtime source, attachment proxy, or deployment prerequisite. Production source and Compose contain no `CHAT_URL`, `CHAT_PASSWORD`, `/api/v1/chat/*` proxy, or `/CHAT` adapter. Never re-enable dual writes.

## Native schema

Migration `011_native_conversations.sql` adds:

- `core.conversation_channels`;
- `core.conversations`;
- `core.conversation_messages`;
- `core.conversation_attachments` and `core.conversation_message_attachments`;
- `core.conversation_dispatches`;
- `core.conversation_event_cursors`;
- `chat.read`, `chat.use`, and `chat.manage` permissions.

Database constraints and triggers enforce canonical IDs, live principals and profiles, sender/profile integrity, monotonic message sequences, message-block validity, attachment ownership and exact block/link parity, immutable attachment content metadata, non-regressing cursors, and cursors that never advance beyond the authorized event head.

## Authorization and ownership

- `chat.read` lists selectable agents, owned conversations and messages, authorized attachments, and owned event history.
- `chat.use` creates native conversations and attachments and sends messages.
- `chat.manage` creates channels, ingests external messages, processes dispatches, and can inspect/manage all conversations.
- Non-managers can access only conversations whose `(owner_kind, owner_id)` equals their authenticated principal.
- External conversations are owned by the authenticated channel principal and are keyed by `(channel_id, external_conversation_reference)`.
- Attachment links must have exactly the same owner as the target conversation.

Channel credentials are secret references only. Core never stores channel secrets in conversation rows, operation payloads, events, or logs.

## Agent selection and routing

Agent selection comes from native active profile inventory joined to an active framework. Disabled, deleted, or framework-unavailable profiles are not selectable.

Every accepted user or external message creates one durable queued dispatch containing the selected `profile_id`. Workers claim dispatches with leases and `FOR UPDATE SKIP LOCKED`; concurrent workers cannot route the same dispatch twice. The adapter receives the conversation history and one of two routes:

- `profile` for a Core-owned browser/API conversation;
- `external-channel` with channel kind, channel ID, external thread reference, and secret reference for a Telegram, WhatsApp, or custom conversation.

A successful adapter response is inserted as the next profile message in the same transaction that marks the dispatch succeeded and emits its durable event. Adapter failures are stored as safe errors and never invent a profile response.

## Ordering and duplicate-send protection

Each conversation owns a database-managed `last_sequence`. Message insertion locks and increments that value, so concurrent sends receive distinct, strictly increasing sequence numbers.

Mutations use actor-scoped command idempotency. Reusing a key with the same payload returns the stored result; reusing it with different payload fails closed. User/API sends additionally require a conversation-scoped `clientMessageId`. Repeating the same ID and blocks returns the existing message without another dispatch; changing the blocks returns `duplicate_send_conflict`. External ingestion applies the same rule to `sourceMessageId`.

## Attachments

Uploads are decoded by the API adapter and passed to Core as bytes. Core enforces:

- safe basename-only filenames;
- valid media types;
- 1 byte–50 MiB decoded size;
- a computed SHA-256 digest, with optional caller digest verification;
- owner-scoped reads and links;
- immutable content and metadata.

Downloads must use the authenticated native attachment endpoint. Responses should set `Cache-Control: private, no-store`, a safe `Content-Disposition`, and the stored media type. Filesystem paths supplied by callers are never accepted.

## Realtime and durable cursors

`GET /core/v1/events` is cursor based. The API transport may return a JSON event page or format that page as `text/event-stream`; SSE `id` is the decimal global event position and `Last-Event-ID` resumes strictly after it. Heartbeat frames are comments and do not move the cursor.

Events are filtered by authorization before delivery: owners receive their conversation aggregates and managers receive all conversation aggregates. Named consumer cursors are durable per principal. The database rejects regressions and positions beyond the current authorized event head. Clients must persist/acknowledge only an event they have fully handled.

## Deployment

1. Back up PostgreSQL and record the restore reference.
2. Stop `/CHAT` writes, polling, WebSockets, and attachment traffic.
3. Export approved history and attachments once, with checksums and ownership mapping; do not run a live replicator.
4. Deploy Core and apply migrations 001–011.
5. Run `pnpm --filter @unify/core db:verify`.
6. Import approved data with stable native IDs and source-message identifiers, then verify counts, ownership, sequence continuity, attachment digests, and operation/event parity.
7. Configure framework dispatch workers and external channel service principals/secret references.
8. Deploy Gateway without `/CHAT` URL/password settings or legacy chat routes.
9. Verify native send, reply, reconnect/resume, duplicate send, attachment download, and external-thread routing.
10. Keep `/CHAT` stopped through the observation window, then remove it after backup-retention approval.

## Monitoring

Alert on:

- queued dispatch age and expired leases;
- failed dispatches grouped by framework/profile/channel;
- duplicate-send conflicts;
- cursor constraint errors or reconnect loops;
- operation/event count mismatches;
- attachment digest or ownership violations;
- a production process containing `CHAT_URL`, `CHAT_PASSWORD`, or `/api/v1/chat/` proxy configuration.

## Rollback

Rollback is restore based, never dual-write based:

1. stop Core writes and dispatch workers;
2. preserve operations, events, cursors, dispatches, and attachment digests;
3. restore the pre-migration database backup;
4. redeploy the prior release only under explicit rollback approval;
5. reconcile commands accepted after the backup before reopening writes.

Do not automatically restart `/CHAT`, copy partial native state into it, or permit both systems to accept messages.

## Verification

```bash
pnpm --filter @unify/core test
UNIFY_CONVERSATION_TEST_DATABASE_URL=postgresql://.../unify_core_conversation_test_phase9 \
  node --test --test-concurrency=1 apps/core/dist/conversations/conversations.integration.test.js
pnpm contracts:generate
pnpm qa
```

The PostgreSQL suite covers ownership isolation, agent selection, idempotent conversation creation, attachment integrity, concurrent ordering, client/source duplicate protection, dispatch lease concurrency, profile responses, external-thread routing, event replay, SSE IDs, durable cursor acknowledgement/regression, archive behavior, and database sender invariants.
