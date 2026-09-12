"""Update precondition: actual QA3 authenticated cold restore, not legacy evidence."""
import json
from cold_restore import CELL,ROOT,OUT,BUNDLE,RELEASE,run,save,guard as host_guard
import archive
MANIFEST=json.loads((OUT/'backup-receipt.json').read_text())['manifestSha256']
def guard():
 host_guard()
 result=json.loads((OUT/'restore-result.json').read_text())
 assert result['passed'] and result['releaseSha256']==RELEASE
 assert archive.digest(OUT/'verified/manifest.json')==MANIFEST
