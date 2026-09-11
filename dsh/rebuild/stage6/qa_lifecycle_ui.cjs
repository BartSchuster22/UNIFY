// Actual installed UI; no mocked routes, response injection, or TLS bypass.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/herman/dashboard-v2/node_modules/playwright-core');
const fs=require('fs'),assert=require('assert'),{execFileSync}=require('child_process');
const base=process.env.DSH_BROWSER_HOME||'/home/herman/stage6-dsh2-browser';
function observer(action){execFileSync('ssh',['-o','BatchMode=yes','-o','UserKnownHostsFile=/home/herman/.alica-provider-access/dsh2-stage6-known-hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@95.216.216.143','sudo -n env DSH_STAGE5_QA_CELL=dsh2-stage5-qa5 python3 /srv/alica-dsh-qa/qa/ui_observer.py '+action],{timeout:30000});}
(async()=>{
 const b=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'/home/herman/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,env:{...process.env,HOME:base+'/home'},args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP stage5.qa.invalid 127.0.0.1:29443']});
 const result={schema:'stage6-restored-lifecycle-ui/v1',cell:'dsh2-stage5-qa5',tlsBypass:false,mockedResponses:false,wholeStage6Accepted:false};let stopped=false;
 try{
  const ctx=await b.newContext({viewport:{width:1440,height:1100},ignoreHTTPSErrors:false});
  await ctx.addCookies(JSON.parse(fs.readFileSync(base+'/browser-cookies.json','utf8')).map(c=>{if(c.expires===null)delete c.expires;return c;}));
  const p=await ctx.newPage();await p.goto('https://stage5.qa.invalid/operations',{waitUntil:'networkidle',timeout:30000});
  await p.getByRole('heading',{name:'Host operations · Doghouse DSH',exact:true}).waitFor({timeout:30000});
  const panel=p.locator('[aria-label="Host operations"]');
  await panel.getByText(/Docker reachable · Ownership verified/).waitFor({timeout:30000});
  const text=await panel.innerText();assert(text.includes('not model-token or billing measurements'));assert(!text.includes('dsha1_'));
  assert.strictEqual(await panel.locator('tbody tr').count(),7);
  result.authenticatedPanel=true;result.sevenServiceRows=true;result.billingProvenanceExplicit=true;
  await p.screenshot({path:base+'/operations-healthy.png',fullPage:true});
  observer('stop');stopped=true;
  await panel.getByText(/STALE observation/).waitFor({timeout:40000});
  assert.strictEqual(await panel.getByText('unknown / stale',{exact:true}).count(),7);result.actualObserverOutageShownUnknown=true;
  await p.screenshot({path:base+'/operations-stale.png',fullPage:true});
  observer('start');stopped=false;
  await panel.getByText(/STALE observation/).waitFor({state:'hidden',timeout:30000});
  result.liveObservationRestored=true;result.passed=true;result.browser=await b.version();
 }catch(e){result.passed=false;result.error=e.message;throw e;}
 finally{if(stopped)observer('start');await b.close();fs.writeFileSync(base+'/ui-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
})().catch(()=>process.exit(1));
