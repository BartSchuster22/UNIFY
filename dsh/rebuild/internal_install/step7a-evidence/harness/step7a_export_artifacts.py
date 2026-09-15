import json,sys
from pathlib import Path
qa=sys.argv[1];assert qa.startswith('qa-step7a-') and '/' not in qa
w=Path('/opt/data/workspace')/qa
print(json.dumps({n:(w/n).read_text() for n in ['input.csv','result.json','verified-interruption-attempts.txt','verified-interruption-started.txt']}))
