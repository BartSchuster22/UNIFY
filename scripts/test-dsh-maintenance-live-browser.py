#!/usr/bin/env python3
import json,re,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
HOME=Path('/home/herman/.config/dsh-maintenance-recovery');STATE=HOME/'qa-browser-storage.json';q=json.loads((HOME/'qa-browser.json').read_text());ORIGIN='https://dsh-next.aquiero.com'
os.umask(0o077)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 context=browser.new_context(timezone_id='Atlantic/Canary',viewport={'width':1400,'height':1000},**({'storage_state':str(STATE)} if STATE.exists() else {}));page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(ORIGIN,wait_until='domcontentloaded')
 if not STATE.exists():
  page.get_by_role('link',name='Continue to secure sign-in').click(timeout=15000)
  page.locator('#username').fill(q['username']);page.locator('#password').fill(q['password']);page.locator('#kc-login').click()
  expect(page.get_by_text('Confirm your timezone',exact=True)).to_be_visible(timeout=30000)
  page.get_by_label('Timezone',exact=True).fill('Atlantic/Canary');page.get_by_role('button',name='Save timezone',exact=True).click();expect(page.get_by_text('Confirm your timezone',exact=True)).not_to_be_visible(timeout=15000)
  context.storage_state(path=str(STATE))
 page.goto(ORIGIN+'/work',wait_until='domcontentloaded')
 page.get_by_text('Add new',exact=True).click()
 button=page.get_by_role('button',name='Browse / Create workspace · Upload files').first;expect(button).to_be_enabled(timeout=30000)
 prefs=page.evaluate("async()=>{const r=await fetch('/api/v1/auth/preferences');return {status:r.status,body:await r.json()}}")
 assert prefs=={'status':200,'body':{'timezone':'Atlantic/Canary'}},prefs
 page.get_by_role('link',name='Settings',exact=True).click()
 expect(page.get_by_label('Timezone',exact=True)).to_have_value('Atlantic/Canary')
 page.get_by_label('Timezone',exact=True).fill('UTC')
 with page.expect_response(lambda r:'/auth/preferences' in r.url and r.request.method=='PUT') as saved:
  page.get_by_role('button',name='Save timezone',exact=True).click()
 assert saved.value.status==200
 page.reload();expect(page.get_by_label('Timezone',exact=True)).to_have_value('UTC',timeout=15000)
 page.get_by_label('Timezone',exact=True).fill('Atlantic/Canary')
 with page.expect_response(lambda r:'/auth/preferences' in r.url and r.request.method=='PUT') as saved:
  page.get_by_role('button',name='Save timezone',exact=True).click()
 assert saved.value.status==200
 page.go_back();expect(page.get_by_role('heading',name='Work & Kanban',exact=True)).to_be_visible()
 page.get_by_text('Add new',exact=True).click()
 page.get_by_role('button',name='Browse / Create workspace · Upload files').first.click()
 dialog=page.get_by_role('dialog',name='Workspace folders and files')
 expect(dialog.get_by_label('New folder name')).to_be_enabled(timeout=15000)
 folder=q['username'];dialog.get_by_label('New folder name').fill(folder)
 with page.expect_response(lambda r:r.url.endswith('/work/files') and r.request.method=='POST' and r.request.post_data_json.get('action')=='mkdir') as created:
  dialog.get_by_role('button',name='Create folder',exact=True).click()
 assert created.value.status==200
 resource=created.value.json();assert resource['directory'].endswith('/'+folder)
 (HOME/'qa-workspace-resource.json').write_text(json.dumps(resource))
 expect(dialog.get_by_text('Folder created. No work was started.',exact=True)).to_be_visible()
 files=[{'name':'qa-note.txt','mimeType':'text/plain','buffer':b'Disposable upload test. Not knowledge.\n'},{'name':'qa-large.bin','mimeType':'application/octet-stream','buffer':b'A'*(1200*1024)}]
 dialog.locator('input[type=file]').set_input_files(files)
 dialog.get_by_role('button',name='Upload to this folder',exact=True).click()
 expect(dialog.get_by_text('Saved: qa-note.txt, qa-large.bin. Nothing was executed or added to memory.',exact=True)).to_be_visible(timeout=90000)
 expect(dialog.get_by_role('button',name='Add qa-note.txt to project memory',exact=True)).to_be_disabled()
 dialog.locator('input[type=file]').set_input_files({'name':'qa-note.txt','mimeType':'text/plain','buffer':b'Disposable confirmed replacement.\n'})
 expect(dialog.get_by_role('button',name='Upload to this folder',exact=True)).to_be_disabled()
 dialog.get_by_role('checkbox',name=re.compile('I confirm replacing these exact listed versions')).check()
 dialog.get_by_role('button',name='Upload to this folder',exact=True).click()
 expect(dialog.get_by_text('Saved: qa-note.txt. Nothing was executed or added to memory.',exact=True)).to_be_visible(timeout=30000)
 receipt={'timezonePersisted':True,'timezoneEditedAndReloaded':True,'historyBackReachedWork':True,'workspaceCreated':resource['directory'],'smallAndOverOneMiBUploadsVerified':True,'overwriteRequiredConfirmation':True,'confirmedOverwriteVerified':True,'memoryDisabledWithoutProject':True,'pageErrors':errors}
 assert not errors,errors
 (HOME/'live-browser-receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
 context.storage_state(path=str(STATE));browser.close()
