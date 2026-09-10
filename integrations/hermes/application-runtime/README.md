# Stage 3 restricted native executor — delegated handoff

Status: implementation and labelled unit/subprocess tests only. NOT live-qualified.
No routes, deployment, container changes, credentials or real inference in this work.

Server-owned ApplicationRuntime options select an absolute Python executable and worker.py
path. Hermes must be importable in that interpreter's environment. Parent integration must
provide the owned candidate native home/profile via server environment, NEVER from client
input, and must not point it at Herman. This code intentionally does not configure profiles,
provision native projects, copy auth, or launch the dispatcher.

Protocol: worker.py execute|lookup|cancel|erase --receipt <canonical UUID>, one JSON stdin
object. Execute requires payload; lifecycle calls accept the four scope fields alone.
stdout is one JSON envelope; native stdout/stderr are discarded, exceptions sanitized.
Core authorizes scope and supplies operator URL policy and validated knowledge provenance.
URLs in scoped supplied knowledge are not fetched unless separately present in sourceUrls.
Core retains admission digests/tombstones; the worker does not re-evaluate payload equality
for an existing receipt, and NEVER reruns that receipt, including unknown/archived outcomes.

Native ownership: Kanban task.body stores correlation, scope, native project and Linux
PID/start-time/UID ownership. Receipt keys are searched across archived native rows.
Task is blocked (not dispatcher-ready); complete_task persists the durable JSON envelope in
task.result. Native done means local execution settled, NOT necessarily application success:
consumers MUST inspect envelope.state. No second work DB or scheduling loop exists.
Native project must already resolve. Deterministic sessions are created task-first; a crash
between them leaves an explicit unknown receipt, not an inference retry. Pre-existing orphan
sessions are refused. AIAgent's pinned session upsert preserves source/user ownership.

Bounds: 98,304 input bytes; question 4,000 characters; max 4 HTTPS fetch URLs; max 8 knowledge
records; 262,144 bytes per full response; 12,000-character excerpts; UTF-8 text/plain or
text/html only; no redirects, proxy helpers, compressed bodies or tools. Every DNS answer
must be public; only pinned IPv4 sockets are used, with hostname-verified TLS. Socket timeout
8 seconds and read-loop elapsed guard 15 seconds supplement the 170-second worker alarm
(the elapsed guard is not a standalone hard DNS/HTTP deadline). Inference concurrency is 1
per native home, enforced by a nonblocking advisory lock: contention durably fails, no queue.
At most two evidence evaluations, each max_iterations=2 and max_tokens=3000. These are SDK
limits, not an independently enforced provider billing cap. TypeScript outer bound is at most
180 seconds including 500ms TERM/KILL grace, and waits for child close. Unicode-expanded
output is checked against 131,072 bytes before durable completion.

Evidence: exact quotes are checked against literal excerpts and numbered citations require
validated supporting findings. Model evaluation assesses relevance/conflicts; it is not a
formal factual-entailment proof. Unvalidated/conflicting findings remain candidates, all
results say candidate-only. No Memory promotion occurs here. HTML remains literal source,
not rendered/executed; non-UTF8/unsupported pages fail honestly. Full entity hashes reject
premature Content-Length EOF. Upstream validated knowledge hashes cannot be re-proven from
an excerpt; Core owns that provenance attestation.

Cancellation: pidfd plus exact argv/receipt, UID and /proc start-time validation before TERM.
Stop acknowledgement is signal delivery, not settled local/provider effects. Killed/crashed
unknown tasks are never automatically retried or erased. Only durable settled, exact-scope
tasks can be erased, after the execution mutex is released; SessionDB.delete_session uses
sessions_dir and expected_delete_ids before native delete_task. Cross-store delete is not
atomic; a task survives a session-first partial failure for reconciliation. Compression/
branch lineage, provider-inflight billing after cancellation, SDK auxiliary-model behavior,
native dispatcher interaction and full live transcript deletion require parent qualification.
Do not claim complete external-effect settlement from a cancellation acknowledgement.

Tests from repository root (no whole-repo build):
  (cd integrations/hermes/application-runtime && python3 -m py_compile worker.py test_worker.py fixture_worker.py && python3 -m unittest -v test_worker)
  node node_modules/typescript/bin/tsc -p apps/hermes-control-adapter/tsconfig.json --noEmit
  node node_modules/vitest/vitest.mjs run apps/hermes-control-adapter/src/application-runtime.test.ts --maxWorkers=1 --no-file-parallelism

Python native lifecycle/auth and network cases are labelled mocks. Pinned-source AST tests
verify API signatures without importing Hermes or reading auth. TypeScript launches only
fixture_worker.py. Live retrieval/inference, isolated native state, end-to-end Core/Memory,
load/recovery and acceptance remain the parent's responsibility.
