"""Transfer verified recovery inputs from Elio and apply cold restore on fresh DSH2."""
import json,shlex
from pathlib import Path
import provider_rebuild as p
HERE=Path(__file__).resolve().parent

def cleanup_command(path,privileged=False):
 code='from pathlib import Path;Path('+repr(str(path))+').unlink()'
 return ('sudo -n ' if privileged else '')+'python3 -c '+shlex.quote(code)

def main():
 plan=json.loads(p.PLAN.read_text());p.need(plan['phase']=='fresh-os-ready','Fresh OS preflight required')
 p.need(not p.ssh('sudo -n docker ps -aq; sudo -n docker volume ls -q',p.KNOWN),'Nonempty target: do not repeat transfer/restore')
 p.ssh('install -d -m 700 /home/deploy/.stage6-inputs',p.KNOWN)
 args=['scp','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(p.KNOWN),'-i',str(p.KEY)]
 files=[Path('/home/herman/dsh2-backups/dsh2-stage6-backup.age'),Path('/home/herman/dsh2-backups/reference-image.tar'),Path('/home/herman/.config/alica-recovery/dsh2.agekey'),*sorted(HERE.glob('*.py'))]
 p.run([*args,*map(str,files),'deploy@'+p.IP+':/home/deploy/.stage6-inputs/'],timeout=600)
 p.ssh('set -eu; sudo -n install -d -m 700 /var/lib/alica-stage6-recovery; sudo -n install -d -m 755 /usr/local/lib/alica-recovery-stage6; sudo -n install -m 644 /home/deploy/.stage6-inputs/*.py /usr/local/lib/alica-recovery-stage6/; sudo -n install -m 600 /home/deploy/.stage6-inputs/dsh2.agekey /var/lib/alica-stage6-recovery/restore.agekey; sudo -n mv /home/deploy/.stage6-inputs/dsh2-stage6-backup.age /home/deploy/.stage6-inputs/reference-image.tar /var/lib/alica-stage6-recovery/',p.KNOWN)
 p.ssh(cleanup_command('/home/deploy/.stage6-inputs/dsh2.agekey'),p.KNOWN)
 print(p.ssh('sudo -n python3 -m unittest discover -s /usr/local/lib/alica-recovery-stage6 -p "test_*.py" 2>&1',p.KNOWN),flush=True)
 command='sudo -n python3 /usr/local/lib/alica-recovery-stage6/archive.py extract --archive /var/lib/alica-stage6-recovery/dsh2-stage6-backup.age --identity /var/lib/alica-stage6-recovery/restore.agekey --sha256 '+p.CIPHER+' --destination /var/lib/alica-stage6-recovery/extracted'
 print(p.ssh(command,p.KNOWN,600),flush=True)
 p.ssh(cleanup_command('/var/lib/alica-stage6-recovery/restore.agekey',True),p.KNOWN)
 print(p.ssh('sudo -n python3 /usr/local/lib/alica-recovery-stage6/restore_dsh2.py apply --stage /var/lib/alica-stage6-recovery/extracted --previous-boot-id '+plan['before']['bootId'],p.KNOWN,600),flush=True)
if __name__=='__main__':main()
