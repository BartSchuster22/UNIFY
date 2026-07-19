# Baseline Authorization Matrix

This is the minimum central role model. Permissions remain deny-by-default and may be narrowed by framework/resource scope. The Gateway enforces the matrix on REST and event subscriptions; UI hiding is not authorization.

Legend: **R** read, **M** non-destructive manage/use, **D** destructive or high-risk manage, **A** administrative/security authority, **—** denied by default.

| Permission family | Viewer | Operator | Administrator | Auditor/Security |
|---|---:|---:|---:|---:|
| `frameworks.read` | R | R | R | R |
| `frameworks.manage` | — | M (scoped) | A | — |
| `profiles.read` | R | R | R | R |
| `profiles.manage` | — | M (scoped) | A | — |
| `profiles.delete` | — | — unless explicit scoped grant | D | — |
| `models.read` | R | R | R | R |
| `models.manage` | — | M (profile routing only when scoped) | A | — |
| `credentials.manage` | — | — | A | —; metadata/audit only |
| `work.read` | R | R | R | R |
| `work.manage` | — | M (scoped) | A | — |
| `work.autonomy` | — | explicit scoped grant | A | — |
| `chat.read` | scoped R | scoped R | R | audit-policy dependent |
| `chat.use` | — | scoped M | A | — |
| `chat.admin` | — | — | A | — |
| `memory.read` | scoped R | scoped R | scoped R/A | scoped audit access |
| `memory.write` | — | scoped working/evidence M | A within policy | — |
| `memory.promote` | — | — unless explicit reviewer grant | A within governance | review/audit grant only |
| `memory.admin` | — | — | A | audit/security controls only |
| `audit.read` | — | own/scoped operation evidence | R | A |
| `users.manage` | — | — | A | security review, no mutation by default |
| `settings.manage` | — | — | A | security settings review only |

## Additional rules

1. Destructive operations always require operation-specific policy and confirmation in addition to permission.
2. Credential permissions never grant secret readback.
3. Framework scoping is evaluated against the canonical resource reference, not a request label.
4. Chat and Memory content require content-specific scope; broad domain read does not automatically grant all records.
5. Auditors can inspect policy/evidence without gaining execution authority.
6. Self-management of sessions/devices is available to every named user through dedicated routes.
7. Permission or scope changes invalidate affected event subscriptions and refresh tokens according to policy.
8. Protected profiles and autonomy ceilings remain server policies even for Administrators unless an explicit, separately audited override exists.
