import os,subprocess,sys
from qa_host import assert_qa_host
assert_qa_host()
assert os.environ.get('DSH_STAGE5_QA_CELL')=='dsh2-stage5-qa5'
assert len(sys.argv)==2 and sys.argv[1] in ('start','stop')
subprocess.run(['systemctl',sys.argv[1],'alica-dsh2-stage5-qa5-observer.service'],check=True)
