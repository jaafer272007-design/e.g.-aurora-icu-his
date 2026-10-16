# UPGRADE of the existing installation (pre-change data from pre-upgrade-setup.py) to this
# branch: the additive migration applied, existing orders untouched (NursingJson NULL, wire
# without `nursing`), legacy one-time implement behaviour unchanged, and the catalogue top-up
# adding exactly the two I&O types without rewriting any tenant configuration.
import json, sys
from common import *
st0 = load_state(); L = st0['legacy']
DOC, NUR = login('sara.rahman'), login('maya.chen')
print('== migration')
mig = sql('select "MigrationId" from "__EFMigrationsHistory" order by 1 desc limit 1')
check(mig.endswith('_AddOrderNursingSchedule'), f'newest applied migration is AddOrderNursingSchedule ({mig})')
col = sql('''select data_type || ' ' || is_nullable from information_schema.columns where table_name='Orders' and column_name='NursingJson' ''')
check(col == 'text YES', f'Orders.NursingJson is nullable text ({col})')
check(sql('select count(*) from "Orders" where "NursingJson" is not null') == '0', 'every pre-existing order has NursingJson NULL')
print('== existing orders unchanged')
after = {json.loads(l)['OrderId']: json.loads(l) for l in sql(f'''select string_agg(row_to_json(o)::text, E'\\n' order by "OrderId") from "Orders" o where "PatientId"='{L['pid']}' ''').split('\n')}
before = {json.loads(l)['OrderId']: json.loads(l) for l in st0['snapOrders'].split('\n')}
check(all({k: v for k, v in after[i].items() if k != 'NursingJson'} == before[i] for i in before), 'the legacy rows are identical apart from the new NULL column')
st, lst = call('GET', f'/api/icu/orders?patientId={L["pid"]}', NUR)
check(st == 200 and all('nursing' not in o for o in lst), 'legacy orders carry no `nursing` on the wire')
print('== legacy one-time implement (empty request) unchanged')
st, b = call('POST', f'/api/icu/orders/{L["active"]}/implement', NUR)
check(st == 200 and b['status'] == 'completed' and [e['action'] for e in b['history'][-2:]] == ['implemented', 'completed'] and 'nursing' not in b,
      f'legacy active -> 200 completed, implemented + completed, no nursing field ({st})')
check(sql(f'''select coalesce("NursingJson",'NULL') from "Orders" where "OrderId"='{L["active"]}' ''') == 'NULL', 'legacy order still has NursingJson NULL after implement')
st, b = call('POST', f'/api/icu/orders/{L["active"]}/implement', NUR)
check(st == 409 and 'already completed' in b['error'], f'legacy replay -> 409 already completed ({st})')
st, b = call('POST', f'/api/icu/orders/{L["pending"]}/implement', NUR)
check(st == 409 and 'pending' in b['error'], f'legacy pending, empty request -> 409 pending ({st})')
st, b = call('POST', f'/api/icu/orders/{L["pending"]}/implement', NUR, {'roundId': '2026-10-15T08:00:00.000Z~r1', 'attemptId': 'legacyattempt01'})
check(st == 400 and 'without nursing rounds' in b['error'], f'roundId on a legacy order -> 400 shape ({st})')
print('== catalogue top-up: exactly two rows added, tenant configuration untouched')
n = int(sql('select count(*) from "ObservationTypes"'))
check(n == L['typeCount'] + 2, f'ObservationTypes {L["typeCount"]} -> {n}')
rows = sql('''select string_agg(row_to_json(t)::text, E'\\n' order by "TypeCode") from "ObservationTypes" t where "TypeCode" not in ('io_current_intake_ml','io_current_output_ml')''')
check(rows == st0['snapTypes'], 'every pre-existing ObservationTypes row byte-identical (incl. the drain_output range, the retired type, the custom type)')
check(sql('''select string_agg(row_to_json(g)::text, E'\\n' order by "GroupCode") from "ObservationGroups" g''') == st0['snapGroups'], 'ObservationGroups byte-identical (devices still enabled)')
for code, name in (('io_current_intake_ml', 'Current Intake (manual snapshot)'), ('io_current_output_ml', 'Current Output (manual snapshot)')):
    r = json.loads(sql(f'''select row_to_json(t)::text from "ObservationTypes" t where "TypeCode"='{code}' '''))
    check(r['GroupCode'] == 'nursing' and r['DisplayName'] == name and r['Unit'] == 'mL' and r['ValueType'] == 'numeric'
          and r['Min'] == 0 and r['Max'] == 20000 and r['Active'] and not r['ScoreInput'] and not r['Custom'] and not r['IsDerived']
          and r['RefLow'] is None and r['CritLow'] is None,
          f'{code}: nursing group, mL numeric 0-20000, active, not a score input, no ranges')
sys.exit(summary())
