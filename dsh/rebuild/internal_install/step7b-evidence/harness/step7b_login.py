import json,re,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
BASE='https://dsh-dev.aquiero.com';QA=json.loads(Path('/home/herman/alica-internal-tls/step7b-current.json').read_text())['qa'];WORK='/opt/data/workspace/'+QA;ROOT=Path('/home/herman/alica-internal-tls')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context();page=c.new_page();page.set_default_timeout(120000);expect.set_options(timeout=90000)
 page.goto(BASE,wait_until='networkidle');page.get_by_role('link',name='Continue to secure sign-in').click();page.wait_for_load_state('networkidle');page.locator('input[name="username"]').fill('internal-owner');page.locator('input[name="password"]').fill((ROOT/'private/owner-new-password').read_text().strip());page.locator('button[type="submit"],input[type="submit"]').click();page.wait_for_load_state('networkidle')
 c.storage_state(path=str(ROOT/'private/step7b-browser-state.json'));print('Owner browser session refreshed');b.close()
