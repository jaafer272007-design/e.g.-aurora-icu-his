/* Session 2 — a SYNTHETIC stand-in for the parts of the Aurora API the
   patient chart reads, served inside Playwright by page.route(). Synthetic
   patients and drugs only; nothing here is real clinical data, and no
   server, database or hospital system is contacted.

   The roster (/api/icu/patients) is served with synthetic names and NO
   demo vitals. Endpoints the chart does not depend on (timeline, labs,
   coverage, attachments …) answer 503: a dev bundle then uses its own mock
   layer, exactly as when a server is unreachable; a production bundle
   shows them unavailable. Patients:
     A = P-1001  full data, every chart source populated
     B = P-1002  different values; Pplat/PEEP charted at DIFFERENT times
     C = P-1003  observations / orders / imaging answer 500 (error states)
     D = P-1004  real empties: no observations, no active meds, no studies
     E = P-1005  only a DISCHARGED encounter (→ the /history redirect)
   Every patient carries unique drug / study names, so a leak of one
   patient's rows into another's chart is detectable by text. */

const pad = n => String(n).padStart(2, '0')
/** UTC wire 'yyyy-MM-dd HH:mm', `minAgo` minutes before now */
function wire(minAgo) {
  const d = new Date(Date.now() - minAgo * 60000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
let seq = 0
function obs(pid, enc, code, value, minAgo, extra = {}) {
  seq += 1
  return {
    observationId: `OBS-${seq}`, patientId: pid, encounterId: enc, typeCode: code, value: String(value),
    unit: '', clinicalTime: wire(minAgo), source: 'manual', recordedBy: 'RN Synthetic',
    enteredAt: wire(minAgo) + ':00', amendments: [], ...extra,
  }
}

function observationsFor(pid) {
  if (pid === 'P-1001') {
    const e = 'ENC-A1'
    return [
      // older values first (server order is oldest-first)
      obs(pid, e, 'urine_output', 100, 300),
      obs(pid, e, 'iv_fluids', 500, 180),
      obs(pid, e, 'hr', 88, 120),
      obs(pid, e, 'hr', 101, 20),
      obs(pid, e, 'art_sbp', 111, 20), obs(pid, e, 'art_dbp', 61, 20),
      obs(pid, e, 'map', 77, 20), obs(pid, e, 'sbp', 121, 20), obs(pid, e, 'dbp', 71, 20),
      obs(pid, e, 'spo2', 95, 20), obs(pid, e, 'rr', 21, 20),
      obs(pid, e, 'temp', 37.9, 20, { amendments: [{ newValue: '38.1', reason: 'transcription', amendedBy: 'RN Synthetic', amendedAt: wire(10) + ':00' }] }),
      obs(pid, e, 'etco2', 36, 20), obs(pid, e, 'cvp', 9, 20), obs(pid, e, 'cardiac_rhythm', 'AF', 20),
      obs(pid, e, 'vent_mode', 'SIMV-A', 40), obs(pid, e, 'fio2', 45, 40), obs(pid, e, 'peep', 8, 40),
      obs(pid, e, 'rr_set', 14, 40), obs(pid, e, 'rr_measured', 18, 40), obs(pid, e, 'vt_set', 450, 40),
      obs(pid, e, 'vt_exhaled', 430, 40), obs(pid, e, 'ppeak', 28, 40), obs(pid, e, 'pplat', 24, 40),
      obs(pid, e, 'minute_ventilation', 7.6, 40), obs(pid, e, 'ie_ratio', '1:2', 40),
      obs(pid, e, 'cardiac_output', 5.1, 60), obs(pid, e, 'cardiac_index', 2.7, 60), obs(pid, e, 'svr', 980, 60),
      obs(pid, e, 'lactate_poc', 2.4, 60), obs(pid, e, 'urine_output', 60, 60),
      // the I&O manual snapshots (contract §5.1) — must NEVER surface on the observations card
      obs(pid, e, 'io_current_intake_ml', 1234, 15), obs(pid, e, 'io_current_output_ml', 4321, 15),
    ]
  }
  if (pid === 'P-1002') {
    const e = 'ENC-B1'
    return [
      obs(pid, e, 'hr', 66, 30), obs(pid, e, 'spo2', 99, 30), obs(pid, e, 'rr', 12, 30),
      obs(pid, e, 'temp', 36.6, 30), obs(pid, e, 'sbp', 132, 30), obs(pid, e, 'dbp', 79, 30),
      obs(pid, e, 'peep', 5, 90), obs(pid, e, 'pplat', 19, 30),   // different timepoints → ΔP NOT derived
      obs(pid, e, 'fio2', 30, 30),
      obs(pid, e, 'cardiac_output', 6.2, 45),
    ]
  }
  if (pid === 'P-1004') return []
  return null // C: 500
}

function encountersFor(pid, status) {
  const open = {
    'P-1001': { encounterId: 'ENC-A1', weightKg: 81, heightCm: 177, measurements: [
      { time: wire(3000), actor: 'Dr Synthetic', field: 'weight', action: 'recorded at admission', value: 80 },
      { time: wire(600), actor: 'RN Synthetic', field: 'weight', action: 'corrected', prior: 80, value: 81 },
    ] },
    'P-1002': { encounterId: 'ENC-B1', weightKg: 64, heightCm: 160, measurements: [] },
    'P-1003': { encounterId: 'ENC-C1' },
    'P-1004': { encounterId: 'ENC-D1' },
  }[pid]
  const base = { patientId: pid, patientName: pid, bedId: '', diagnosis: '', attending: '', admittedAt: wire(4000), admittedBy: 'Dr Synthetic', events: [] }
  if (pid === 'P-1005') {
    const closed = { ...base, encounterId: 'ENC-E1', status: 'discharged' }
    return status === 'open' ? [] : [closed]
  }
  if (!open) return []
  if (status === 'discharged') return []
  return [{ ...base, ...open, status: 'open' }]
}

function identityFor(pid) {
  const sex = pid === 'P-1002' ? 'F' : 'M'
  return { patientId: pid, mrn: `MRN-${pid}`, name: `Synthetic ${pid}`, sex, fullName: `Synthetic Person ${pid}` }
}

function med(pid, id, status, drug, dose, route, frequency, extra = {}) {
  return {
    orderId: id, patientId: pid, bedId: '', patientName: pid, category: 'Medication',
    summary: `${drug} ${dose} · ${route} · ${frequency}`,
    medication: { drugId: drug.toLowerCase(), drug, dose, route, frequency, duration: 'ongoing', prn: false, ...(extra.medication ?? {}) },
    priority: extra.priority ?? 'Routine', status, orderedBy: 'Dr Synthetic', orderedTime: wire(500),
    history: status === 'pending' ? [{ time: wire(500), actor: 'Dr Synthetic', action: 'created' }]
      : [{ time: wire(500), actor: 'Dr Synthetic', action: 'created' }, { time: wire(495), actor: 'Dr Synthetic', action: 'signed' }],
  }
}

function ordersFor(pid) {
  if (pid === 'P-1001') return [
    med(pid, 'ORD-A1', 'active', 'Alphanorepine', '0.1 µg/kg/min', 'IV infusion (central)', 'continuous',
      { medication: { infusion: { value: 0.1, massUnit: 'mcg', timeBasis: 'min' } }, priority: 'STAT' }),
    med(pid, 'ORD-A2', 'active', 'Alphamycin', '1 g', 'IV', 'q8h'),
    med(pid, 'ORD-A3', 'active', 'Alphamycin', '2 g', 'IV', 'q12h'),          // same drug, a SEPARATE order
    med(pid, 'ORD-A4', 'active', 'Alphacetamol', '1 g', 'IV', 'q6h', { medication: { prn: true, prnIndication: 'temp ≥ 38.5 °C' } }),
    med(pid, 'ORD-A9', 'active', 'Alphasone', '100 mg', 'IV', 'once', { medication: { duration: 'once' } }),
    med(pid, 'ORD-A5', 'pending', 'Pendomycin', '500 mg', 'IV', 'q12h'),
    med(pid, 'ORD-A6', 'discontinued', 'Stoppazone', '2 g', 'IV', 'daily'),
    med(pid, 'ORD-A7', 'completed', 'Donosemide', '40 mg', 'IV', 'once'),
    { ...med(pid, 'ORD-A8', 'active', 'n/a', '', '', ''), category: 'Nursing', medication: undefined, summary: 'Nursoturn q2h', requiresImplementation: true },
    // defence in depth: a row naming ANOTHER patient must never be listed under A
    med('P-1002', 'ORD-LEAK', 'active', 'Leakomycin', '1 g', 'IV', 'q8h'),
  ]
  if (pid === 'P-1002') return [
    med(pid, 'ORD-B1', 'active', 'Betamycin', '4.5 g', 'IV', 'q6h'),
  ]
  if (pid === 'P-1004') return [
    med(pid, 'ORD-D1', 'pending', 'Deltapending', '1 g', 'IV', 'q8h'),
    med(pid, 'ORD-D2', 'discontinued', 'Deltastopped', '1 g', 'IV', 'q8h'),
  ]
  return null
}

function study(pid, id, modality, description, status, minAgo, extra = {}) {
  return {
    studyId: id, patientId: pid, bedId: '', patientName: pid, modality, description,
    orderedAt: wire(minAgo + 60), performedAt: status !== 'ordered' ? wire(minAgo + 30) : undefined,
    reportedAt: status === 'preliminary' || status === 'final' ? wire(minAgo) : undefined,
    status, flag: '', acknowledged: false, ...extra,
  }
}

function imagingFor(pid) {
  if (pid === 'P-1001') return [
    study(pid, 'IMG-A1', 'CXR', 'Alpha chest film', 'final', 90, { report: 'Alpha findings: right lower lobe consolidation.', impression: 'Alpha impression: pneumonia, RLL.', flag: 'critical', acknowledged: true, acknowledgedBy: 'Dr Synthetic', reportingRadiologist: 'Dr Radiology (paper)' }),
    study(pid, 'IMG-A2', 'CT', 'Alpha CT abdomen', 'preliminary', 30, { report: 'Alpha CT findings: no collection.', impression: 'Alpha CT impression: no abscess.', flag: 'normal' }),
    study(pid, 'IMG-A3', 'US', 'Alpha renal ultrasound', 'ordered', 10),
    study(pid, 'IMG-A4', 'Echo', 'Alpha echo', 'final', 1500, { report: 'Alpha echo findings.', impression: 'Alpha echo impression: EF 40%.', flag: 'abnormal', acknowledged: true, acknowledgedBy: 'Dr Synthetic' }),
    study(pid, 'IMG-A5', 'MRI', 'Alpha MRI brain (oldest)', 'final', 4000, { report: 'Alpha MRI findings.', impression: 'Alpha MRI impression: normal.', flag: 'normal', acknowledged: true }),
  ]
  if (pid === 'P-1002') return [study(pid, 'IMG-B1', 'CXR', 'Beta chest film', 'final', 120, { impression: 'Beta impression: clear.', report: 'Beta findings.', flag: 'normal' })]
  if (pid === 'P-1004') return []
  return null
}

const ROSTER_NAMES = { 'P-1001': 'Alpha Synthetic', 'P-1002': 'Beta Synthetic', 'P-1003': 'Gamma Synthetic', 'P-1004': 'Delta Synthetic' }
/** the open-census roster (RosterRecordDto[]) — no demo vitals: every
 *  bedside value on the chart must come from the observations read */
function roster() {
  const nullVitals = { hr: null, sys: null, dia: null, map: null, nibpSys: null, nibpDia: null, spo2: null, rr: null, temp: null, etco2: null, cvp: null }
  return Object.entries(ROSTER_NAMES).map(([pid, name], i) => ({
    patientId: pid, bedId: `B-0${i + 1}`, name, mrn: `MRN-${pid}`, age: 50 + i, sex: pid === 'P-1002' ? 'F' : 'M',
    diagnosis: `Synthetic diagnosis ${i + 1}`, los: i + 1, allergies: 'None known', attending: 'Dr Synthetic',
    codeStatus: 'Full Code', codeStatusCode: 'FULL', rhythm: '—', isolation: false, isolationTypes: [], flags: [],
    bedsideVitals: { hr: null, map: null, spo2: null, temp: null, uo: null },
    bedAlert: { severity: 'info', message: '', time: '' }, mapTrend: [], monitorVitals: nullVitals,
  }))
}

/** install the routes; `ctl` = { delays: {pid: {kind: ms}}, log: [], puts: [], putDelay, prod } */
async function install(context, ctl) {
  await context.route('**/runtime-config.js', r => r.fulfill({
    contentType: 'application/javascript',
    body: 'window.AURORA_RUNTIME_CONFIG = { apiBaseUrl: "" }',
  }))
  await context.route(u => u.pathname.startsWith("/api/"), async route => {
    const req = route.request()
    const url = new URL(req.url())
    const p = url.pathname
    const pid = url.searchParams.get('patientId')
    ctl.log.push(`${req.method()} ${p}${url.search}`)
    const json = (status, body, kind) => {
      const ms = (pid && ctl.delays[pid] && ctl.delays[pid][kind]) || 0
      const send = () => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {})
      return ms ? new Promise(res => setTimeout(() => { send().then(res) }, ms)) : send()
    }
    if (p === '/api/icu/hospital-identity') return json(200, { name: 'Synthetic Hospital', unitName: 'ICU', shortName: 'SH', address: '', headerText: '', footerText: '', hasLogo: false, serverTimeZone: 'Asia/Baghdad', serverUtcOffsetMinutes: 180 })
    if (p === '/api/icu/patients' && req.method() === 'GET') return json(200, roster())
    if (p === '/api/icu/observations' && req.method() === 'GET') {
      const o = observationsFor(pid)
      if (o === null) return json(500, { error: 'synthetic failure' }, 'observations')
      const enc = url.searchParams.get('encounterId')
      return json(200, enc ? o.filter(x => x.encounterId === enc) : o, 'observations')
    }
    if (p === '/api/icu/adt/encounters' && req.method() === 'GET') return json(200, encountersFor(pid, url.searchParams.get('status')), 'encounters')
    let m = /^\/api\/icu\/adt\/patients\/([^/]+)$/.exec(p)
    if (m) return json(200, identityFor(decodeURIComponent(m[1])))
    m = /^\/api\/icu\/adt\/encounters\/([^/]+)\/measurements$/.exec(p)
    if (m && req.method() === 'PUT') {
      const encId = decodeURIComponent(m[1])
      const body = JSON.parse(req.postData() || '{}')
      ctl.puts.push({ encId, body })
      const ownerPid = { 'ENC-A1': 'P-1001', 'ENC-B1': 'P-1002' }[encId]
      const e = encountersFor(ownerPid, 'open')[0]
      const updated = { ...e, ...body }
      const ms = ctl.putDelay || 0
      return new Promise(res => setTimeout(() => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) }).catch(() => {}).then(res), ms))
    }
    if (p === '/api/icu/orders' && pid) {
      const o = ordersFor(pid)
      return o === null ? json(500, { error: 'synthetic failure' }, 'orders') : json(200, o, 'orders')
    }
    if (p === '/api/icu/results/imaging' && pid) {
      const s = imagingFor(pid)
      return s === null ? json(500, { error: 'synthetic failure' }, 'imaging') : json(200, s, 'imaging')
    }
    /* production-mode runs (ctl.prod): the chart's other reads answer as
       real EMPTIES — a production bundle has no mock layer and latches its
       full-screen refusal on any unavailable clinical read, so only the
       patient-C failures above should ever trigger it */
    if (ctl.prod && req.method() === 'GET' && (
      p === '/api/icu/assignments' || p === '/api/icu/results/labs' || p === '/api/icu/timeline' || p === '/api/icu/results/inbox'
      || /^\/api\/icu\/patients\/[^/]+\/attachments$/.test(p))) return json(200, [])
    // everything else: unreachable → the dev bundle's own mock fallback
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic: not served"}' })
  })
}

module.exports = { install, wire, ROSTER_NAMES }
