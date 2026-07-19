# Capability, Provenance, and Truth Contract

## Capability manifest

Each framework and domain adapter returns a versioned manifest. A control is enabled only when the exact target advertises the required capability and policy allows the actor.

```ts
interface CapabilityManifest {
  schemaVersion: '1.0';
  adapterId: string;
  adapterVersion: string;
  frameworkId?: string;
  observedAt: string;
  capabilities: Record<string, {
    supported: boolean;
    modes?: Array<'read' | 'validate' | 'dry-run' | 'execute' | 'verify' | 'subscribe'>;
    constraints?: Record<string, unknown>;
    reason?: string;
  }>;
}
```

Unsupported, unavailable and forbidden are not interchangeable:

- `unsupported`: target does not implement the capability;
- `unavailable`: supported contract exists, but its source cannot currently serve it;
- `forbidden`: target supports it, but actor policy denies access.

No unavailable capability falls back to a best-effort write.

## Truth states

All resource responses use one of:

- `loading` — client-only transient state, never a server response claim;
- `current` — authoritative observation within freshness policy;
- `stale` — derived prior observation, read-only;
- `partial` — authoritative request completed with declared omissions;
- `empty` — authoritative source returned a valid empty collection;
- `unavailable` — owner could not be reached or could not answer;
- `unsupported` — capability absent by contract;
- `forbidden` — actor lacks permission;
- `failed` — request or normalization failed;
- `inconclusive` — operation result cannot be authoritatively verified.

## Standard metadata

```ts
interface ResponseMeta {
  requestId: string;
  correlationId: string;
  source: { owner: string; frameworkId?: string; adapterId: string };
  sourceStatus: string;
  freshness: 'current' | 'stale' | 'partial' | 'empty' | 'unavailable' | 'unsupported' | 'forbidden' | 'failed';
  observedAt?: string;
  generatedAt: string;
  warnings: Array<{ code: string; message: string }>;
  page?: { nextCursor?: string; hasMore: boolean };
}
```

## Adapter contract

Applicable methods are:

```text
health()
capabilities()
list(cursor, filters, signal)
get(resourceRef, signal)
validate(command, signal)
dryRun(command, signal)
execute(command, idempotencyKey, signal)
verify(operationEvidence, signal)
subscribe(cursor, scope, signal)
```

Adapters must provide normalized errors, provenance, bounded timeout, cancellation and circuit-breaker behavior. Reads may retry within policy. A non-idempotent write is never automatically retried without a verified idempotency key and explicit adapter support.

## Safe mutation contract

1. Read exact authoritative target state.
2. Evaluate capability, permission, mapping and policy.
3. Validate exact payload.
4. Dry-run/preflight when supported.
5. Bind preflight to actor, target, payload hash, source version and short expiry.
6. Require explicit confirmation; destructive actions use stronger confirmation.
7. Execute with idempotency and optimistic concurrency.
8. Record downstream evidence.
9. Perform authoritative readback.
10. Report `verified`, `failed` or `inconclusive`; never infer success from HTTP status alone.

Changing any payload or target field invalidates the preflight token.
