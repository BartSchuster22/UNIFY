#!/usr/bin/env python3
"""Read back the submitted acceptance session; never resubmit an uncertain turn."""
import hashlib,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
HOME=Path('/home/herman/.config/dsh-maintenance-recovery');os.umask(0o077)
r=json.loads((HOME/'owner-journey-resources.json').read_text());sid=r['sessions'][0];expected=hashlib.sha256((r['agent']+'-post-upgrade').encode()).hexdigest()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox']);context=browser.new_context(storage_state=str(HOME/'qa-browser-storage.json'));page=context.new_page();page.goto('https://dsh-next.aquiero.com',wait_until='domcontentloaded')
 handle=page.wait_for_function("""async sid=>{let d=await(await fetch('/api/v1/frameworks/hermes-alica/conversations/sessions/'+encodeURIComponent(sid)+'/messages?limit=500',{cache:'no-store'})).json();return d.items?.some(m=>m.role==='assistant' && m.content?.includes('DSH_OWNER_MODEL_OK')) ? d : false}""",arg=sid,timeout=240000,polling=2000)
 data=handle.json_value()
 (HOME/'owner-journey-messages.json').write_text(json.dumps(data,indent=2))
 assistants=[m for m in data['items'] if m['role']=='assistant'];tools=[m for m in data['items'] if m['role']=='tool']
 assert any(expected in (m.get('content') or '') and 'DSH_OWNER_MODEL_OK' in (m.get('content') or '') for m in assistants)
 assert any(expected in (m.get('content') or '') for m in tools),data
 receipt={'agent':r['agent'],'session':sid,'liveModelResponseVerified':True,'liveTerminalToolResultVerified':True,'expectedSha256':expected,'assistantMessages':len(assistants),'toolMessages':len(tools)}
 (HOME/'owner-journey-result.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt));browser.close()
