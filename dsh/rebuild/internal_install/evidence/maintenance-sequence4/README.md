# Profile-isolated internal Chat — maintenance sequence 4

## Ownership and execution

- Default-runtime sessions retain the native API transport. Creation resolves the configured model instead of the `hermes-agent` transport placeholder.
- Named-profile sessions use Hermes' own `SessionDB` under that profile's native home, and Hermes' supported one-shot `chat --resume` CLI with the same profile home. No independent message database or provider client is introduced.
- IDs are qualified as `p:<profile>:<native-id>` only in the adapter projection. The native database retains the native ID. Profile selection creates a new bound session; it never retargets an existing session.
- Execution success requires a newly persisted, nonempty native assistant message. CLI/API acknowledgement alone is insufficient.
- External-channel sessions remain excluded. Invalid identifiers, linked profile paths, missing models, stale creation requests and concurrent turns fail closed.
- Named-profile transport currently accepts text only; its image input is explicitly disabled. It never forwards attachments or failed turns to the default profile.
- Credentials remain native and profile-specific. Routing does not copy or inherit provider credentials.

## Predeployment verification

- Adapter: 137 tests passed, including six new profile-routing unit tests.
- Native storage integration exercised the real deployed Hermes `SessionDB` in temporary storage: profile separation, untouched default store, replay-safe creation, title-conflict rejection, external-channel exclusion, and traversal/symlink rejection passed. Temporary storage was removed.
- Adapter and UI builds passed. The UI build reports its existing large-chunk warning.
- Internal maintenance test suite and `git diff --check` passed.

## Signed transition

Preparation is pinned to deployed sequence 3 (`5a8a7f4cfa818172d637492da81a64a9fbfac3dd212c43ea5609713c5a772971`) and uses separate sequence-4 candidate/control paths. Previous candidates, checkpoints and licensing artifacts are retained. Existing scoped ingress limits are accepted idempotently, not broadened. Newly supplied maintenance helpers must not be overwritten by predecessor helper copies.

## Acceptance still required

Real model/tool execution through the freshly deployed owner UI, final runtime/ownership verification, and disposable QA cleanup must be recorded separately. The checks above are not evidence that the new release is deployed or that a model turn succeeded.
