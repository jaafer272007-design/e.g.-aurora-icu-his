// Session 3 browser checks (Chromium) on a local synthetic stack: the REAL server + PostgreSQL for
// the MAR, ADT, orders and roster, serving a staging bundle of this branch (+ the contract
// stand-ins, + a harness-only placement of PatientNurseCarePanel in the nurse's chart — Session 2
// owns the real placement). Session 1's nursing-round and I&O endpoints are not on this branch, so
// the harness answers exactly those requests itself from the frozen contract (§3.3/§3.4, §5,
// Amendment 1 §9.1–9.3): a CONTRACT SIMULATOR on Playwright routes. Everything else is the real API.
// Scenarios: W workspace (tasks removed), R nursing rounds, X MAR across routes/patients,
// P patient switching, I I&O, K keyboard, Q permissions, V themes + narrow layouts.
// Usage: node s3-browser.cjs <shotsDir> [ONLY e.g. R,I]   (env S3_BASE, default http://localhost:8093)
const { chromium, BASE, login } = require('./lib.cjs')
const fs = require('fs')
const [SHOTS, ONLY] = process.argv.slice(2)
const only = ONLY ? new Set(ONLY.split(',')) : null
const wants = k => !only || only.has(k)
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
fs.mkdirSync(SHOTS, { recursive: true })
let passes = 0, fails = 0
const check = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)))
async function waitFor(fn, ms, step = 50) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step) } return null }
const iso = ms => new Date(ms).toISOString()
const wireMin = ms => iso(ms).slice(0, 16).replace('T', ' ')
const wireSec = ms => iso(ms).slice(0, 19).replace('T', ' ')

/* ---------------- the real API, as the harness ---------------- */
const TOK = {}
async function api(user, method, path, body) {
  if (!TOK[user]) TOK[user] = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: 'Aurora2026!' }) })).json()).token
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK[user] }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const DOC = 'sara.rahman', NUR = 'maya.chen', PHA = 'samir.qassem'
const run = new Date().toISOString().slice(11, 19).replace(/:/g, '')
async function setup() {
  const free = (await api(DOC, 'GET', '/api/icu/adt/beds')).body.filter(b => !b.patientId).map(b => b.bedId)
  if (free.length < 2) throw new Error('need 2 free beds')
  const admit = async (fam, bed) => {
    const r = await api(DOC, 'POST', '/api/icu/adt/admissions', { nameFirst: 'Synthetic', nameSecond: 'Session', nameFamily: `${fam}${run}`, age: 61, sex: 'F', allergies: 'None known', bedId: bed, diagnosis: 'synthetic session-3 check', attending: 'Dr. Sara Rahman' })
    if (r.status !== 200) throw new Error('admit ' + JSON.stringify(r))
    return { pid: r.body.patient.patientId, eid: r.body.encounter.encounterId, bed, name: r.body.patient.name ?? `Synthetic ${fam}${run}` }
  }
  const A = await admit('Alpha', free[0]), B = await admit('Bravo', free[1])
  const O = { X1: await prn(A.pid, 'X1'), X2: await prn(A.pid, 'X2'), K1: await prn(A.pid, 'K1'), B1: await prn(B.pid, 'B1') }
  return { A, B, O }
}
/** a signed PRN order on a fresh synthetic formulary drug (PRN rows are open whenever shown) */
async function prn(pid, k) {
    const drugId = `s3-${k.toLowerCase()}-${run}`
    const d = await api(PHA, 'POST', '/api/icu/formulary', { drugId, name: `S3 ${k} ${run}`, brandNames: [], drugClass: `SynS3${k}${run}`, form: 'vial', strengths: ['1 mg'], doses: ['1 mg'], defaultDose: '1 mg', routes: ['IV'], frequencies: ['q6h'], prnCapable: true, allergyBlock: [], allergyWarn: [] })
    if (![200, 201].includes(d.status)) throw new Error('drug ' + JSON.stringify(d))
    const o = await api(DOC, 'POST', '/api/icu/orders', { drafts: [{ patientId: pid, category: 'Medication', priority: 'Routine', medication: { drugId, drug: `S3 ${k} ${run}`, dose: '1 mg', route: 'IV', frequency: 'q6h', duration: 'ongoing', prn: true, prnIndication: 'synthetic pain score ≥ 4' } }], sign: true })
    if (o.status !== 200) throw new Error('order ' + JSON.stringify(o))
    return o.body[0].orderId
}
const facts = async oid => ((await api(NUR, 'GET', `/api/icu/orders?patientId=${S.A.pid}`)).body.concat((await api(NUR, 'GET', `/api/icu/orders?patientId=${S.B.pid}`)).body)
  .find(o => o.orderId === oid)?.administrations ?? []).filter(a => a.status !== 'scheduled')

/* ---------------- the CONTRACT SIMULATOR: nursing rounds (§3.3/§3.4 + §9.1) ---------------- */
const sim = new Map()
let simN = 0
function simOrder(pt, kind, summary, completionsAgoMin) {
  const orderId = `ORD-SIM${run}-${++simN}`
  const signedMs = Date.now() - 5 * 60_000
  const s = { legacy: kind === 'legacy', intervalMinutes: typeof kind === 'number' ? kind : undefined, completions: [], signedMs,
    order: { orderId, patientId: pt.pid, encounterId: pt.eid, bedId: pt.bed, patientName: pt.name, category: 'Nursing', summary, priority: kind === 1 ? 'Urgent' : 'Routine', status: 'active',
      orderedBy: 'Dr. Sara Rahman', orderedTime: wireMin(signedMs), requiresImplementation: true,
      history: [{ time: wireMin(signedMs), actor: 'Dr. Sara Rahman', action: 'created' }, { time: wireMin(signedMs), actor: 'Dr. Sara Rahman', action: 'signed' }] } }
  if (completionsAgoMin !== undefined) {
    const due = Math.floor(signedMs / 60_000) * 60_000, done = Date.now() - completionsAgoMin * 60_000
    s.completions.push({ round: 1, roundId: `${iso(due)}~r1`, dueTime: iso(due), completedTime: iso(done), completedBy: 'RN Earlier Shift', attemptId: 'earliershift00000000000000000001' })
  }
  sim.set(orderId, s)
  return orderId
}
function derived(s) {
  const o = JSON.parse(JSON.stringify(s.order))
  if (s.legacy) return o
  const last = s.completions[s.completions.length - 1], n = s.completions.length + 1
  const dueMs = last ? Date.parse(last.completedTime) + (s.intervalMinutes ?? 0) * 60_000 : Math.floor(s.signedMs / 60_000) * 60_000
  const cur = o.status === 'active' && (s.intervalMinutes !== undefined || !last) ? { roundId: `${iso(dueMs)}~r${n}`, number: n, dueTime: iso(dueMs) } : undefined
  o.nursing = { ...(s.intervalMinutes !== undefined ? { intervalMinutes: s.intervalMinutes } : {}), completions: s.completions, ...(cur ? { currentRound: cur } : {}) }
  return o
}
function simImplement(orderId, req) {
  const s = sim.get(orderId)
  if (!s) return [404, { error: 'Order not found' }]
  if (req) { const p = s.completions.find(c => c.attemptId === req.attemptId); if (p) return p.roundId === req.roundId ? [200, derived(s)] : [409, { error: 'attempt id already used for another round' }] }
  if (s.legacy) { if (req) return [400, { error: 'a legacy order has no rounds' }]; if (s.order.status !== 'active') return [409, { error: 'Order is already completed' }]; s.order.status = 'completed'; return [200, derived(s)] }
  if (s.intervalMinutes !== undefined && !req) return [400, { error: 'a repeating nursing order needs roundId and attemptId' }]
  if (s.order.status !== 'active') return [409, { error: `Order is ${s.order.status}` }]
  const cur = derived(s).nursing.currentRound
  if (req && req.roundId !== cur.roundId) return [409, { error: 'not the current round' }]
  if (Date.now() < Date.parse(cur.dueTime)) return [409, { error: `not due yet — opens at ${cur.dueTime}` }]
  s.completions.push({ round: cur.number, roundId: cur.roundId, dueTime: cur.dueTime, completedTime: iso(Math.ceil(Date.now())), completedBy: 'RN Maya Chen', ...(req ? { attemptId: req.attemptId } : {}) })
  if (s.intervalMinutes === undefined) s.order.status = 'completed'
  return [200, derived(s)]
}
const nPlans = [], nPosts = []
let nRelease = null
let ordersReadDelay = 0   // ms added to the per-patient order read (to observe the unconfirmed state)

/* ---------------- the CONTRACT SIMULATOR: I&O snapshots (§5 + §9.3) ---------------- */
const IO = ['io_current_intake_ml', 'io_current_output_ml']
const ioStore = [], ioPosts = [], ioGets = [], ioPlans = []
let obsN = 0

async function installRoutes(ctx) {
  await ctx.route(u => u.pathname === '/api/icu/orders', async route => {
    const req = route.request()
    if (req.method() !== 'GET') return route.continue()
    const u = new URL(req.url())
    const resp = await route.fetch()
    let list = await resp.json()
    if (u.searchParams.get('patientId') && ordersReadDelay) await sleep(ordersReadDelay)
    if (u.searchParams.get('implement') === 'true') list = list.concat([...sim.values()].map(derived).filter(o => o.status === 'active'))
    else if (u.searchParams.get('patientId')) list = list.concat([...sim.values()].map(derived).filter(o => o.patientId === u.searchParams.get('patientId')))
    return route.fulfill({ response: resp, json: list })
  })
  await ctx.route(u => /^\/api\/icu\/orders\/ORD-SIM[^/]+\/implement$/.test(u.pathname), async route => {
    const req = route.request()
    const orderId = decodeURIComponent(new URL(req.url()).pathname.split('/')[4])
    const body = req.postData() ? JSON.parse(req.postData()) : undefined
    nPosts.push({ orderId, body, raw: req.postData() ?? null, t: Date.now() })
    const plan = nPlans.shift() ?? 'commit'
    if (plan === 'abort') return route.abort('failed')
    if (plan === '401') return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
    if (plan === 'hold') await new Promise(r => { nRelease = r })
    const [status, json] = simImplement(orderId, body)
    try {
      if (plan === 'commit-abort') return await route.abort('failed')
      return await route.fulfill({ status, json })
    } catch { /* the page already gave up on this request (its 8 s timeout): the commit stands, the answer goes nowhere */ }
  })
  await ctx.route(u => u.pathname === '/api/icu/observations', async route => {
    const req = route.request()
    const u = new URL(req.url())
    if (req.method() === 'GET') {
      const tc = u.searchParams.get('typeCode')
      if (!tc) return route.continue()
      ioGets.push(u.search)
      if (!IO.includes(tc)) return route.fulfill({ status: 400, json: { error: 'unknown typeCode (simulator)' } })
      const delay = ioPlans[0] === 'slow-read' ? (ioPlans.shift(), 1500) : 0
      if (delay) await sleep(delay)
      return route.fulfill({ json: ioStore.filter(o => o.patientId === u.searchParams.get('patientId') && o.encounterId === u.searchParams.get('encounterId') && o.typeCode === tc) })
    }
    if (req.method() !== 'POST') return route.continue()
    const body = JSON.parse(req.postData())
    if (!body.entries.some(e => IO.includes(e.typeCode))) return route.continue()
    ioPosts.push(body)
    const plan = ioPlans[0] === 'slow-read' ? 'commit' : ioPlans.shift() ?? 'commit'
    if (plan === 'abort') return route.abort('failed')
    if (plan === '400') return route.fulfill({ status: 400, json: { error: 'synthetic refusal: the value is outside 0–20000 mL' } })
    if (!body.expectedEncounterId) return route.fulfill({ status: 400, json: { error: 'expectedEncounterId is required for I&O snapshots' } })
    const open = (await api(DOC, 'GET', `/api/icu/adt/encounters?patientId=${body.patientId}&status=open`)).body.find(e => e.status === 'open')
    if (!open || open.encounterId !== body.expectedEncounterId)
      return route.fulfill({ status: 409, json: { error: `the patient's current admission is not ${body.expectedEncounterId} — nothing was recorded` } })
    const now = Date.now()
    const created = body.entries.map(e => ({ observationId: `OBS-S3-${++obsN}`, patientId: body.patientId, encounterId: open.encounterId, typeCode: e.typeCode, value: String(e.value), unit: 'mL',
      clinicalTime: wireMin(now), source: 'manual', recordedBy: 'RN Maya Chen', enteredAt: wireSec(now), amendments: [] }))
    ioStore.push(...created)
    if (plan === 'commit-abort') return route.abort('failed')
    return route.fulfill({ json: created })
  })
}

/* ---------------- page helpers ---------------- */
async function openApp(browser, opts = {}, user = NUR) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: 'dark', timezoneId: 'UTC', ...opts })
  await ctx.addInitScript(() => {
    window.__toasts = []
    new MutationObserver(() => {
      const t = document.querySelector('.toast.show b')
      const s = t && `${t.textContent}|${t.nextElementSibling?.textContent ?? ''}`
      if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s)
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
  })
  await installRoutes(ctx)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  await login(page, user)
  return { ctx, page, errs }
}
/* SPA navigation — the provider and its controllers stay mounted (no reload) */
const nav = async (page, path) => { await page.evaluate(p => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }, path); await page.waitForTimeout(150) }
const toasts = (page, from = 0) => page.evaluate(f => window.__toasts.slice(f), from)
const panel = pid => `.ncpanel[data-patient="${pid}"]`
const marActs = (scope, pid, oid) => `${scope} .mardaycard[id^="mar-${pid}-${oid}-"] .maracts`
async function marState(page, scope, pid, oid) {
  return page.evaluate(([sc, p, o]) => {
    const acts = document.querySelector(`${sc} .mardaycard[id^="mar-${p}-${o}-"] .maracts`)
    if (!acts) return null
    const row = acts.closest('.marrow')
    return { disabled: [...acts.querySelectorAll('button')].map(b => b.disabled), lock: row.querySelector('.marlockline')?.textContent ?? null, retry: !!row.querySelector('.marretry') }
  }, [scope, pid, oid])
}
const ordRow = oid => `.ordrow[data-order="${oid}"]`
async function ordState(page, oid) {
  return page.evaluate(sel => {
    const r = document.querySelector(sel)
    if (!r) return null
    return { done: r.querySelector('.ordbtn')?.disabled === false, state: r.querySelector('.ordstate')?.textContent, round: r.querySelector('.ordround')?.textContent ?? null,
      line: r.querySelector('.ordline')?.textContent ?? null, retry: !!r.querySelector('.ordretry'), last: r.querySelector('.ordlast')?.textContent ?? null }
  }, ordRow(oid))
}
async function shot(page, sel, path) {
  const el = await page.$(sel)
  if (!el) { console.log(`  (no ${sel} for ${path})`); return }
  await el.scrollIntoViewIfNeeded()
  await el.screenshot({ path })
}
const marPostsFor = (posts, oid) => posts.filter(p => p.url.includes(`/mar/${oid}/administrations/`))

let S
;(async () => {
  S = await setup()
  const { A, B, O } = S
  console.log(`setup: A ${A.pid} (${A.eid}, ${A.bed}) · B ${B.pid} (${B.eid}, ${B.bed}) · orders ${JSON.stringify(O)}`)
  const browser = await chromium.launch({ executablePath: EXE })
  const { ctx, page, errs } = await openApp(browser)
  const marPosts = []
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/administrations/')) marPosts.push({ url: r.url(), body: r.postData(), t: Date.now() }) })

  if (wants('W')) {
    console.log('\n[W] Nurse Workspace: Nursing Tasks and Tasks Open removed; Orders to Implement + handoff kept')
    await page.goto(BASE + '/nurse'); await page.waitForLoadState('networkidle')
    await page.waitForSelector('.ncio')
    const w = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('.card .chead .t')].map(t => t.textContent),
      kpis: [...document.querySelectorAll('header *')].map(e => e.childElementCount === 0 ? e.textContent.trim() : '').filter(Boolean),
      tasks: document.body.innerText.includes('Nursing Tasks'), tasksOpen: /Tasks Open/i.test(document.body.innerText),
      tsk: document.querySelectorAll('.tsklist,.tskrow').length, demoIo: document.querySelectorAll('.iorow,.iokind,#ioCat').length,
    }))
    check(!w.tasks && !w.tasksOpen && w.tsk === 0, `no "Nursing Tasks" card, no "Tasks Open" KPI, no task rows (cards: ${w.titles.join(' · ')})`)
    check(w.titles.includes('Orders to Implement') && w.titles.some(t => t.startsWith('Shift Handoff')) && w.titles.includes('Medication Administration Record') && w.titles.includes('Intake & Output'), 'Orders to Implement, Shift Handoff, MAR and I&O present')
    check(w.demoIo === 0, 'the demo worksheet (category select, intake/output toggle, shift-total rows) is gone')
    await page.screenshot({ path: `${SHOTS}/W-workspace-dark-1440.png` })
  }

  if (wants('R')) {
    console.log('\n[R] Orders to Implement — nursing rounds (contract simulator)')
    const once = simOrder(A, 'once', 'S3: remove peripheral cannula (one-time)')
    const rep1 = simOrder(A, 1, 'S3: neuro obs every 1 min (synthetic interval)')
    const rep2 = simOrder(A, 120, 'S3: reposition every 2 h', 10)
    const rep3 = simOrder(A, 60, 'S3: pressure-area check every 1 h')
    const legacy = simOrder(A, 'legacy', 'S3: legacy nursing order (no rounds)')
    await page.goto(BASE + '/nurse'); await page.waitForLoadState('networkidle')
    await page.waitForSelector(ordRow(legacy))
    let s = await ordState(page, rep2)
    check(s && !s.done && s.state === 'UPCOMING' && /Next due/.test(s.round) && /Opens/.test(s.line) && /Last done/.test(s.last), `future round visible, Done locked: "${s?.round}" · "${s?.line}"`)
    const aside = await page.$eval('.ordcard .chead .x', e => e.textContent)
    check(/\d+ due now · \d+ upcoming/.test(aside), `counts split due vs upcoming: "${aside}"`)
    s = await ordState(page, once)
    check(s.done && s.state === 'DUE', 'one-time order: round 1 open on signing')
    await page.locator(`${ordRow(once)} .ordbtn`).dblclick()
    await waitFor(async () => !(await ordState(page, once)), 8000)
    const op = nPosts.filter(p => p.orderId === once)
    check(op.length === 1 && op[0].body?.roundId && /^[0-9a-f]{32}$/.test(op[0].body.attemptId) && sim.get(once).completions.length === 1,
      `double click -> 1 request {roundId, attemptId}; completed once; left the list`)
    s = await ordState(page, legacy)
    await page.click(`${ordRow(legacy)} .ordbtn`)
    await waitFor(async () => !(await ordState(page, legacy)), 8000)
    const lp = nPosts.filter(p => p.orderId === legacy)
    check(lp.length === 1 && lp[0].raw === null && sim.get(legacy).order.status === 'completed', 'legacy order: the existing empty request (no body), completed')
    console.log('  … repeating every 1 min: Done, then the exact unlock (completion time + interval)')
    await page.click(`${ordRow(rep1)} .ordbtn`)
    await waitFor(async () => /Next due/.test((await ordState(page, rep1))?.round ?? '') && !(await ordState(page, rep1)).line?.includes('Checking'), 8000)
    const due = Date.parse(derived(sim.get(rep1)).nursing.currentRound.dueTime)
    s = await ordState(page, rep1)
    check(!s.done && /Round 2/.test(s.round), `round 2 locked: "${s.round}" (due ${iso(due)})`)
    await shot(page, '.ordcard', `${SHOTS}/R-orders-to-implement-dark.png`)
    const sample = await page.evaluate(({ sel, due }) => new Promise(res => {
      const before = []
      const tick = () => {
        const b = document.querySelector(sel), now = Date.now()
        if (b && !b.disabled) return res({ enabledAt: now, early: now < due, before })
        if (now > due - 300 && now < due) before.push(b?.disabled)
        if (now > due + 10_000) return res(null)
        setTimeout(tick, 2)
      }
      tick()
    }), { sel: `${ordRow(rep1)} .ordbtn`, due })
    check(sample && !sample.early && sample.before.every(Boolean) && sample.enabledAt - due < 250,
      `Done stayed disabled through the last 300 ms and opened ${sample ? sample.enabledAt - due : '?'} ms after the due instant (no reload)`)
    await page.click(`${ordRow(rep1)} .ordbtn`)
    await waitFor(async () => /Round 3/.test((await ordState(page, rep1))?.round ?? ''), 8000)
    check(sim.get(rep1).completions.length === 2 && nPosts.filter(p => p.orderId === rep1).length === 2, 'round 2 completed; round 3 shown — the order is never suppressed')
    console.log('  … no answer, then a 401 retry, then the original commits (Amendment 1 §9.2)')
    const t0 = (await toasts(page)).length
    nPlans.push('hold')
    await page.click(`${ordRow(rep3)} .ordbtn`)
    await waitFor(() => nRelease, 5000)
    await page.waitForTimeout(400)
    s = await ordState(page, rep3)
    check(!s.done && /Saving/.test(s.line), `in flight: "${s.line}"`)
    // the page loses its answer: abort this exchange's response by not answering; release later. Simulate by routing the
    // next request (the retry) to 401 while the original is still held server-side.
    await nav(page, `/patients/${A.pid}`)   // navigate away and back while it is saving
    await nav(page, '/nurse')
    await page.waitForSelector(ordRow(rep3))
    s = await ordState(page, rep3)
    check(!s.done && /Saving/.test(s.line), `after /nurse -> chart -> /nurse: still saving, Done locked ("${s.line}")`)
    const held = nRelease; nRelease = null
    held()   // the original commits now and is answered
    await waitFor(async () => /Round 2/.test((await ordState(page, rep3))?.round ?? ''), 8000)
    check(sim.get(rep3).completions.length === 1 && (await toasts(page, t0)).some(t => t.startsWith('Order implemented')), 'the answer completed into the shared controller: round 1 done, toast shown')
    const rep4 = simOrder(A, 60, 'S3: oral care every 1 h')
    await page.waitForSelector(ordRow(rep4), { timeout: 25_000 })
    nPlans.push('commit-abort'); ordersReadDelay = 2500
    await page.click(`${ordRow(rep4)} .ordbtn`)
    await waitFor(async () => (await ordState(page, rep4))?.retry, 8000)
    s = await ordState(page, rep4)
    check(!s.done && s.retry && /Not confirmed/.test(s.line), `no answer (it did commit): unconfirmed with Retry saving — "${s.line.slice(0, 80)}…"`)
    // settled only by the per-patient read (which sees the completion)
    await waitFor(async () => !(await ordState(page, rep4))?.retry, 12_000)
    ordersReadDelay = 0
    const p4 = nPosts.filter(p => p.orderId === rep4)
    check(sim.get(rep4).completions.length === 1 && sim.get(rep4).completions[0].attemptId === p4[0].body.attemptId && (await toasts(page, t0)).some(t => t.startsWith('Saved — confirmed')),
      'settled CONFIRMED from the authoritative per-patient read; 1 completion with the attempt id')
    const rep5 = simOrder(A, 60, 'S3: drain check every 1 h')
    await page.waitForSelector(ordRow(rep5), { timeout: 25_000 })
    nPlans.push('hold')
    await page.click(`${ordRow(rep5)} .ordbtn`)
    await waitFor(() => nRelease, 5000)
    const orig = nRelease; nRelease = null
    // abandon the page's wait: the page times out after 8 s (no answer) while the server still holds the original
    await waitFor(async () => (await ordState(page, rep5))?.retry, 15_000)
    nPlans.push('401')
    await page.click(`${ordRow(rep5)} .ordretry`)
    await page.waitForTimeout(800)
    s = await ordState(page, rep5)
    const p5 = nPosts.filter(p => p.orderId === rep5)
    check(p5.length === 2 && p5[1].raw === p5[0].raw, 'the retry re-sent the identical { roundId, attemptId }')
    check(!s.done && s.retry && /sign in again/.test(s.line), `refused retry (401): still unconfirmed — "${s.line.slice(0, 90)}…"`)
    orig()   // the original commits now (its answer goes nowhere — the page already gave up)
    await waitFor(async () => !(await ordState(page, rep5))?.retry, 12_000)
    check(sim.get(rep5).completions.length === 1 && sim.get(rep5).completions[0].attemptId === p5[0].body.attemptId, 'the original committed -> confirmed; exactly one completion')
  }

  if (wants('X')) {
    console.log('\n[X] MAR across routes and patients (real server): one controller, locks and attempts survive navigation')
    await page.goto(BASE + `/patients/${A.pid}`); await page.waitForLoadState('networkidle')
    await page.waitForSelector(marActs(panel(A.pid), A.pid, O.X1))
    const t0 = (await toasts(page)).length
    const cap = { req: null }
    await page.route(`**/api/icu/mar/${O.X1}/administrations/**`, async route => {
      const r = route.request(); cap.req = { url: r.url(), auth: r.headers()['authorization'], body: r.postData() }; await route.abort('failed')
    }, { times: 1 })
    await page.click(`${marActs(panel(A.pid), A.pid, O.X1)} .mab.given`)
    await waitFor(async () => (await marState(page, panel(A.pid), A.pid, O.X1))?.retry, 8000)
    let s = await marState(page, panel(A.pid), A.pid, O.X1)
    check(s.retry && s.disabled.every(Boolean), `chart A: no answer -> "Not confirmed" + Retry saving, controls locked`)
    await shot(page, panel(A.pid), `${SHOTS}/X-chart-panel-unconfirmed-dark.png`)
    await nav(page, '/nurse')
    await page.waitForSelector(marActs('.ncmar', A.pid, O.X1))
    s = await marState(page, '.ncmar', A.pid, O.X1)
    check(s.retry && s.disabled.every(Boolean), 'Nurse Workspace (SPA navigation): the same order shows the same unconfirmed lock')
    await page.evaluate(sel => document.querySelectorAll(`${sel} button`).forEach(b => b.click()), marActs('.ncmar', A.pid, O.X1))
    await page.waitForTimeout(300)
    check(marPostsFor(marPosts, O.X1).length === 1, 'scripted clicks on the locked row in the workspace: no second request')
    await nav(page, `/patients/${B.pid}`)
    await page.waitForSelector(marActs(panel(B.pid), B.pid, O.B1))
    check(await page.$$eval(`${panel(B.pid)} .mardaycard[id^="mar-${A.pid}-"]`, x => x.length) === 0, "chart B shows only B's medication cards")
    const late = await fetch(cap.req.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: cap.req.auth }, body: cap.req.body })
    console.log(`  the original request reaches the server now (from chart B) -> HTTP ${late.status}`)
    await waitFor(async () => (await toasts(page, t0)).some(t => t.startsWith('Saved — confirmed')), 12_000)
    const f = await facts(O.X1)
    check((await toasts(page, t0)).some(t => t.startsWith('Saved — confirmed')) && f.length === 1 && f[0].attemptId === JSON.parse(cap.req.body).attemptId,
      'settled CONFIRMED while chart B was showing (the read covered A); exactly 1 fact with the attempt id')
    await nav(page, `/patients/${A.pid}`)
    await page.waitForSelector(marActs(panel(A.pid), A.pid, O.X1))
    s = await marState(page, panel(A.pid), A.pid, O.X1)
    check(!s.retry && s.disabled.every(d => !d), 'back on chart A: the PRN row is open again (no stale lock)')
    console.log('  … a SAVING request when the nurse leaves the chart')
    let release
    await page.route(`**/api/icu/mar/${O.X2}/administrations/**`, async route => { await new Promise(r => { release = r }); await route.continue() }, { times: 1 })
    const t1 = (await toasts(page)).length
    await page.click(`${marActs(panel(A.pid), A.pid, O.X2)} .mab.given`)
    await waitFor(() => release, 5000)
    s = await marState(page, panel(A.pid), A.pid, O.X2)
    check(/Saving/.test(s.lock ?? ''), `saving on chart A: "${s.lock}"`)
    await nav(page, '/nurse')
    await page.waitForSelector(marActs('.ncmar', A.pid, O.X2))
    s = await marState(page, '.ncmar', A.pid, O.X2)
    check(/Saving/.test(s.lock ?? '') && s.disabled.every(Boolean), 'workspace: the same save shows "Saving…", controls locked')
    release()
    await waitFor(async () => (await toasts(page, t1)).some(t => t.startsWith('Documented')), 8000)
    await waitFor(async () => !(await marState(page, '.ncmar', A.pid, O.X2))?.lock, 12_000)
    check((await facts(O.X2)).length === 1 && marPostsFor(marPosts, O.X2).length === 1, 'answered into the controller on the workspace; 1 fact, 1 request; the row reopened after the read')
    console.log('  … reload during an unconfirmed save (same tab): restored, retried with the same id')
    await page.goto(BASE + `/patients/${A.pid}`); await page.waitForLoadState('networkidle')
    await page.waitForSelector(marActs(panel(A.pid), A.pid, O.X2))
    await page.route(`**/api/icu/mar/${O.X2}/administrations/**`, route => route.abort('failed'), { times: 1 })
    await page.click(`${marActs(panel(A.pid), A.pid, O.X2)} .mab.given`)
    await waitFor(async () => (await marState(page, panel(A.pid), A.pid, O.X2))?.retry, 8000)
    const lostId = JSON.parse(marPostsFor(marPosts, O.X2).slice(-1)[0].body).attemptId
    await page.reload(); await page.waitForLoadState('networkidle')
    await page.waitForSelector(marActs(panel(A.pid), A.pid, O.X2))
    s = await marState(page, panel(A.pid), A.pid, O.X2)
    check(s.retry, 'after a reload: restored as unconfirmed')
    await page.click(`${panel(A.pid)} .mardaycard[id^="mar-${A.pid}-${O.X2}-"] .marretry`)
    await waitFor(async () => !(await marState(page, panel(A.pid), A.pid, O.X2))?.retry, 12_000)
    const f2 = await facts(O.X2)
    check(f2.length === 2 && f2[1].attemptId === lostId, 'Retry saving sent the stored attempt id: the 2nd (deliberate) dose recorded once')
  }

  if (wants('P')) {
    console.log('\n[P] patient switch: the chart panel clears at once and never shows the previous patient')
    await page.goto(BASE + `/patients/${A.pid}`); await page.waitForLoadState('networkidle')
    await page.waitForSelector(marActs(panel(A.pid), A.pid, O.X1))
    await page.route('**/api/icu/mar', async route => { await sleep(1500); await route.continue() }, { times: 2 })
    ioPlans.push('slow-read')
    await nav(page, `/patients/${B.pid}`)
    const samples = []
    const t0 = Date.now()
    while (Date.now() - t0 < 4000) {
      samples.push(await page.evaluate(([a, b]) => ({
        panelB: !!document.querySelector(`.ncpanel[data-patient="${b}"]`),
        aRows: document.querySelectorAll(`.ncpanel .mardaycard[id^="mar-${a}-"]`).length,
        bRows: document.querySelectorAll(`.ncpanel .mardaycard[id^="mar-${b}-"]`).length,
        panelA: !!document.querySelector(`.ncpanel[data-patient="${a}"]`),
      }), [A.pid, B.pid]))
      await sleep(40)
    }
    check(samples.every(x => x.aRows === 0 && !x.panelA) && samples.some(x => x.bRows > 0), `${samples.length} samples over 4 s: never a row of A on B's chart; B's rows arrived (first at sample ${samples.findIndex(x => x.bRows > 0)})`)
  }

  if (wants('I')) {
    console.log('\n[I] I&O — latest manually entered values (contract simulator on the real encounters)')
    await page.goto(BASE + `/patients/${A.pid}`); await page.waitForLoadState('networkidle')
    const io = `${panel(A.pid)} .ncio`
    await page.waitForSelector(`${io} .iotiles`)
    const tiles = () => page.$$eval(`${io} .iotile`, ts => ts.map(t => t.innerText.replace(/\s+/g, ' ').trim()))
    let t = await tiles()
    check(t[0].includes('Not recorded') && t[1].includes('Not recorded') && t[2].includes('needs both'), `new admission: ${t.join(' | ')}`)
    const inId = await page.$eval(`${io} .ioform input`, e => e.id)
    const outId = (await page.$$eval(`${io} .ioform input`, es => es.map(e => e.id)))[1]
    const save = async () => { const n0 = ioPosts.length; await page.click(`${io} .iosave`); await waitFor(() => ioPosts.length > n0, 5000); await page.waitForTimeout(600) }
    await page.fill(`#${inId}`, '500'); await save()
    t = await tiles()
    check(t[0].includes('500 mL') && t[1].includes('Not recorded') && t[2].includes('needs both'), `500 intake: ${t.join(' | ')}`)
    await page.fill(`#${outId}`, '0'); await save()
    t = await tiles()
    check(t[1].includes('0 mL') && /\+500 mL/.test(t[2]), `zero output is a value; balance appears: ${t.join(' | ')}`)
    await page.fill(`#${inId}`, '200')
    const n0 = ioPosts.length
    await page.locator(`${io} .iosave`).dblclick()
    await page.waitForTimeout(900)
    t = await tiles()
    const hist = await page.$$eval(`${io} .iohrow`, rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()))
    check(ioPosts.length - n0 === 1, `double click Save -> ${ioPosts.length - n0} request`)
    check(t[0].includes('200 mL') && /\+200 mL/.test(t[2]) && hist.length === 3 && hist[0].includes('200 mL') && hist.some(h => h.includes('500 mL')),
      `500 then 200 shows 200; history keeps both (${hist.length} entries, newest first: "${hist[0]}")`)
    check(ioPosts.every(b => b.entries.every(e => IO.includes(e.typeCode)) && b.expectedEncounterId === A.eid) && ioGets.every(q => /typeCode=io_current_(intake|output)_ml/.test(q)),
      'every I&O write carries only io_current_* codes and the loaded admission; every I&O read asks only for those codes (no interval fluid codes)')
    await shot(page, io, `${SHOTS}/I-io-panel-dark.png`)
    console.log('  … refused and unanswered saves')
    ioPlans.push('400')
    await page.fill(`#${inId}`, '300'); await save()
    let out = await page.$eval(`${io} .iooutcome`, e => e.textContent).catch(() => '')
    check(/Not saved/.test(out) && (await page.inputValue(`#${inId}`)) === '300' && (await tiles())[0].includes('200 mL'), `refused: values kept in the form, current value unchanged ("${out}")`)
    ioPlans.push('abort')
    await save()
    out = await page.$eval(`${io} .iooutcome`, e => e.textContent).catch(() => '')
    check(/Not confirmed/.test(out) && /check the history/.test(out) && (await page.inputValue(`#${inId}`)) === '300', `no answer: "not confirmed — check the history"; values kept; nothing resent (${ioPosts.length} posts)`)
    console.log('  … amendment and midnight')
    const latestIn = ioStore.filter(o => o.patientId === A.pid && o.typeCode === IO[0]).pop()
    latestIn.amendments.push({ previousValue: '200', newValue: '250', amendedBy: 'RN Charge Nurse', amendedAt: wireMin(Date.now()), reason: 'synthetic: transcription corrected', amenderRole: 'Charge Nurse' })
    const firstOut = ioStore.find(o => o.patientId === A.pid && o.typeCode === IO[1])
    firstOut.clinicalTime = wireMin(Date.now() - 26 * 3600_000); firstOut.enteredAt = wireSec(Date.now() - 26 * 3600_000)
    await page.reload(); await page.waitForLoadState('networkidle'); await page.waitForSelector(`${io} .iotiles`)
    t = await tiles()
    const amendLine = await page.$eval(`${io} .iohamend`, e => e.textContent).catch(() => '')
    check(t[0].includes('250 mL') && t[0].includes('amended') && /amended 200 → 250 mL by RN Charge Nurse/.test(amendLine), `the amended value is current (${t[0]}); history shows "${amendLine.slice(0, 60)}…"`)
    check(t[1].includes('0 mL') && /D-1|D-2/.test(t[1]), `an output entered yesterday is still the current output (no midnight reset): ${t[1]}`)
    console.log('  … the Nurse Workspace shows the same panel for the chosen patient')
    await nav(page, '/nurse')
    await page.waitForSelector('#nwioPatient')
    await page.selectOption('#nwioPatient', A.pid)
    await waitFor(async () => ((await page.$$eval('.nw .ncio .iotile', ts => ts.map(x => x.innerText))).join(' ')).includes('250 mL'), 8000)
    const wsTiles = await page.$$eval('.nw .ncio .iotile', ts => ts.map(x => x.innerText.replace(/\s+/g, ' ')))
    check(wsTiles[0].includes('250 mL') && /\+250 mL/.test(wsTiles[2]), `workspace (A selected): ${wsTiles.join(' | ')}`)
    await page.selectOption('#nwioPatient', B.pid)
    await waitFor(async () => ((await page.$$eval('.nw .ncio .iotile', ts => ts.map(x => x.innerText))).join(' ')).includes('Not recorded'), 8000)
    check((await page.$$eval('.nw .ncio .iotile', ts => ts.map(x => x.innerText))).every(x => !x.includes('250 mL')), 'switching to B: none of A\'s values shown')
    await shot(page, '.nw .ncio', `${SHOTS}/I-workspace-io-dark.png`)
    console.log('  … discharge + readmission while values are typed: the stale save is 409, nothing lands in either admission')
    await nav(page, `/patients/${A.pid}`)
    await page.waitForSelector(`${io} .iotiles`)
    await page.fill(`#${inId}`, '777')
    const before = ioStore.length
    const dis = await api(DOC, 'POST', `/api/icu/adt/encounters/${A.eid}/discharge`)
    const readmit = await api(DOC, 'POST', '/api/icu/adt/admissions', { patientId: A.pid, bedId: A.bed, diagnosis: 'synthetic readmission', attending: 'Dr. Sara Rahman' })
    console.log(`  discharge ${A.eid} -> ${dis.status}; readmission -> ${readmit.status} ${readmit.body?.encounter?.encounterId ?? JSON.stringify(readmit.body)}`)
    await save()
    out = await page.$eval(`${io} .iooutcome`, e => e.textContent).catch(() => '')
    const newEid = readmit.body?.encounter?.encounterId
    t = await tiles()
    check(ioStore.length === before && /admission has changed/.test(out) && (await page.inputValue(`#${inId}`)) === '', `409, nothing written; typed values cleared: "${out.slice(0, 110)}…"`)
    check(t[0].includes('Not recorded') && t[1].includes('Not recorded') && t[2].includes('needs both'), `the new admission ${newEid} starts blank: ${t.join(' | ')}`)
    check(ioStore.filter(o => o.encounterId === A.eid).length === 3, `the previous admission's snapshots are kept under ${A.eid} (${ioStore.filter(o => o.encounterId === A.eid).length})`)
    S.A.eid = newEid
  }

  if (wants('K')) {
    console.log('\n[K] keyboard operation')
    O.K1 = await prn(A.pid, 'K2')   // [I] readmitted A: discharge discontinued the earlier orders
    await page.goto(BASE + `/patients/${A.pid}`); await page.waitForLoadState('networkidle')
    await page.waitForSelector(marActs(panel(A.pid), A.pid, O.K1))
    await page.focus(`${marActs(panel(A.pid), A.pid, O.K1)} .mab.held`)
    await page.keyboard.press('Enter')
    await page.waitForSelector('.mardialog')
    const focused = await page.evaluate(() => document.activeElement?.id)
    await page.keyboard.type('synthetic: patient asleep')
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
    const onConfirm = await page.evaluate(() => document.activeElement?.textContent)
    await page.keyboard.press('Enter')
    await waitFor(async () => (await facts(O.K1)).length === 1, 8000)
    check(focused === 'marReason' && /Hold dose/.test(onConfirm ?? '') && (await facts(O.K1))[0]?.status === 'held', `Enter opens the reason dialog (focus ${focused}); Tab reaches "${onConfirm}"; Enter documents it`)
    const io = `${panel(A.pid)} .ncio`
    await page.waitForSelector(`${io} .ioform input`)
    const n0 = ioPosts.length
    await page.focus(`${io} .ioform input`)
    await page.keyboard.type('150'); await page.keyboard.press('Tab'); await page.keyboard.type('90'); await page.keyboard.press('Enter')
    await waitFor(() => ioPosts.length > n0, 5000)
    check(ioPosts.length - n0 === 1 && ioPosts[ioPosts.length - 1].entries.length === 2, 'I&O: type intake, Tab, type output, Enter -> one save with both values')
    const r = simOrder(A, 30, 'S3: keyboard check every 30 min')
    await page.goto(BASE + '/nurse'); await page.waitForLoadState('networkidle')
    await page.waitForSelector(ordRow(r))
    await page.focus(`${ordRow(r)} .ordbtn`)
    await page.keyboard.press('Space')
    await waitFor(() => sim.get(r).completions.length === 1, 6000)
    await page.waitForSelector(`${ordRow(r)} .ordhist summary`)
    await page.focus(`${ordRow(r)} .ordhist summary`)
    await page.keyboard.press('Enter')
    const open = await page.$eval(`${ordRow(r)} .ordhist`, d => d.open).catch(() => false)
    check(sim.get(r).completions.length === 1 && open, 'Orders to Implement: Space on Done completes the round; Enter opens its completion history')
  }

  if (wants('Q')) {
    console.log('\n[Q] permissions: the same panel for a doctor (no meds.administer) and a pharmacist (no observations.record)')
    for (const [user, role, ioForm] of [[DOC, 'doctor', true], [PHA, 'pharmacist', false]]) {
      const c = await openApp(browser, {}, user)
      await c.page.goto(BASE + `/patients/${A.pid}?s3panel=1`); await c.page.waitForLoadState('networkidle')
      await c.page.waitForSelector(`${panel(A.pid)} .ncio .iotiles`)
      await c.page.waitForSelector(`${panel(A.pid)} .mardaycard`)
      const q = await c.page.evaluate(sel => ({
        rows: document.querySelectorAll(`${sel} .mardaycard`).length, acts: document.querySelectorAll(`${sel} .maracts, ${sel} .mab`).length,
        aside: document.querySelector(`${sel} .ncmar .chead .x`)?.textContent ?? '', form: !!document.querySelector(`${sel} .ioform`),
        viewOnly: document.querySelector(`${sel} .ncio`)?.innerText.includes('View only') ?? false,
      }), panel(A.pid))
      check(q.rows > 0 && q.acts === 0 && /view only/.test(q.aside), `${role}: MAR cards shown read-only (${q.rows} cards, ${q.acts} controls, "${q.aside.slice(0, 30)}")`)
      check(q.form === ioForm && q.viewOnly === !ioForm, `${role}: I&O entry ${ioForm ? 'available (observations.record)' : 'hidden — "View only"'}`)
      if (role === 'doctor') await shot(c.page, panel(A.pid), `${SHOTS}/Q-chart-panel-doctor-readonly-dark.png`)
      await c.ctx.close()
    }
  }

  if (wants('V')) {
    console.log('\n[V] light/dark and narrow layouts')
    for (const theme of ['dark', 'light']) for (const [w, h] of [[1440, 1100], [390, 900]]) {
      const c = await openApp(browser, { colorScheme: theme, viewport: { width: w, height: h } })
      await c.page.goto(BASE + `/patients/${A.pid}`); await c.page.waitForLoadState('networkidle')
      await c.page.waitForSelector(`${panel(A.pid)} .ncio .iotiles`)
      /* the panel adapts to the width it is GIVEN (contract §6): at 390 px the harness gives it the
         phone column (viewport − 2 × 16 px gutter). The chart's own grid placement is Session 2's. */
      const ov = await c.page.evaluate(([sel, narrow]) => {
        const p = document.querySelector(sel)
        if (narrow) { const slot = p.parentElement; slot.style.width = `${innerWidth - 32}px`; slot.style.maxWidth = `${innerWidth - 32}px` }
        const r = p.getBoundingClientRect()
        const over = [...p.querySelectorAll('*')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > r.right + 1 }).map(e => e.className || e.tagName)
        const grid = Math.round(document.querySelector('main').getBoundingClientRect().width)
        return { given: Math.round(r.width), over, grid, vw: innerWidth }
      }, [panel(A.pid), w < 600])
      check(ov.over.length === 0 && ov.given <= ov.vw, `${theme} ${w}px chart: given ${ov.given} px, nothing in the panel extends past it (${ov.over.slice(0, 3).join(',') || 'none'})${w < 600 ? ` [the chart grid itself is ${ov.grid} px at this viewport — Session 2's layout]` : ''}`)
      await shot(c.page, panel(A.pid), `${SHOTS}/V-chart-panel-${theme}-${w}.png`)
      await c.page.goto(BASE + '/nurse'); await c.page.waitForLoadState('networkidle'); await c.page.waitForSelector('.ordcard')
      const nov = await c.page.evaluate(() => ({ cards: [...document.querySelectorAll('.ncmar,.ncio,.ordcard')].map(e => Math.round(e.getBoundingClientRect().right)), vw: innerWidth }))
      check(nov.cards.every(r => r <= nov.vw + 1), `${theme} ${w}px workspace: MAR, I&O and Orders cards fit (${nov.cards.join(',')} ≤ ${nov.vw})`)
      await shot(c.page, '.ordcard', `${SHOTS}/V-orders-${theme}-${w}.png`)
      await shot(c.page, '.nw .ncio', `${SHOTS}/V-workspace-io-${theme}-${w}.png`)
      await c.ctx.close()
    }
  }

  check(errs.length === 0, `no page errors (${errs.slice(0, 3).join(' | ')})`)
  console.log(`\nRESULT: ${passes} passed, ${fails} failed`)
  fs.writeFileSync(`${SHOTS}/s3-setup.json`, JSON.stringify(S, null, 1))
  await browser.close()
  // cleanup: discharge the synthetic encounters (frees the beds)
  for (const p of [S.A, S.B]) { const r = await api(DOC, 'POST', `/api/icu/adt/encounters/${p.eid}/discharge`); console.log(`cleanup: discharge ${p.eid} -> ${r.status}`) }
  process.exitCode = fails ? 1 : 0
})().catch(async e => {
  console.error(e)
  if (S) for (const p of [S.A, S.B]) await api(DOC, 'POST', `/api/icu/adt/encounters/${p.eid}/discharge`).catch(() => {})
  process.exit(2)   // the browser may still be open
})
