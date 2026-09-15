#!/usr/bin/env python3
"""Real Chromium against built UniUI and its production static server.
API responses are explicit test fixtures; no live accounts, credentials or provider calls.
Run after pnpm --filter @aquiero/uniui build, with Python Playwright + Chromium installed.
"""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

REPO = Path(__file__).resolve().parents[1]
UI = REPO / 'apps/uniui'

def run(base):
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1400, 'height': 950}, reduced_motion='reduce')
        counts = {}
        unexpected = []
        held = []
        hold_health = False
        meta = {'owner': 'hermes', 'frameworkId': 'hermes-a', 'frameworkCommit': 'test-fixture',
                'sourceVersion': 'navigation-fixture', 'observedAt': '2026-09-15T12:00:00Z'}
        principal = {'userId':'navigation-test-user','displayName':'Navigation QA','roles':['operator'],
                     'permissions':['frameworks.read','models.read','profiles.read','chat.read','chat.use','settings.manage']}
        def fixture(route):
            nonlocal hold_health
            request = route.request
            path = urlparse(request.url).path.removeprefix('/api/v1')
            counts[path] = counts.get(path, 0) + 1
            if request.method != 'GET':
                unexpected.append(request.method + ' ' + path)
                route.fulfill(status=405, json={'error':{'code':'TEST_READ_ONLY','message':'Unexpected write'}})
                return
            if path == '/auth/me': data = principal
            elif path == '/auth/preferences': data = {'timezone':'UTC'}
            elif path == '/sessions': data = {'items':[]}
            elif path == '/frameworks':
                data = {'items':[{'frameworkId':'hermes-'+x,'displayName':'Hermes '+x.upper(),
                                  'status':'verified','enabled':True} for x in ['a','b']]}
            elif re.fullmatch(r'/frameworks/hermes-[ab]/health', path):
                if hold_health:
                    held.append(route)
                    return
                data = {'meta':meta,'data':{'status':'healthy','checks':{}}}
            elif re.fullmatch(r'/frameworks/hermes-[ab]/capabilities', path):
                data = {'meta':meta,'data':{'capabilities':{}}}
            elif re.fullmatch(r'/frameworks/hermes-[ab]/(providers|models|profiles|conversations/sessions)', path):
                data = {'meta':meta,'items':[],'page':{'hasMore':False}}
            elif path.startswith('/notifications'):
                data = {'items':[], 'meta':meta}
            else:
                unexpected.append(path)
                route.fulfill(status=501,json={'error':{'code':'MISSING_FIXTURE','message':path}})
                return
            route.fulfill(json=data)
        context.route('**/api/v1/**', fixture)
        page = context.new_page()
        documents = []
        errors = []
        page.on('request',lambda r: documents.append(r.url) if r.resource_type=='document' else None)
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.goto(base+'/?framework=hermes-a')
        expect(page.get_by_role('heading',name='Readiness dashboard')).to_be_visible()
        expect(page.get_by_role('status',name='Checking readiness')).to_be_hidden()
        expect(page.locator('tbody tr').first).to_contain_text('Hermes reports healthy')
        row = page.locator('tbody tr').first.text_content()
        page.evaluate("window.__navSentinel = {}; window.__shell = document.querySelector('.mantine-AppShell-root'); window.__header = document.querySelector('header');")
        def stable():
            assert page.evaluate("!!window.__navSentinel && window.__shell === document.querySelector('.mantine-AppShell-root') && window.__header === document.querySelector('header')")
            assert len(documents)==1, documents
            assert counts['/auth/me']==1 and counts['/frameworks']==1, counts
        # The original defect: action anchors inside Readiness, not just the sidebar.
        page.locator('main a[href^="/models"]').first.click()
        expect(page).to_have_url(re.compile(r'/models\?framework=hermes-a$'))
        stable()
        page.get_by_role('navigation',name='Primary navigation',exact=True).get_by_role('link',name='Settings',exact=True).click()
        expect(page.get_by_role('heading',name='Settings',exact=True)).to_be_visible()
        stable()
        page.go_back()
        expect(page).to_have_url(re.compile('/models\\?framework=hermes-a$'))
        stable()
        page.go_forward()
        expect(page).to_have_url(re.compile('/settings\\?framework=hermes-a$'))
        stable()
        # A short-lived previous snapshot remains visible while fresh probes are pending.
        hold_health = True
        page.get_by_role('navigation',name='Primary navigation',exact=True).get_by_role('link',name='Readiness',exact=True).click()
        expect(page.get_by_role('heading',name='Readiness dashboard')).to_be_visible()
        expect(page.get_by_role('status',name='Checking readiness')).to_be_visible()
        expect(page.locator('tbody tr').first).to_have_text(row)
        assert held, 'Expected deliberately delayed health request'
        hold_health = False
        for route in held: route.fulfill(json={'meta':meta,'data':{'status':'healthy','checks':{}}})
        held.clear()
        expect(page.get_by_role('status',name='Checking readiness')).to_be_hidden()
        stable()
        # Framework selection is part of browser history, not a document load.
        page.get_by_role('combobox',name='Framework',exact=True).click()
        page.get_by_role('option',name='Hermes B',exact=True).click()
        expect(page).to_have_url(re.compile('framework=hermes-b'))
        page.go_back()
        expect(page.get_by_role('combobox',name='Framework',exact=True)).to_have_value('Hermes A')
        page.go_forward()
        expect(page.get_by_role('combobox',name='Framework',exact=True)).to_have_value('Hermes B')
        stable()
        # Portalled account-menu links still bubble through the shared React handler.
        page.get_by_role('button',name='User menu',exact=True).click()
        page.get_by_role('menuitem',name='Settings',exact=True).click()
        expect(page).to_have_url(re.compile('/settings\\?framework=hermes-b$'))
        expect(page).to_have_title('Settings · UNIFY')
        expect(page.get_by_role('menu')).to_be_hidden()
        stable()
        # Ctrl-click retains the native new-tab behavior.
        settings = page.get_by_role('navigation',name='Primary navigation',exact=True).get_by_role('link',name='Settings',exact=True)
        with context.expect_page() as popup:
            settings.click(modifiers=['Control'])
        tab = popup.value
        tab.bring_to_front()
        tab.wait_for_load_state('domcontentloaded')
        expect(tab).to_have_url(re.compile('/settings\\?framework=hermes-b$'))
        expect(tab.get_by_role('heading',name='Settings',exact=True)).to_be_visible()
        tab.reload()
        expect(tab.get_by_role('heading',name='Settings',exact=True)).to_be_visible()
        tab.close()
        # Mobile links share the same handler and close the drawer.
        page.set_viewport_size({'width':390,'height':844})
        page.get_by_role('button',name='Open navigation menu').click()
        page.get_by_role('navigation',name='Mobile primary navigation',exact=True).get_by_role('link',name='Settings',exact=True).click()
        expect(page.get_by_role('heading',name='Settings',exact=True)).to_be_visible()
        expect(page.get_by_role('button',name='Open navigation menu')).to_have_attribute('aria-expanded','false')
        assert len(documents)==1
        assert page.evaluate("window.__shell === document.querySelector('.mantine-AppShell-root')")
        assert not unexpected, unexpected
        assert not errors, errors
        result = {'browser':'Chromium','productionBuild':True,'api':'explicit read-only fixtures',
                  'dashboardAndSidebarNoReload':True,'shellAndHeaderIdentityPreserved':True,
                  'backForwardAndFrameworkHistory':True,'directLinkAndExplicitReload':True,
                  'nativeNewTab':True,'mobileNavigation':True,'accountMenuNavigation':True,'cachedReadinessWhileRevalidating':True,
                  'documentRequestsInOriginalTab':len(documents),'unexpectedApiRequests':unexpected,'pageErrors':errors}
        browser.close()
        print(json.dumps(result,indent=2))

if __name__ == '__main__':
    assert (UI/'dist/index.html').is_file(), 'Build UniUI first'
    with tempfile.TemporaryDirectory(prefix='unify-navigation-') as temp:
        root = Path(temp)
        (root/'public').symlink_to(UI/'dist',target_is_directory=True)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        with (root/'server.log').open('w') as log:
            server = subprocess.Popen(['node',str(UI/'server.mjs')],cwd=root,
                env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'GATEWAY_INTERNAL_URL':'http://127.0.0.1:9'},stdout=log,stderr=log)
            try:
                deadline = time.monotonic()+15
                while True:
                    try:
                        with urllib.request.urlopen(base+'/healthz',timeout=1) as r: assert r.status==200
                        break
                    except OSError:
                        if server.poll() is not None or time.monotonic()>deadline: raise
                        time.sleep(0.05)
                run(base)
            finally:
                server.terminate()
                try: server.wait(timeout=12)
                except subprocess.TimeoutExpired: server.kill();server.wait()
