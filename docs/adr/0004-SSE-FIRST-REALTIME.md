# ADR 0004 — SSE-First Realtime with Command-Free Event Channels

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Agency and Worker expose SSE-style operational updates; Chat benefits from WebSocket streaming. Connection states and replay semantics differ, and a browser connection must not imply upstream health.

## Decision

Use SSE for durable operational events and notifications. Use WebSocket only for bidirectional or high-frequency Chat streaming where it materially helps. Realtime channels never execute commands; mutations use authenticated HTTP operation routes.

Every event uses a normalized envelope with ID, cursor, schema version, durability class, owner, resource reference, source/event/received time, operation correlation and redacted payload. Clients support heartbeat, cursor resume, bounded replay, explicit gap signals and REST reconciliation.

## Consequences

- Browser, Gateway hub and each upstream bridge have separate status/lag indicators.
- Event authorization is resource scoped.
- Development may use an in-process hub; horizontal production scale requires shared pub/sub/replay.
- Reconnect does not imply missed commands because commands are not sent over the event channel.
