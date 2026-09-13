"""Reproduce original inspection without writing on DSH2. Output must be new."""
import argparse, json, subprocess
from pathlib import Path
import bind_original_maven as binding

BASE = Path(__file__).resolve().parent
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
       '-o', 'StrictHostKeyChecking=yes',
       '-o', 'UserKnownHostsFile=/home/herman/.alica-provider-access/dsh2-stage7-known-hosts',
       '-i', '/home/herman/.ssh/alica_v1_deploy_ed25519', 'deploy@95.216.216.143',
       'sudo -n python3 -']


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--compare', type=Path, help='Require equality with retained original inspection')
    args=p.parse_args()
    if args.output.exists():raise ValueError('Refusing to overwrite existing evidence')
    queue=json.loads((BASE/'shipped-python-review/review-queue.json').read_text())
    requested=[r for r in queue if r['reviewStatus']=='licence-metadata-unresolved']
    images=json.loads((BASE/'current-qa4/summary.json').read_text())['images']
    script='REQUEST='+repr(requested)+'\nREQUEST_IMAGES='+repr(images)+'\n'+(BASE/'reinspect_original.py').read_text()
    result=subprocess.run(SSH,input=script,text=True,capture_output=True,timeout=550,check=True)
    observed=json.loads(result.stdout)
    binding.validate_inspection(observed)
    if args.compare and observed!=json.loads(args.compare.read_text()):
        raise ValueError('Original artifacts or QA state changed since prior inspection')
    with args.output.open('x') as f:f.write(json.dumps(observed,indent=2)+'\n')
    print(json.dumps({'images':len(observed['images']),'layers':len(observed['layers']),
                      'files':len(observed['files']),'unchangedComparison':bool(args.compare)}))


if __name__=='__main__':main()
