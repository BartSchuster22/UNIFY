"""LABELLED subprocess protocol fixture: no Hermes SDK, credentials or inference."""
import json,sys,time,signal
x=json.load(sys.stdin)
mode=x['subject']
if mode=='timeout':
    signal.signal(signal.SIGTERM,signal.SIG_IGN)
    time.sleep(30)
elif mode=='scope-echo':
    print(json.dumps({'state':'running','reference':dict(x,taskId='t_fixture',sessionId='alica-app-'+x['receiptId'])}))
elif mode=='overflow':print('x'*140000)
elif mode=='invalid':print('not json')
elif mode=='wrong-scope':print(json.dumps({'state':'running','reference':dict(x,subject='other',taskId='t_fixture',sessionId='alica-app-'+x['receiptId'])}))
elif mode=='crash':
    print('MOCK-SECRET',file=sys.stderr);sys.exit(1)
else:print(json.dumps({'state':'missing','reference':None}))
