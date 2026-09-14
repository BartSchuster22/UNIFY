# Development OAuth handoff repair

The browser received a verified Core mutation with the Hermes payload at
`response.result.data.result`. ModelsView incorrectly read `response.result`.
Both start and status now normalize the real envelope. An incomplete start,
unverified operation, invalid URL, or unknown status fails closed rather than
creating an empty pending dialog. No provider tokens are handled by this UI.

Evidence:
- ModelsView and oauthResult: 30 tests passed; TypeScript check passed.
- A broader build-container suite also ran: 95 passed, two failed because
  repository baseline fixtures are not copied into Dockerfile.uniui's build
  context, and one expected failure. This is not an all-suite green claim.
- Live Chromium sign-in with the existing owner reached the dashboard.
- Codex start produced a visible device code and an enabled auth.openai.com link.
- The subsequent real status operation was verified and returned pending.
- Owner consent, successful provider connection, and model selection remain pending.

Development rollout only:
- Only dev3 UniUI was replaced. Other running container IDs/start times remained
  identical, all seven candidate services healthy, ownership verified, maintenance
  off, and development/shared UI/shared Core HTTP checks returned 200.
- Initial rollout failed on Compose recreation metadata and rolled back. The old
  V2 identity was restored by removing/recreating only UI with dependencies held
  at --no-recreate. Final checks use canonical V2 signatures and broker service
  ordering, not the legacy signature alias or arbitrary Docker listing order.
- Final image sha256:1aa3b3dfded9d88c2e567a988209a04c3a942c0e65f311b93ec4c82363836aef.
- Current bundle /var/lib/alica-dsh-internal/dev3-oauth-ui-v2/bundle.
- Manifest SHA256 4fbc13291e9ffc19effc6e0c60bbc5883ea640e29e67b53a170f79981fa466d4.
- Previous bundle preserved; metadata backup and update receipt are under
  /var/lib/alica-dsh-internal/dev3-oauth-ui-v2/.
- Cell and TLS unit commands now use the new bundle and hash. Owner, env, and
  broker pins are consistent with the changed UI image; checks were not disabled.
- This is an engineering static-UI overlay, NOT a qualified fresh-install artifact
  or a general upgrade facility. The eventual full candidate must include the fix
  and undergo fresh-install/lifecycle qualification. DSH2 was not changed.

Close the old OAuth dialog, hard-refresh the browser, and start Codex OAuth again.
Use the code from your own browser only on OpenAI's authorization page.
