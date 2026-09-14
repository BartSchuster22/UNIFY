# Work form repeated-paste crash repair

Reproduced in live Chromium: a second Ctrl+V into Project name blanked the Work
page with `Cannot read properties of null (reading 'value')`.

Thirteen Project/Task/Cron onChange handlers captured event.currentTarget inside
functional React state updaters. React may evaluate those updaters after event
dispatch, when currentTarget is null. Handlers now capture the primitive value
synchronously and pass it to the state updater. This is not a clipboard permission
workaround. Immediate handlers elsewhere were not changed unnecessarily.

Verification:
- All 23 WorkView tests pass, including 13 repeated-input regression cases.
- UI TypeScript checking and production build pass.
- Live Chromium: three real clipboard pastes and further keyboard editing in all
  13 fields; multiline prompts/goals retained; zero page errors.
- No mutation requests, projects, tasks, schedules, or model work from browser tests.
- Only development UniUI replaced. All other running container identities and start
  times preserved. All seven services healthy; ownership verified; maintenance off.
- Core session-refresh and chat execution-feedback fixes remain in place.
- DSH2 untouched. Existing backend data unchanged; unsaved form contents lost in the
  earlier crash cannot be claimed recovered.

Engineering overlay only, not full workflow or installer qualification:
Bundle: /var/lib/alica-dsh-internal/dev3-work-paste-1/bundle
Manifest: a37fe408489f91ec1869dcd6fa4bdc66112d172b54fee5976ae1596ab476ec75
UI image: sha256:3d7a78b8854f40324609f7e548d9f44d7b5b61b1b6b4b0395c0107dd90654eeb
Backup and receipt: /var/lib/alica-dsh-internal/dev3-work-paste-1/
