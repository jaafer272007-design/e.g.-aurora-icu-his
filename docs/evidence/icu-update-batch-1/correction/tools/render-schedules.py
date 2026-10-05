# Renders the deterministic harness output (server sources) as readable schedules,
# each read's rows and each documentation's result + the next round, beside the
# scenario's stated expectation. The client output is row-for-row identical
# (checked by rollts/check.py; see logs/final/16-expectations+parity.log).
import json, sys
sc = json.load(open(sys.argv[1])); cs = json.load(open(sys.argv[2]))
def fmt(r):
    t = (r['scheduledTime'] or '(prn)')[5:] if r['scheduledTime'] else '(prn)'
    if r['status'] == 'scheduled':
        x = f"[{t} " + (f"round {r['round']}" if r.get('round') else 'pending') + ']'
        if r.get('timerFrom'): x += f"(timed from {'given' if r['timerRule'] == 'given' else 'skipped slot'} {r['timerFrom'][5:]})"
        return x
    return f"{t} {r['status']}@{(r.get('documentedTime') or '')[5:]}" + (f" r{r['round']}" if r.get('round') else ' legacy')
out = ['Rolling timer — deterministic schedules (times UTC, "MM-DD HH:mm"; [ ] = the ONE current round).', '']
for s, c in zip(sc, cs):
    out.append(f"## {s['name']}  ({s['frequency']}{', PRN' if s.get('prn') else ''}; signed {s['signed'][5:]})")
    if s.get('legacyFacts'): out.append('  legacy facts: ' + '; '.join(f"{f['scheduledTime'][5:]} {f['status']}@{f['documentedTime'][5:]}" for f in s['legacyFacts']))
    for st, r in zip(s['steps'], c['steps']):
        if 'read' in st:
            out.append(f"  read @ {st['read'][5:]}:  " + ' | '.join(fmt(x) for x in r['rows']))
        elif 'modify' in st: out.append(f"  modify frequency -> {st['modify']}")
        elif 'discontinue' in st: out.append('  discontinue the order')
        else:
            at = f" (actual {st['administeredAt'][5:]})" if st.get('administeredAt') else ''
            nxt = f" -> next round {r['next'][5:]} [{r['nextId']}]" if r['result'] == 'ok' and r.get('next') else ''
            ok = 'as expected' if r['result'] == st['expect'] and (not st.get('expectNext') or r['next'] == st['expectNext']) else f"EXPECTED {st['expect']} {st.get('expectNext', '')}"
            out.append(f"  {st['action']:<7} {r['id']} @ {st['at'][5:]}{at}: {r['result']}{nxt}   ({ok})")
    out.append('')
print('\n'.join(out))
