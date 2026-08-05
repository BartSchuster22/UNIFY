# Canonical Resource Identity

Current runtime resources have only two owners:

- `hermes` for exact registered framework resources;
- `gateway` for UNIFY access-plane resources.

Agency, DMM, Worker, `/CHAT`, and MemoryV4 are not valid current owner values or routing targets.

## Resource reference

```ts
interface ResourceRef {
  canonicalId: string;
  kind: ResourceKind;
  owner: 'hermes' | 'gateway';
  frameworkId?: string;
  nativeId: string;
  displayLabel?: string;
  sourceVersion?: string;
  observedAt: string;
  links?: Array<{ relation: string; canonicalId: string }>;
}
```

`canonicalId` is opaque and stable. Clients use structured fields and never parse business meaning from the identifier. Display labels are presentation data and never participate in equality, authorization, or routing.

## Identity rules

1. Framework resources include the exact Gateway `frameworkId` and framework-native identifier.
2. Native Core resources use Core-issued identifiers and owner-scoped authorization.
3. Gateway operations, audit events, sessions, registrations, and notifications use Gateway-issued identifiers.
4. Labels never act as join keys.
5. Ambiguous, stale, or missing mappings block writes.
6. Idempotency scope includes actor, operation, owner, exact target, and payload hash.
7. Multi-framework tests include identical native IDs under different framework IDs.
8. No identifier is allowed to route a request to a retired service.
