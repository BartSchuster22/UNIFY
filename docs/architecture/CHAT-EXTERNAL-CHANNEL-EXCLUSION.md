# UNIFY Chat External-Channel Exclusion

Status: binding
Date: 2026-07-22

## Decision

UNIFY integrates only native/internal agent chat. It does not display, ingest, mirror, synchronize, route or deliver conversations from external chat systems such as Telegram or WhatsApp.

External-channel functionality remains a responsibility of the standalone CHAT product and the relevant framework/channel runtime. It is not a UNIFY capability or a UNIFY migration acceptance requirement.

## UNIFY boundary

UNIFY may expose:

- internal sessions with `source=dashboard_native`;
- internal session messages and attachments;
- internal agent execution, approvals, stop and run lifecycle;
- durable realtime events belonging to an allowed internal session;
- creation of internal sessions and messages.

UNIFY must exclude:

- Telegram, WhatsApp, Discord, Slack and other external-channel sessions;
- external conversation, account, chat, thread and relay routes;
- channel bindings, bot identities and external-channel capabilities;
- mirrored external messages and realtime events;
- external delivery, retries, receipts and provider errors;
- Telegram user-account relay controls and credentials;
- webhook, polling, mirror-plugin and transport configuration.

## Enforcement

The migration CHAT adapter is fail-closed:

1. Workspace session inventory includes only `source=dashboard_native`.
2. Message history can be requested only for a currently verified internal session.
3. Message writes verify the target against the internal session inventory before calling CHAT.
4. Session creation rejects external source and route metadata.
5. Realtime forwarding drops external-source frames and frames not bound to a known internal session.
6. Agent responses remove channel bindings and external-channel capability fields.

The final Hermes-backed conversation adapter must enforce the same product boundary directly in its contract and authorization policy. The migration filter is containment, not permission to retain a legacy dependency.

## Non-goals

UNIFY will not provide:

- an omnichannel inbox;
- symmetric CHAT/Telegram surface switching;
- send-as-human Telegram behavior;
- bot-authored Telegram replies;
- external conversation observability or transcript search;
- migration of CHAT external route, mirror or relay state.

## Retirement and migration

Only CHAT-native/internal sessions and messages are eligible for migration into the final UNIFY conversation path. External sessions and messages remain in CHAT according to CHAT's own retention, operation and repository documentation. They are not deleted by the UNIFY cutover.

Stopping or retiring UNIFY's CHAT migration adapter must not stop CHAT's independent external-channel operation.

## Acceptance criteria

- No external session appears in UNIUI or Gateway workspace responses.
- Direct history access and message delivery to an external session fail closed.
- No external realtime frame reaches a UNIFY browser.
- No UNIFY runtime requires Telegram, relay, webhook or mirror credentials.
- No UNIFY API offers external route or delivery operations.
- CHAT documents and independently owns its external-channel behavior.
