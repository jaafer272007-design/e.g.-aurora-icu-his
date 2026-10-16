# EXISTING-INSTALLATION setup, run against the PRE-CHANGE server (reviewed base 2fc317c) on the
# disposable database: legacy nursing orders (active / pending / completed) and tenant
# catalogue configuration (a range on a seeded type, a retired type, a custom type, a group
# enabled). Then snapshots those rows byte-for-byte so the upgrade can be compared.
import json, sys
from common import *
DOC, NUR = login('sara.rahman'), login('maya.chen')
run = utcnow().strftime('%H%M%S')
PID, EID = admit(DOC, f'Legacy{run}')
print(f'admitted {PID} ({EID})')
def nursing(summary, sign):
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': PID, 'category': 'Nursing', 'summary': summary,
        'priority': 'Routine', 'requiresImplementation': True}], 'sign': sign})
    assert st == 200, (st, o); return o[0]['orderId']
leg_active = nursing(f'legacy one-time active {run}', True)
leg_pending = nursing(f'legacy one-time pending {run}', False)
leg_done = nursing(f'legacy one-time completed {run}', True)
st, _ = call('POST', f'/api/icu/orders/{leg_done}/implement', NUR); assert st == 200, st
# tenant catalogue configuration
st, b = call('PUT', '/api/icu/observation-catalog/drain_output', DOC, {'refLow': 10, 'refHigh': 900}); print('range on drain_output ->', st)
st, b = call('POST', '/api/icu/observation-catalog/restraint_assessment/deactivate', DOC); print('retire restraint_assessment ->', st)
st, b = call('POST', '/api/icu/observation-catalog', DOC, {'name': f'Synthetic custom check {run}', 'group': 'nursing', 'unit': 'cm', 'min': 0, 'max': 50}); print('custom type ->', st)
custom = b['typeCode'] if st in (200, 201) else None
st, b = call('POST', '/api/icu/observations/groups/devices/enable', DOC)
print('enable devices group ->', st)
snap_types = sql('''select string_agg(row_to_json(t)::text, E'\\n' order by "TypeCode") from "ObservationTypes" t''')
snap_groups = sql('''select string_agg(row_to_json(g)::text, E'\\n' order by "GroupCode") from "ObservationGroups" g''')
snap_orders = sql(f'''select string_agg(row_to_json(o)::text, E'\\n' order by "OrderId") from "Orders" o where "PatientId"='{PID}' ''')
n_types = sql('select count(*) from "ObservationTypes"')
save_state({'legacy': {'pid': PID, 'eid': EID, 'active': leg_active, 'pending': leg_pending, 'done': leg_done, 'custom': custom,
    'typeCount': int(n_types)}, 'snapTypes': snap_types, 'snapGroups': snap_groups, 'snapOrders': snap_orders})
print(f'legacy orders: active {leg_active}, pending {leg_pending}, completed {leg_done}; ObservationTypes rows: {n_types}')
