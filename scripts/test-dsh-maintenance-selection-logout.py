#!/usr/bin/env python3
"""Verify selection of the disposable workspace, then revoke its browser session."""
import json,os,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
HOME=Path('/home/herman/.config/dsh-maintenance-recovery');STATE=HOME/'qa-browser-storage.json';q=json.loads((HOME/'qa-browser.json').read_text());ORIGIN='https://dsh-next.aquiero.com';os.umask(0o077)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 context=browser.new_context(storage_state=str(STATE));page=context.new_page()
 page.goto(ORIGIN+'/work',wait_until='domcontentloaded');page.get_by_text('Add new',exact=True).click()
 page.get_by_role('button',name='Browse / Create workspace · Upload files').first.click()
 dialog=page.get_by_role('dialog',name='Workspace folders and files')
 dialog.get_by_role('button',name='Open '+q['username'],exact=True).click()
 expect(dialog.get_by_role('button',name='Use this workspace',exact=True)).to_be_enabled(timeout=15000)
 dialog.get_by_role('button',name='Use this workspace',exact=True).click();expect(dialog).not_to_be_visible()
 selection=page.get_by_role('combobox',name='Default workspace path',exact=True)
 expect(selection).to_be_enabled(timeout=15000)
 expect(selection).to_have_value(re.compile(re.escape(q['username'])))
 expect(selection).not_to_have_value(re.compile('unavailable'))
 result=page.evaluate("""async()=>{
 const part=document.cookie.split('; ').find(s=>s.startsWith('aquiero_csrf='));
 if(!part)throw Error('No CSRF cookie');
 const r=await fetch('/api/v1/auth/logout',{method:'POST',headers:{'x-csrf-token':decodeURIComponent(part.split('=').slice(1).join('='))}});
 const probe=await fetch('/api/v1/auth/preferences');return {logoutStatus:r.status,unauthenticatedStatus:probe.status};
 }""")
 assert result['logoutStatus'] in [200,204] and result['unauthenticatedStatus']==401,result
 receipt=json.loads((HOME/'live-browser-receipt.json').read_text());receipt.update(workspaceSelectionVerified=True,disposableCoreSessionRevoked=True,logout=result)
 (HOME/'live-browser-receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({'workspaceSelectionVerified':True,'logout':result}));browser.close()
