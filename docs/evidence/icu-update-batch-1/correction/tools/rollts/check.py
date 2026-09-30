# Checks the C# (server sources) and TS (client sources) harness outputs
# against the scenario EXPECTATIONS, and against each other (row parity +
# the Orders next-dose chip == the server's current round).
import json,sys
sc=json.load(open(sys.argv[1])); cs=json.load(open(sys.argv[2])); ts=json.load(open(sys.argv[3]))
fails=0; checks=0
def bad(*m):
    global fails; fails+=1; print('FAIL',*m)
def check_read(name,side,exp,rows):
    global checks
    pend=[r for r in rows if r['status']=='scheduled']
    if 'current' in exp:
        checks+=1
        rr=[r for r in pend if r.get('round') is not None]
        if len(rr)!=1: return bad(name,side,'expected exactly ONE current round',pend)
        r=rr[0]
        if r['scheduledTime']!=exp['current'] or r['round']!=exp['round']: bad(name,side,'current',r,'expected',exp)
        if r['adminId']!=exp['current'].replace(' ','T')+f"~r{exp['round']}": bad(name,side,'identity',r['adminId'])
        if 'timerFrom' in exp and r.get('timerFrom')!=exp['timerFrom']: bad(name,side,'timerFrom',r,exp)
        if 'rule' in exp and r.get('timerRule')!=exp['rule']: bad(name,side,'rule',r,exp)
        if len(pend)!=1: bad(name,side,'extra pending rows (missed/future rounds must not exist)',pend)
    if exp.get('once'):
        checks+=1
        if [r['adminId'] for r in pend]!=[exp['once'].replace(' ','T')]: bad(name,side,'once row',pend)
    if exp.get('none'):
        checks+=1
        if pend: bad(name,side,'expected no pending row',pend)
    if exp.get('prn'):
        checks+=1
        if [r['adminId'] for r in pend]!=['prn']: bad(name,side,'prn row',pend)
for s,c,t in zip(sc,cs,ts):
    name=s['name'][:3]
    for st,sc_,st_ in zip(s['steps'],c['steps'],t['steps']):
        if 'read' in st:
            check_read(name,'server',st.get('expect',{}),sc_['rows'])
            check_read(name,'client',st.get('expect',{}),st_['rows'])
            checks+=1
            key=lambda r:(r['adminId'],r['scheduledTime'],r['status'],r['documentedTime'],r['round'],r['timerFrom'],r['timerRule'])
            if [key(r) for r in sc_['rows']]!=[key(r) for r in st_['rows']]: bad(name,'ROW PARITY',st['read'],'\n cs',[key(r) for r in sc_['rows']],'\n ts',[key(r) for r in st_['rows']])
            checks+=1
            pend=[r for r in sc_['rows'] if r['status']=='scheduled' and r['adminId'] not in ('prn','ondemand')]
            exp=pend[0]['scheduledTime'] if pend else None
            if st_.get('nextDose')!=exp: bad(name,'ORDERS CHIP',st['read'],'server',exp,'chip',st_.get('nextDose'))
        elif 'doc' in st:
            checks+=1
            if sc_['result']!=st['expect']: bad(name,'server doc',st['doc'],st['at'],sc_['result'],'expected',st['expect'])
            if not st.get('csOnly'):
                checks+=1
                want='ok' if st['expect']=='ok' else 'rejected'
                if st_['result']!=want: bad(name,'client doc',st['doc'],st['at'],st_['result'],'expected',want)
                if sc_['id']!=st_['id']: bad(name,'identity parity',sc_['id'],st_['id'])
            if 'expectNext' in st:
                checks+=1
                if sc_['next']!=st['expectNext']: bad(name,'server next',sc_['next'],'expected',st['expectNext'])
                if not st.get('csOnly') and st_['next']!=st['expectNext']: bad(name,'client next',st_['next'],'expected',st['expectNext'])
            if 'expectNextId' in st:
                checks+=1
                if sc_['nextId']!=st['expectNextId'] or st_['nextId']!=st['expectNextId']: bad(name,'next identity',sc_['nextId'],st_['nextId'],'expected',st['expectNextId'])
print(f'checks: {checks} · failures: {fails} · scenarios: {len(sc)}')
sys.exit(1 if fails else 0)
