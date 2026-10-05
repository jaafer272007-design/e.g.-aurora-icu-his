import json,sys
cs=json.load(open(sys.argv[1])); ts=json.load(open(sys.argv[2]))
fails=0
for a,b in zip(cs,ts):
    assert a['name']==b['name']
    for sa,sb in zip(a['steps'],b['steps']):
        if 'rows' in sa:
            # compare every derived row; documentedTime only on facts supplied explicitly (mock stamps its own clock format)
            ra=[(r['adminId'],r['scheduledTime'],r['status'],r.get('missedEarlier'),r.get('scheduleAnchor')) for r in sa['rows']]
            rb=[(r['adminId'],r['scheduledTime'],r['status'],r.get('missedEarlier'),r.get('scheduleAnchor')) for r in sb['rows']]
            if ra!=rb: fails+=1; print('ROW MISMATCH',a['name'],sa['read'],'\n  cs',ra,'\n  ts',rb)
            # the Orders next-dose chip must equal the earliest outstanding instance the server derives
            pend=[r for r in sa['rows'] if r['status'] in ('scheduled','missed-earlier') and r['adminId'] not in ('prn','ondemand')]
            exp=pend[0]['scheduledTime'] if pend else None
            if sb.get('nextDose')!=exp: fails+=1; print('NEXT-DOSE MISMATCH',a['name'],sa['read'],'server-earliest',exp,'orders-chip',sb.get('nextDose'))
        elif 'result' in sa:
            ka='ok' if sa['result'].startswith('ok') else 'rejected'
            if sa['result'].startswith('ok') and sb['result']!=sa['result']: fails+=1; print('DOC MISMATCH',a['name'],sa,sb)
            if not sa['result'].startswith('ok') and sb['result']!='rejected': fails+=1; print('DOC MISMATCH',a['name'],sa,sb)
print('parity failures:',fails, '| scenarios:',len(cs))
sys.exit(1 if fails else 0)
