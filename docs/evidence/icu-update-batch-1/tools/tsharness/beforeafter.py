import json,sys
b=json.load(open(sys.argv[1])); a=json.load(open(sys.argv[2]))
def fmt(r):
    x=f"{r['scheduledTime'] or '(prn)'} {r['status']}"
    if r.get('missedEarlier'): x+=f"×{r['missedEarlier']}"
    if r['status'] in ('given','held','refused'): x+=f"@{(r.get('documentedTime') or '')[-5:]}"
    if r.get('scheduleAnchor'): x+='↻'
    return x
out=[]
for sb,sa in zip(b,a):
    out.append(f"## {sa['name']}")
    for xb,xa in zip(sb['steps'],sa['steps']):
        if 'rows' in xa:
            out.append(f"  read @ {xa['read']}")
            out.append("    BEFORE: "+" | ".join(fmt(r) for r in xb['rows']))
            out.append("    AFTER : "+" | ".join(fmt(r) for r in xa['rows']))
        elif 'modify' in xa: out.append(f"  modify frequency -> {xa['modify']}")
        else: out.append(f"  document {xa['doc']} {xa['action']} @ {xa['at']}: BEFORE {xb['result']} · AFTER {xa['result']}")
print("\n".join(out))
