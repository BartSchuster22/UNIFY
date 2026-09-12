"""Generate a separate QA4 harness; preserve every QA3 script and artifact."""
from pathlib import Path
import hashlib,json,ast
ROOT=Path(__file__).parent;DEST=ROOT/'qa4';assert not DEST.exists();DEST.mkdir()
REPLACEMENTS=[('dsh-stage7-qa1-2772d9c','dsh-stage7-qa4-72297c3'),('stage7-qa1-2772d9c','stage7-qa4-72297c3'),('43a98d80cb49223e76be72b040913826552ba82cdd209e065d9e18162d4c68c6','26f98d6ffc8ecc576628b061a9851b8cd40e1e917f070a8567b9fb48ee969553'),('26ccaff3c5539288dda0a0e9b60fa7187fb64b70c772f104e1c0068efbed2b01','1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c'),('2772d9c','72297c3'),('qa3','qa4'),('QA3','QA4'),('/srv/alica-stage7-qa/','/srv/alica-stage7-qa4/')]
files=list((ROOT/'qa').glob('*.py'))+[ROOT/'clean_install.py']
record={}
for p in files:
 text=p.read_text()
 for a,b in REPLACEMENTS:text=text.replace(a,b)
 ast.parse(text)
 (DEST/p.name).write_text(text);record[p.name]={'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'generatedSha256':hashlib.sha256(text.encode()).hexdigest()}
(DEST/'generation.json').write_text(json.dumps({'schema':'stage7-qa4-harness/v1','purpose':'Fresh namespace and candidate pins only; no predecessor result inheritance','replacements':REPLACEMENTS,'files':record},indent=2)+'\n')
print(json.dumps({'generated':len(files),'namespace':'dsh2-stage7-qa4','releaseSha256':REPLACEMENTS[3][1]}))
