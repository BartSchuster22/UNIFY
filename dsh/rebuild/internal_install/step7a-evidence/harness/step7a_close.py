import json,subprocess
from step7a_continuity import R,QA,remote,snap
proof=json.loads((R/'step7a-interruption-proof.json').read_text());assert proof['oneNativeRun'] and proof['noOrphanWorkers'] and proof['noFalseCompletion']
assert json.loads((R/'step7a-interruption-browser.json').read_text())['taskTitlesAndRunFeedbackVisible']
target=json.loads((R/'step7a-interruption-verified-create.json').read_text())['created']['id']
snap('step7a-final-native.json')
artifacts=remote('step7a_export_artifacts.py',QA)
(R/'step7a-artifacts.json').write_text(json.dumps(artifacts,indent=2))
subprocess.run(['/home/herman/stage7-browser-venv/bin/python',str(R/'step7a_browser_archive.py')],check=True,timeout=240)
cleanup=remote('step7a_cleanup_final.py',QA+' '+target);(R/'step7a-final-cleanup.json').write_text(json.dumps(cleanup,indent=2))
closure=remote('step7a_host.py','verify',False);(R/'step7a-final-protection.json').write_text(json.dumps(closure,indent=2))
subprocess.run(['/home/herman/stage7-browser-venv/bin/python',str(R/'step7a_browser_final_cleanup.py')],check=True,timeout=240)
print(json.dumps({'disposableCleanupPassed':True,'finalProtectionPassed':True,'healthyServices':closure['healthyServices'],'unrelatedContainersUnchanged':closure['unrelatedContainersUnchanged']}))
