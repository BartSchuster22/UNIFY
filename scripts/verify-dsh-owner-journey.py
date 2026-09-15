#!/usr/bin/env python3
"""Bounded live owner-role acceptance; private auth state never printed."""
import json,os,sys,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
HOME=Path('/home/herman/.config/dsh-maintenance-recovery');STATE=HOME/'qa-browser-storage.json';ORIGIN='https://dsh-next.aquiero.com'
os.umask(0o077)
q=json.loads((HOME/'qa-browser.json').read_text())
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 context=browser.new_context(timezone_id='Atlantic/Canary',storage_state=str(STATE) if STATE.exists() else None)
 page=context.new_page();page.goto(ORIGIN,wait_until='domcontentloaded')
 if not STATE.exists():
  page.get_by_role('link',name='Continue to secure sign-in').click()
  page.locator('#username').fill(q['username']);page.locator('#password').fill(q['password']);page.locator('#kc-login').click()
  expect(page.get_by_text('Confirm your timezone',exact=True)).to_be_visible(timeout=30000)
  page.get_by_label('Timezone',exact=True).fill('Atlantic/Canary');page.get_by_role('button',name='Save timezone',exact=True).click()
  expect(page.get_by_text('Confirm your timezone',exact=True)).not_to_be_visible()
  context.storage_state(path=str(STATE))
 page.goto(ORIGIN+'/profiles',wait_until='domcontentloaded')
 expect(page.get_by_role('table',name='Hermes profiles')).to_be_visible(timeout=30000)
 page.goto(ORIGIN+'/models',wait_until='domcontentloaded')
 expect(page.get_by_role('heading',name='Models & Providers',exact=True)).to_be_visible(timeout=30000)
 expect(page.get_by_text('Selected provider',exact=True)).to_be_visible(timeout=30000)
 page.goto(ORIGIN+'/profiles',wait_until='domcontentloaded')
 expect(page.get_by_role('table',name='Hermes profiles')).to_be_visible(timeout=30000)
 agent='qa-journey-'+q['username'].rsplit('-',1)[-1][:12]
 (HOME/'owner-journey-resources.json').write_text(json.dumps({'agent':agent,'sessions':[]}))
 page.get_by_role('button',name='Create Agent',exact=True).click()
 dialog=page.get_by_role('dialog')
 dialog.get_by_label('Agent ID',exact=True).fill(agent)
 dialog.get_by_label('Agent description',exact=True).fill('Disposable post-upgrade acceptance agent')
 dialog.get_by_label('Agent instructions (SOUL.md)',exact=True).fill('You are a disposable acceptance-test agent. Follow the bounded test prompt. Never read credentials, modify configuration, schedule jobs or write persistent memory. Use only the requested read-only terminal command.')
 dialog.get_by_role('checkbox').check()
 dialog.get_by_role('button',name='Validate and dry-run',exact=True).click()
 expect(dialog.get_by_role('button',name='Create Agent',exact=True)).to_be_enabled(timeout=30000)
 dialog.get_by_role('button',name='Create Agent',exact=True).click()
 expect(dialog).not_to_be_visible(timeout=30000)
 print(json.dumps({'agentCreated':agent}))
 context.storage_state(path=str(STATE));browser.close()
