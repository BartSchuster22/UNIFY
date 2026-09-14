# Step 5 — model-backed runtime acceptance

## Result

Passed on the existing DSH development deployment. A disposable agent and browser-created project (`qa-runtime-live-977d4eef`) used an isolated workspace. Three fresh native CLI sessions exercised real inference. No application code, deployed images, or services were changed/restarted.

### Primary model and real artifact

The browser showed `openai-codex / gpt-5.6-sol`. Runtime request tracing recorded five successful primary request returns using that provider/model, not merely a model self-description.

The model actually called, in order:

1. `skill_view` for the enabled QA skill.
2. `read_file` for the explicitly prepared CSV test fixture.
3. `write_file` to create `result.json`.
4. `memory` to append `Step 5 model-backed task completed.`.
5. `read_file` to verify its generated artifact.

Independent Python calculation from the input CSV confirmed `total_cents = 1195`. The artifact contains the expected three row names and four independently seeded proof codes from SOUL.md, native agent memory, native user memory and the loaded skill. The file was produced by the model's actual tool call; it was not supplied by the harness.

Artifact SHA256: `4d45969a79ba79051b1c13e69af0c2a6d079ae747b98200cac91d060d8a00917`.

### Instructions, memory, tools and skills

- The runtime's system-prompt builder contained all three instruction/memory proof codes and the enabled skill entry, but not the disabled skill entry.
- The model loaded the enabled skill through `skill_view`; its proof code reached the real artifact.
- In a second fresh model-backed session, `skills_list` returned only the enabled QA skill. The disabled QA skill stayed excluded.
- Terminal was absent from the actual request tool schemas and the runtime's valid-tool list. A model-requested `tool_search(query="terminal")` also returned no matches. No terminal command was executed.
- The native memory tool returned success. A fresh session recalled the new entry, and the browser independently reopened and displayed the saved native memory.
- Native default configuration-only/deferred capabilities were not represented as entirely disabled: discovery reported a connected `unify_memory` source. This test establishes the specifically disabled terminal tool and skill behavior, not an arbitrary tool sandbox.

### Controlled fallback

The disposable profile temporarily saved the native ordered fallback chain `gpt-5.6-terra`, then `gpt-5.6-luna`, both through `openai-codex`.

A loopback-only HTTP server returned intentional 429 test faults. A **process-local test wrapper** translated those responses into native SDK rate-limit exceptions at the primary and first-fallback request boundary. No real provider outage was caused, no request credentials or prompts were sent to the loopback server, and no production service was reconfigured.

The unmodified native fallback implementation selected:

`gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna`

The trace retains the native retry of terra rather than hiding it. The final luna request went through the real provider client and returned `STEP5-FALLBACK-OK`. Faulted sol/terra attempts are explicitly labeled as injected, with no upstream inference attempted. Original profile configuration was restored and confirmed in the browser.

This verifies native ordered failover under controlled error injection plus real inference on the surviving fallback. It does **not** establish a real upstream outage, credential expiration, cross-provider failover, or rate-limit recovery over time.

## Isolation and closure

- A private copy of existing development authorization was placed only in the disposable profile, with owner-only permissions. No new authorization/reauthorization was claimed.
- Project workspace and manager/worker binding were created and read back through the browser. The workload itself used the same native `hermes chat` runtime family as adapter task execution, with tracing and an explicit disposable working directory; browser task dispatch/background Kanban scheduling were not tested.
- The native CLI ran with a 12-turn bound and did not start a gateway, scheduled job, or delegated agent. The environment warned that tirith was unavailable and command scanning would use pattern matching; no shell tool was enabled or used.
- The project was archived through the browser. The disposable agent, its sessions/copied credentials/skills, and workspace were removed after evidence export. The archived project record remains as an audit record.
- No browser JavaScript errors.
- Final closure: protected ElioHermes config, metadata, SOUL.md, both memory stores, `.env` and `auth.json` hashes/absences unchanged; seven services healthy; tested gateway/adapter/UI files match deployment; installer plan `installed`.
- No DSH2 configuration was changed. Broader OIDC recovery, provider expiry/reauthorization and lifecycle/day-scale qualification remain outstanding; release freeze is not approved.

## Retained evidence and reproducibility

`step5-evidence/` contains the actual CSV fixture and model-written result, sanitized request/tool traces from all three sessions, browser setup/read-back, cleanup, deployment closure and acceptance summary. No credential values or browser cookies are included. Screenshots remain private.

`step5-harness/` preserves the **as-run native tracing scripts**, including the explicitly labeled fault injection. They require the pinned Hermes runtime and reference the now-deleted disposable profile, so they are provenance, not a one-command deployment test. To rerun, provision a new disposable profile/project/workspace, seed new controlled instructions/memory/skill fixtures, authorize that profile, update only the QA identifiers, and perform the same cleanup. Never repoint these scripts at an existing owner profile. They wrap native calls for observation; only the fallback script replaces request attempts with controlled test faults.

The retained evidence can be checked without a model call:

```sh
python dsh/rebuild/internal_install/verify_step5_evidence.py
```

This validates consistency of the recorded live evidence and artifact; it does not rerun inference.
