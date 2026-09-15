#!/usr/bin/env python3
"""Real model and read-only terminal acceptance through deployed owner-role UI."""
import hashlib,json,os,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
HOME=Path('/home/herman/.config/dsh-maintenance-recovery');ORIGIN='https://dsh-next.aquiero.com';os.umask(0o077)
r=json.loads((HOME/'owner-journey-resources.json').read_text());agent=r['agent'];title=agent+'-acceptance'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox']);context=browser.new_context(storage_state=str(HOME/'qa-browser-storage.json'));page=context.new_page()
 page.goto(ORIGIN+'/chat',wait_until='domcontentloaded')
 expect(page.get_by_role('combobox',name='Agent profile',exact=True)).to_be_enabled(timeout=30000)
 page.get_by_role('combobox',name='Agent profile',exact=True).click();page.get_by_role('option',name=re.compile(re.escape(agent))).click()
 page.get_by_label('New internal session',exact=True).fill(title);page.get_by_role('button',name='Create session',exact=True).click()
 button=page.get_by_role('button',name=re.compile(re.escape(title)));expect(button).to_be_visible(timeout=30000);button.click()
 sessions=page.evaluate("async()=>await(await fetch('/api/v1/frameworks/hermes-alica/conversations/sessions?limit=500')).json()")
 matches=[s for s in sessions['items'] if s.get('title')==title];assert len(matches)==1
 sid=matches[0]['id'];r['sessions']=[sid];(HOME/'owner-journey-resources.json').write_text(json.dumps(r))
 payload=agent+'-post-upgrade';expected=hashlib.sha256(payload.encode()).hexdigest()
 command="python3 -c \"import hashlib; print(hashlib.sha256(b'"+payload+"').hexdigest())\""
 prompt='Acceptance test. Use the terminal tool to execute exactly this read-only command: '+command+'. Do not read credentials, write files, modify settings, create jobs or save memory. Reply with the actual command output and DSH_OWNER_MODEL_OK. Do not calculate or invent terminal output.'
 page.get_by_label('Message',exact=True).fill(prompt)
 page.get_by_role('button',name='Send message',exact=True).click()
 expect(page.get_by_label('Message',exact=True)).to_have_value('',timeout=180000)
 data=page.evaluate("async sid=>await(await fetch('/api/v1/frameworks/hermes-alica/conversations/sessions/'+encodeURIComponent(sid)+'/messages?limit=500')).json()",sid)
 (HOME/'owner-journey-messages.json').write_text(json.dumps(data,indent=2))
 assistants=[m for m in data['items'] if m['role']=='assistant'];tools=[m for m in data['items'] if m['role']=='tool']
 assert any(expected in (m.get('content') or '') and 'DSH_OWNER_MODEL_OK' in (m.get('content') or '') for m in assistants),data
 assert any(expected in (m.get('content') or '') for m in tools),data
 receipt={'agent':agent,'session':sid,'liveModelResponseVerified':True,'liveTerminalToolResultVerified':True,'expectedSha256':expected,'assistantMessages':len(assistants),'toolMessages':len(tools)}
 (HOME/'owner-journey-result.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt));browser.close()
