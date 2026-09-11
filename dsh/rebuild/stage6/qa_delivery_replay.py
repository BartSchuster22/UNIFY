"""Resend an existing authenticated delivery over real TLS; do not create a receipt/effect."""
import hashlib,json,os,re,sqlite3,subprocess,sys
from pathlib import Path
import restore_dsh2 as r
import logical_state
assert os.geteuid()==0 and __import__('socket').gethostname()=='DSH2'
q=Path('/var/lib/alica-stage5-qa5');before=logical_state.snapshot();local=json.loads((q/'first-request.json').read_text())['id']
c=sqlite3.connect('file:'+str(q/'reference-data/reference.sqlite3')+'?mode=ro',uri=True)
rid=c.execute('SELECT receipt FROM requests WHERE id=?',(local,)).fetchone()[0];assert re.fullmatch('[a-f0-9-]{36}',rid)
sql="SELECT row_to_json(x) FROM (SELECT o.id AS delivery_id,r.application_id,r.id AS receipt_id,r.payload->'subject' AS subject,r.result FROM application_outbox o JOIN application_receipts r ON r.id=o.receipt_id WHERE r.id='"+rid+"' AND o.state='delivered') x"
data=r.run(['docker','exec',r.CELL+'-postgresql-1','psql','-U','unify_bootstrap','-d','unify','-Atc',sql]);row=json.loads(data)
js="let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{let r=JSON.parse(s);process.stdout.write(JSON.stringify({contractVersion:'alica-application/v1',deliveryId:r.delivery_id,applicationId:r.application_id,receiptId:r.receipt_id,subject:r.subject,result:r.result}));});"
p=subprocess.run(['docker','exec','-i',r.CELL+'-unify-core-1','/nodejs/bin/node','-e',js],input=data,text=True,capture_output=True,check=True);raw=p.stdout.encode()
assert c.execute('SELECT body_hash FROM deliveries WHERE id=? AND receipt=?',(row['delivery_id'],rid)).fetchone()[0]==hashlib.sha256(raw).hexdigest(),'Reconstructed bytes differ from original delivery';c.close()
py="""import hashlib,hmac,json,os,ssl,sys,time,urllib.request
from pathlib import Path
raw=sys.stdin.buffer.read();body=json.loads(raw);stamp=str(int(time.time()));delivery=body['deliveryId']
secret=Path(os.environ['REFERENCE_CALLBACK_SECRET_FILE']).read_text().strip()
sig=hmac.new(secret.encode(),stamp.encode()+b'.'+delivery.encode()+b'.'+raw,hashlib.sha256).hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
op=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=os.environ['REFERENCE_CORE_CA_FILE'])),NoRedirect())
req=urllib.request.Request('https://notebook.dsh.invalid/callback',data=raw,headers={'Content-Type':'application/json','x-alica-delivery':delivery,'x-alica-timestamp':stamp,'x-alica-signature':sig})
with op.open(req,timeout=20) as response:
 value=json.load(response);print(json.dumps({'status':response.status,'acknowledged':value.get('acknowledged')}))
"""
p=subprocess.run(['docker','exec','-i','dsh5-reference-qa5','python3','-I','-c',py],input=raw,capture_output=True,check=True);result=json.loads(p.stdout);assert result=={'status':200,'acknowledged':True}
assert logical_state.snapshot()==before
report={'schema':'stage6-real-delivery-replay/v1','originalDeliveryBytesHashVerified':True,'sameDeliveryAndReceipt':True,'freshAuthenticatedTransport':True,'realTlsWithoutBypass':True,'httpStatus':200,'duplicateAcknowledged':True,'allSevenLogicalDatabasesUnchanged':True,'noNewTaskOrEffect':True,'passed':True,'wholeStage6Accepted':False};r.save(r.OUT/'delivery-replay.json',report);print(json.dumps(report))
