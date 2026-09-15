# Client-side navigation and loading behavior

## Delivery boundary

Implemented and verified in source. Not deployed to the live DSH2 installation.
These changes join the timezone/timestamp changes in the pending signed maintenance
release. No live containers, signed inventories, licensing candidates, owner accounts,
or provider configuration were changed by this work.

## Behavior

- One delegated application-link handler covers sidebar, mobile, account-menu portals,
  and readiness actions. The existing route registry remains the path source of truth.
- Only plain primary clicks on known same-origin application routes are intercepted.
  Modified/middle clicks, downloads, external links, authentication/API routes,
  fragment-only skip links, explicit new-window targets, and native-navigation opt-outs
  retain browser behavior.
- Navigation updates browser history without reloading the document or replacing the
  application shell. Same-page clicks do not add duplicate history; they still close
  the mobile drawer.
- Framework and Work query changes notify the application as well as page state.
  Sidebar URLs therefore follow framework selection immediately, including after
  Back/Forward. Page titles update to match the selected view.
- The main content area reserves viewport space. Models and Profiles use localized,
  reserved loading regions with small, subdued indicators. Reduced-motion preferences
  are respected.
- Readiness shows a neutral first-load placeholder rather than briefly reporting
  missing probe results as blocked. Previously observed readiness can be displayed
  during immediate revalidation on return to the page.
- The readiness presentation cache is memory-only, scoped by user, permissions
  and framework, limited to 12 entries, and expires after 15 seconds. Observation times
  remain visible. Every return still makes fresh probes. Mutations invalidate the cache
  both before and after the request; authentication failures and failed probes invalidate
  it too. An epoch prevents earlier in-flight reads from repopulating invalidated entries.
- This is not an authorization cache. Provider credentials, mutation approvals and
  editable page state are not cached. Inactive pages are not kept mounted or polling.

## Verification

- TypeScript check: passed.
- Production Vite build: passed (existing large-chunk advisory remains).
- Full UniUI suite: 19 files passed; 142 tests passed and one pre-existing expected failure.
- Real Chromium against the built production UI and its production static server:
  repeated successful runs, one document request in the original tab, no page errors,
  and no unexpected API requests.
- Browser assertions cover dashboard/sidebar navigation, shell/header DOM identity,
  no repeated auth/framework bootstrap, framework selection and browser history,
  portalled account-menu navigation, mobile navigation and same-page drawer closure,
  Ctrl-click new tabs, direct URLs, explicit reload, and retained readiness while fresh
  health probes are deliberately delayed.
- Browser API responses are explicit read-only test fixtures. This is not live-owner,
  OAuth, provider inference, or signed-deployment acceptance evidence.

## Reproduce

From the repository root, with the normal project pnpm dependencies installed:

```sh
python3 -m venv /tmp/unify-navigation-browser-venv
/tmp/unify-navigation-browser-venv/bin/python -m pip install -r scripts/requirements-navigation-browser.txt
/tmp/unify-navigation-browser-venv/bin/python -m playwright install chromium
pnpm --filter @aquiero/uniui typecheck
pnpm --filter @aquiero/uniui test
PATH=/tmp/unify-navigation-browser-venv/bin:$PATH pnpm --filter @aquiero/uniui test:browser
```

The browser harness binds a temporary loopback-only port, uses disposable browser
contexts and fixtures, rejects unexpected API calls, and terminates its server and
browser. It needs no live credentials or running production backend.
