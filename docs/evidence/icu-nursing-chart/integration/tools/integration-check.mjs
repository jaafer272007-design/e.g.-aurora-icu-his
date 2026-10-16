// Integration (Session 1 assembly) — the COMBINED acceptance on the PRODUCTION pairing: the assembled
// server publish with its own production bundle in wwwroot (same origin, the appliance topology),
// APP_ENV=production, a disposable PostgreSQL database, synthetic accounts from integration-setup.py.
// Every nursing completion, MAR documentation and I&O read/write below reaches the REAL assembled
// server and database. The only test-side network control is Playwright routing on the browser's
// own requests: DELAYS (reads held a few seconds), RESPONSE LOSS (the request is kept and the page
// sees no answer; it is delivered to the real server later, or route.fetch() lets the real server
// commit and the page then sees no answer) and 401 INJECTION (the request goes to the real server
// with an expired bearer token and the real server answers 401). Nothing is answered by a simulator.
//   node integration-check.mjs main   — sections D W C I S P T A, then a state snapshot
//   node integration-check.mjs post   — after a server restart on the same database: state identical
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const PHASE = process.argv[2] ?? 'main'
const BASE = process.env.NURSING_UI ?? 'http://localhost:8080'
const S = process.env.SCRATCH
const OUT = process.env.SHOTS ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../screenshots')
const ST = JSON.parse(fs.readFileSync(path.join(S, 'int-state.json'), 'utf8'))
const SNAP = path.join(S, 'int-before-restart.json')
const A = ST.accounts, O = ST.orders, P = ST.patients
const NOOR = A['noor.synthetic'], LINA = A['lina.synthetic'], DOC = A['omar.synthetic']
const P1 = P.p1.pid, P2 = P.p2.pid, P4 = P.p4.pid, P5 = P.p5.pid
fs.mkdirSync(OUT, { recursive: true })
let passes = 0, fails = 0
const check = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${msg}`); cond ? passes++ : fails++ }
const info = msg => console.log(`  info: ${msg}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, timeout = 10000, step = 100) => { const end = Date.now() + timeout; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(step) } }

/* ---------- the real API (node side) ---------- */
const api = async (method, p, token, body, headers = {}) => {
  const r = await fetch(BASE + p, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const tokens = {}
const token = async acct => (tokens[acct.username] ??= (await api('POST', '/api/auth/login', null, { username: acct.username, password: acct.password })).body.token)
const ordersOf = async pid => (await api('GET', `/api/icu/orders?patientId=${pid}`, await token(NOOR))).body
const orderOf = async (pid, oid) => (await ordersOf(pid)).find(o => o.orderId === oid)
const IO = ['io_current_intake_ml', 'io_current_output_ml']
const ioRows = async (pid, eid) => {
  const out = []
  for (const t of IO) out.push(...(await api('GET', `/api/icu/observations?patientId=${pid}&encounterId=${eid}&typeCode=${t}`, await token(NOOR))).body)
  return out.sort((a, b) => a.observationId.localeCompare(b.observationId))
}
const openEncounter = async pid => (await api('GET', `/api/icu/adt/encounters?patientId=${pid}&status=open`, await token(DOC))).body.find(e => e.status === 'open')

/* ---------- hospital clock (Asia/Baghdad, the server's zone) ---------- */
const parts = (ms, zone = 'Asia/Baghdad') => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(ms).map(p => [p.type, p.value]))
const hm24 = (ms, zone) => { const p = parts(ms, zone); return `${p.hour}:${p.minute}` }
const hm12 = (ms, zone) => { const p = parts(ms, zone); const h = +p.hour; return `${h % 12 || 12}:${p.minute} ${h < 12 ? 'AM' : 'PM'}` }
const hms24 = ms => { const p = parts(ms); return `${p.hour}:${p.minute}:${p.second}` }
const hms12 = ms => { const p = parts(ms); const h = +p.hour; return `${h % 12 || 12}:${p.minute}:${p.second} ${h < 12 ? 'AM' : 'PM'}` }
const full = ms => { const p = parts(ms); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` }
/** every hospital-clock minute label a read in the last `back` ms could carry */
const recentLabels = (fmt, back = 70_000) => { const now = Date.now(), s = new Set(); for (let t = now - back; t <= now + 1000; t += 5000) s.add(fmt(t)); return s }

/* ---------- the browser ---------- */
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const watch = page => {
  const w = { errors: [], forbidden: [], failed: [], requests: [] }
  page.on('pageerror', e => { w.errors.push(e.message); console.log(`  page error: ${e.message}`) })
  page.on('response', r => { if (r.url().includes('/api/')) { if (r.status() === 403) w.forbidden.push(`${r.request().method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`); else if (r.status() >= 400) w.failed.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) } })
  page.on('request', r => { if (r.url().includes('/api/')) w.requests.push({ method: r.method(), url: r.url(), body: r.postData(), at: Date.now() }) })
  return w
}
async function signInOn(page, acct) {
  await page.goto(`${BASE}/login`)
  await page.fill('#lguser', acct.username)
  await page.fill('#lgpass', acct.password)
  await page.click('button.lgsubmit')
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 })
}
async function open(acct, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...opts })
  ctx.setDefaultTimeout(20000)
  const page = await ctx.newPage()
  const w = watch(page)
  await signInOn(page, acct)
  return { ctx, page, w }
}
/* the standard header's sign-out, or Mission Control's own header ("Switch role") */
const signOutUi = async page => { await page.locator('button.hsignout, button.switchrole').first().click(); await page.waitForURL(u => u.pathname.startsWith('/login')) }
const overlay = async page => (await page.locator('.envrefusal h1').allTextContents()).join(' | ')
const toast = (page, text) => page.locator('.toast.show').filter({ hasText: text })
const dageTimes = async page => (await page.locator('.dage').evaluateAll(es => es.map(e => ({ text: e.textContent, title: e.title }))))
  .filter(d => /(?:·|of) /.test(d.text)).map(d => ({ ...d, shown: d.text.replace(/^.*(?:·|of) /, '').trim() }))
const ordRow = (page, oid) => page.locator(`.ordrow[data-order="${oid}"]`)
const doneBtn = (page, oid) => page.locator(`.ordrow[data-order="${oid}"] button.ordbtn`)
const marRowFor = (page, med) => page.locator('.marrow', { has: page.getByRole('button', { name: `${med}: given` }) })
const textOf = async loc => (await loc.count()) ? ((await loc.first().innerText({ timeout: 3000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim() : ''
/** a card's text without its data-age chips (they tick with the clock) */
const cardText = async (page, title) => page.evaluate(t => {
  const card = [...document.querySelectorAll('.card')].find(c => (c.querySelector('.chead .t, h2, h3')?.textContent ?? '').trim().startsWith(t)
    || [...c.children].some(ch => ch.textContent.trim().startsWith(t) && ch.textContent.length < t.length + 40))
  if (!card) return null
  const cl = card.cloneNode(true); cl.querySelectorAll('.dage').forEach(d => d.remove())
  return cl.textContent.replace(/\s+/g, ' ').trim()
}, title)
const hasCardTitled = async (page, re) => page.evaluate(src => { const re = new RegExp(src); return [...document.querySelectorAll('.card')].some(c => re.test((c.querySelector('.chead .t, h2, h3')?.textContent ?? c.textContent.slice(0, 60)).trim())) }, re.source)
/** hold a request (the page sees no answer) and keep it for a later delivery to the real server */
const holdFirstThenExpire = async (page, match) => {
  const h = { held: null, seen: [] }
  await page.route(match, async route => {
    const req = route.request()
    h.seen.push(JSON.parse(req.postData() ?? 'null'))
    if (!h.held) { h.held = { url: req.url(), headers: await req.allHeaders(), body: req.postData() }; await route.abort('timedout') }
    else await route.continue({ headers: { ...(await req.allHeaders()), authorization: 'Bearer expired.session.token' } })
  })
  return h
}
const deliver = async held => {
  const r = await fetch(held.url, { method: 'POST', headers: { authorization: held.headers.authorization, 'content-type': 'application/json' }, body: held.body })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const delayReads = async (page, pred, ms) => page.route(u => pred(u.toString()), async route => {
  if (route.request().method() !== 'GET') return route.fallback()
  await sleep(ms); await route.continue().catch(() => {})
})

const SECTIONS = process.env.SECTIONS ? process.env.SECTIONS.split(',') : null   // a debugging subset; the evidence run runs all
const want = k => !SECTIONS || SECTIONS.includes(k)
if (PHASE === 'main') {
  const onceDue = Date.parse(ST.signedAt.n_once)
  if (want('D')) {
  /* ================= D — DataAge + nursing time formats: UTC+3 hospital, a UTC-7 device ================= */
  console.log('== D: hospital clock (Asia/Baghdad, UTC+3) on a device in America/Los_Angeles; 24h then 12h')
  const d = await open(NOOR, { timezoneId: 'America/Los_Angeles' })
  const dp = d.page
  await dp.waitForURL(u => u.pathname === '/nurse')
  await dp.locator('.dage', { hasText: 'Lists Live ·' }).waitFor()
  await dp.locator('.dage', { hasText: 'I&O Live ·' }).waitFor()
  check(await dp.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone) === 'America/Los_Angeles', 'the browser device zone is America/Los_Angeles (UTC-7) — not the hospital zone')
  check(await dp.evaluate(() => JSON.parse(sessionStorage.getItem('aurora.serverClock')).timeZone) === 'Asia/Baghdad', 'the display clock was primed from the server: Asia/Baghdad')
  const checkChips = async (label, fmt, page) => {
    const ok = recentLabels(fmt), dev = recentLabels(ms => fmt(ms, 'America/Los_Angeles')), plus3 = recentLabels(ms => fmt(ms + 3 * 3600_000))
    const chips = await dageTimes(page)
    for (const c of chips) {
      check(ok.has(c.shown) && !dev.has(c.shown) && !plus3.has(c.shown) && new RegExp(` ${c.shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( and|\\.)`).test(c.title),
        `${label}: "${c.text}" = hospital time (not the device's ${[...dev].pop()}, not the old double-converted ${[...plus3].pop()}); tooltip carries the same time`)
    }
    return chips.length
  }
  check(await checkChips('24h workspace', hm24, dp) === 2, 'workspace carries the two live chips (Lists, I&O)')
  check(await textOf(ordRow(dp, O.n_once).locator('.ordround')) === `Due ${hms24(onceDue)}` || (await textOf(ordRow(dp, O.n_once).locator('.ordround'))).startsWith(`Due ${hms24(onceDue)} (`),
    `nursing due time to the second, hospital clock, 24h: "${await textOf(ordRow(dp, O.n_once).locator('.ordround'))}" (due ${ST.signedAt.n_once})`)
  /* a stamped server refusal (the stale-page case): Lina completes round 1 by API; Noor's page still offers it */
  const refusal = async (oid, fmtName) => {
    await delayReads(dp, u => u.includes('/api/icu/orders?implement=true'), 4000)   // no queue poll can land in the click window
    const r1 = (await orderOf(P1, oid)).nursing.currentRound
    const lina = await api('POST', `/api/icu/orders/${oid}/implement`, await token(LINA), { roundId: r1.roundId, attemptId: `lina-${oid}-${Date.now()}` })
    await doneBtn(dp, oid).click()
    const note = ordRow(dp, oid).locator('.ordnotice')
    await note.waitFor({ timeout: 8000 })
    const text = await note.innerText()
    const doneAt = Date.parse(lina.body.nursing.completions.at(-1).completedTime)
    const shownStamp = (text.match(/at (\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2})/) ?? [])[1]
    check(lina.status === 200 && shownStamp === full(doneAt) && !/\d{4}-\d{2}-\d{2}T/.test(text),
      `${fmtName}: refusal stamp to the second in hospital time "${shownStamp}" (server ${lina.body.nursing.completions.at(-1).completedTime}) — "${text.slice(0, 120)}…"`)
    await dp.unrouteAll({ behavior: 'ignoreErrors' })
    return text
  }
  await refusal(O.n_60a, '24h')
  await ordRow(dp, O.n_60a).locator('.ordlock').waitFor({ timeout: 15000 })
  const lock24 = await textOf(ordRow(dp, O.n_60a).locator('.ordlock'))
  check(/^🔒 Opens \d{2}:\d{2}:\d{2} \(in (59 min|1 h 0[01] min)\) — completion time \+ interval$/.test(lock24), `24h locked round: "${lock24}"`)
  /* 12h through the real Settings control */
  await dp.goto(`${BASE}/settings`)
  await dp.locator('input[name="timeformat"][value="12h"]').check({ force: true })
  check(await dp.evaluate(() => JSON.parse(sessionStorage.getItem('aurora.prefs') ?? '{}').timeFormat) === '12h', '12-hour preference set through Settings')
  await dp.goto(`${BASE}/nurse`)
  await dp.locator('.dage', { hasText: 'Lists Live ·' }).waitFor()
  await dp.locator('.dage', { hasText: 'I&O Live ·' }).waitFor()
  await checkChips('12h workspace', hm12, dp)
  const due12 = await textOf(ordRow(dp, O.n_once).locator('.ordround'))
  check(due12.startsWith(`Due ${hms12(onceDue)}`), `nursing due time to the second, 12h: "${due12}"`)
  const lock12a = await textOf(ordRow(dp, O.n_60a).locator('.ordlock'))
  check(/^🔒 Opens \d{1,2}:\d{2}:\d{2} (AM|PM) \(in (59 min|1 h 0[01] min)\)/.test(lock12a), `12h locked round to the second: "${lock12a}"`)
  await refusal(O.n_60b, '12h (full-date stamps stay yyyy-MM-dd HH:mm:ss)')
  await dp.locator('.ordcard').screenshot({ path: `${OUT}/13-dataage-12h-workspace-orders-refusal.png` })
  await dp.locator('header').screenshot({ path: `${OUT}/13b-dataage-12h-header.png` })
  await dp.goto(`${BASE}/patients/${P1}`)
  await dp.locator('.dage', { hasText: 'MAR Live ·' }).waitFor()
  await dp.locator('.dage', { hasText: 'I&O Live ·' }).waitFor()
  await dp.locator('.dage', { hasText: /^As of / }).first().waitFor()
  check(await checkChips('12h chart', hm12, dp) >= 3, 'chart chips (chart read, MAR, I&O, imaging) all on the hospital clock in 12h')
  await d.ctx.close()
  }

  /* ================= W — Nurse Workspace Done on the real adapter + server ================= */
  if (want('W')) {
  console.log('== W: workspace DUE/UPCOMING (no invented deadline), duplicate clicks, legacy, exact unlock, pending->signed, held original + reload + 401 retry, discharge')
  const w = await open(NOOR)
  const wp = w.page
  await wp.waitForURL(u => u.pathname === '/nurse')
  await ordRow(wp, O.n_once).waitFor()
  while (Date.now() < onceDue + 62_000) await sleep(500)
  await wp.reload(); await ordRow(wp, O.n_once).waitFor()
  const onceLine = await textOf(ordRow(wp, O.n_once).locator('.ordround'))
  const states = await wp.locator('.ordstate').allTextContents()
  check(/^Due \d{2}:\d{2}:\d{2} \(\d+ min since due\)$/.test(onceLine) && await textOf(ordRow(wp, O.n_once).locator('.ordstate')) === 'DUE',
    `a late one-time round stays DUE with the elapsed time as a fact: "${onceLine}"`)
  check(states.every(s => ['DUE', 'UPCOMING', 'NOT OPEN'].includes(s)) && !(await wp.locator('main').innerText()).includes('OVERDUE'),
    `no OVERDUE label anywhere (states: ${[...new Set(states)].join(', ')})`)
  const kpiDue = async () => (await wp.locator('.kpi', { hasText: 'Orders Due' }).locator('.kv').innerText()).trim()
  const dueRows = states.filter(s => s === 'DUE').length
  check(await kpiDue() === String(dueRows) && (await textOf(wp.locator('.ordaside'))).startsWith(`${dueRows} due now · ${states.filter(s => s === 'UPCOMING').length} upcoming`),
    `Orders Due KPI = actionable rounds = ${dueRows} (card: "${await textOf(wp.locator('.ordaside'))}")`)
  check(!(await wp.locator('.ordrow').evaluateAll(es => es.map(e => e.dataset.order))).includes(O.n_pend), 'the PENDING order is not in the queue')
  check((await textOf(ordRow(wp, O.n_30m).locator('.ordfreq'))) === 'every 30 min' && (await textOf(ordRow(wp, O.n_60a).locator('.ordfreq'))) === 'every 1 h', 'interval shown in minutes / hours')
  await wp.locator('.ordcard').screenshot({ path: `${OUT}/07-workspace-orders-due-upcoming.png` })

  // duplicate clicks -> ONE request; a late one-time Done
  const implReqs = oid => w.w.requests.filter(r => r.method === 'POST' && r.url.endsWith(`/api/icu/orders/${oid}/implement`))
  await doneBtn(wp, O.n_once).dblclick()
  await toast(wp, 'Order implemented').filter({ hasText: 'check pressure areas' }).waitFor({ timeout: 8000 })
  await ordRow(wp, O.n_once).waitFor({ state: 'detached', timeout: 15000 })
  const once = await orderOf(P1, O.n_once)
  check(implReqs(O.n_once).length === 1, `double click -> exactly ONE implement request (${implReqs(O.n_once).length})`)
  check(once.status === 'completed' && once.nursing.completions.length === 1 && once.nursing.completions[0].completedBy === NOOR.name
    && Date.parse(once.nursing.completions[0].completedTime) - Date.parse(once.nursing.completions[0].dueTime) >= 60_000,
    `late one-time Done recorded once (due ${once.nursing.completions[0].dueTime}, done ${once.nursing.completions[0].completedTime}); the order left the queue`)
  // legacy one-time order: the empty request
  await doneBtn(wp, O.n_leg).click()
  await toast(wp, 'Order implemented').filter({ hasText: 'legacy-style task' }).waitFor({ timeout: 8000 })
  const leg = await orderOf(P1, O.n_leg)
  check(implReqs(O.n_leg).length === 1 && [null, '', '{}'].includes(implReqs(O.n_leg)[0].body) && leg.status === 'completed' && leg.nursing === undefined,
    `legacy-style order: Done sends the empty request (${JSON.stringify(implReqs(O.n_leg)[0]?.body)}), completes it, invents no nursing data`)

  // repeating every 1 min: exact full-interval unlock without a reload
  await doneBtn(wp, O.n_1m).click()
  await toast(wp, 'Order implemented').filter({ hasText: 'reposition' }).waitFor({ timeout: 8000 })
  await ordRow(wp, O.n_1m).locator('.ordlock').waitFor({ timeout: 10000 })
  const r1m = await orderOf(P1, O.n_1m)
  const due2 = Date.parse(r1m.nursing.currentRound.dueTime), c1 = Date.parse(r1m.nursing.completions[0].completedTime)
  check(due2 === c1 + 60_000 && r1m.nursing.currentRound.number === 2, `round 2 due = completion (${r1m.nursing.completions[0].completedTime}) + 60 000 ms exactly`)
  check(await textOf(ordRow(wp, O.n_1m).locator('.ordstate')) === 'UPCOMING' && await doneBtn(wp, O.n_1m).isDisabled()
    && (await textOf(ordRow(wp, O.n_1m).locator('.ordlock'))).startsWith(`🔒 Opens ${hms24(due2)} (in `),
    `before its instant: UPCOMING, Done disabled, "${await textOf(ordRow(wp, O.n_1m).locator('.ordlock'))}"`)
  await wp.evaluate(oid => {
    window.__flip = null
    const sel = `.ordrow[data-order="${oid}"] button.ordbtn`
    new MutationObserver((_, obs) => { const b = document.querySelector(sel); if (b && !b.disabled) { window.__flip = Date.now(); obs.disconnect() } })
      .observe(document.body, { subtree: true, childList: true, attributes: true })
  }, O.n_1m)
  while (Date.now() < due2 - 400) await sleep(50)
  check(await doneBtn(wp, O.n_1m).isDisabled(), 'still locked 400 ms before the due instant')
  const flip = await until(() => wp.evaluate(() => window.__flip), 5000, 20)
  check(flip !== null && flip >= due2 && flip - due2 < 250, `Done enabled ${flip - due2} ms after the due instant, measured in the page (never before; no reload)`)
  check(await textOf(ordRow(wp, O.n_1m).locator('.ordstate')) === 'DUE', 'the opened round reads DUE')

  // pending -> signed: appears as DUE round 1
  const signed = await api('POST', `/api/icu/orders/${O.n_pend}/sign`, await token(DOC))
  await wp.reload(); await ordRow(wp, O.n_pend).waitFor({ timeout: 10000 })
  check(signed.status === 200 && await textOf(ordRow(wp, O.n_pend).locator('.ordstate')) === 'DUE' && await textOf(ordRow(wp, O.n_pend).locator('.ordfreq')) === 'every 2 h'
    && (await textOf(ordRow(wp, O.n_pend).locator('.ordround'))).startsWith('Round 1 · Due '), 'a pending order, once signed, shows round 1 DUE (every 2 h)')

  // held original + reload + expired-session retry; the original then commits
  const nh = await holdFirstThenExpire(wp, `**/api/icu/orders/${O.n_30m}/implement`)
  const r30 = (await orderOf(P1, O.n_30m)).nursing.currentRound
  await doneBtn(wp, O.n_30m).click()
  await ordRow(wp, O.n_30m).locator('.ordwarn').waitFor({ timeout: 12000 })
  check((await textOf(ordRow(wp, O.n_30m).locator('.ordwarn'))).startsWith('⚠ Not confirmed — your Done may already be saved') && await doneBtn(wp, O.n_30m).isDisabled(),
    'no answer -> "⚠ Not confirmed", Done locked, Retry offered')
  check((await orderOf(P1, O.n_30m)).nursing.completions.length === 0, 'the server holds no completion yet (the original is in flight)')
  await wp.reload()
  await ordRow(wp, O.n_30m).locator('.ordwarn').waitFor({ timeout: 10000 })
  check(await doneBtn(wp, O.n_30m).isDisabled() && await ordRow(wp, O.n_30m).locator('.ordretry').count() === 1, 'after a RELOAD: the same attempt is restored, still unconfirmed and locked')
  await sleep(6500)
  check(await ordRow(wp, O.n_30m).locator('.ordwarn').count() === 1, 'after the 5 s authoritative re-check: still unconfirmed (an absent completion is not proof)')
  await ordRow(wp, O.n_30m).locator('.ordretry').click()
  await ordRow(wp, O.n_30m).locator('.ordnotice', { hasText: 'Retry refused' }).waitFor({ timeout: 8000 })
  check(nh.seen.length === 2 && nh.seen[1].roundId === nh.seen[0].roundId && nh.seen[1].attemptId === nh.seen[0].attemptId && nh.seen[0].roundId === r30.roundId,
    `the retry re-sent the SAME { roundId, attemptId } (${nh.seen[0]?.roundId} / ${nh.seen[0]?.attemptId})`)
  check((await textOf(ordRow(wp, O.n_30m).locator('.ordnotice'))).startsWith('Retry refused — your session has expired — sign in again, then retry saving. Your original Done may still be on the record')
    && await ordRow(wp, O.n_30m).locator('.ordwarn').count() === 1 && await doneBtn(wp, O.n_30m).isDisabled(),
    'the real server answered the retry 401 -> the attempt STAYS unresolved (warning + Retry, no new Done)')
  check((await orderOf(P1, O.n_30m)).nursing.completions.length === 0, 'the 401 retry wrote nothing')
  await ordRow(wp, O.n_30m).screenshot({ path: `${OUT}/08-workspace-nursing-unconfirmed-after-401-retry.png` })
  const dl = await deliver(nh.held)
  check(dl.status === 200 && dl.body.nursing.completions.some(c => c.attemptId === nh.seen[0].attemptId), `the held ORIGINAL reaches the real server late and commits (${dl.status})`)
  await toast(wp, 'Saved — confirmed').filter({ hasText: 'suction check' }).waitFor({ timeout: 9000 })
  await ordRow(wp, O.n_30m).locator('.ordwarn').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
  const o30 = await orderOf(P1, O.n_30m)
  const c30 = o30.nursing.completions
  check(await ordRow(wp, O.n_30m).locator('.ordwarn').count() === 0 && c30.length === 1 && c30[0].attemptId === nh.seen[0].attemptId,
    'confirmed from the authoritative read: warning cleared, exactly ONE completion (the original)')
  check(Date.parse(o30.nursing.currentRound.dueTime) === Date.parse(c30[0].completedTime) + 1_800_000 && Date.parse(c30[0].completedTime) > Date.parse(c30[0].dueTime) + 60_000,
    `late Done: round 2 due = the recorded completion + 30 min (${o30.nursing.currentRound.dueTime}), not the old due time + 30 min`)
  await wp.unrouteAll({ behavior: 'ignoreErrors' })

  // discharge while the page still offers the Done -> the real server refuses, nothing written
  await delayReads(wp, u => u.includes('/api/icu/orders?') || u.includes('/api/icu/assignments/mine'), 6000)
  const dis = await api('POST', `/api/icu/adt/encounters/${P.p5.eid}/discharge`, await token(DOC), {})
  const echoResp = wp.waitForResponse(r => r.url().endsWith(`/api/icu/orders/${O.n_echo}/implement`))
  await doneBtn(wp, O.n_echo).click()
  const er = await echoResp
  /* read the row's notice the moment it renders (the settling read then drops the discharged order) */
  const echoNote = await wp.waitForFunction(oid => document.querySelector(`.ordrow[data-order="${oid}"] .ordnotice`)?.textContent, O.n_echo, { timeout: 5000, polling: 20 })
    .then(h => h.jsonValue()).catch(() => '')
  const echoToast = await textOf(toast(wp, 'Done NOT recorded'))
  const echo = await orderOf(P5, O.n_echo)
  check(dis.status === 200 && er.status() === 409 && echoNote.startsWith('Not recorded — ') && echo.nursing.completions.length === 0,
    `Done after discharge -> 409 from the real server, nothing written; row notice: "${echoNote}"; toast: "${echoToast}"`)
  await wp.unrouteAll({ behavior: 'ignoreErrors' })
  await ordRow(wp, O.n_echo).waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  check(await ordRow(wp, O.n_echo).count() === 0 && echo.status === 'discontinued', `the discharged patient's order leaves the queue (record: ${echo.status})`)
  await wp.screenshot({ path: `${OUT}/05-nurse-workspace-light.png`, fullPage: true })
  check(w.w.errors.length === 0 && w.w.forbidden.length === 0, `workspace: no page errors, no 403 responses (${w.w.forbidden.join(', ') || 'none'})`)
  await w.ctx.close()
  }

  /* ================= C — the nurse patient chart: MAR + I&O, one pending MAR attempt across navigation ================= */
  console.log('== C: nurse chart (MAR + I&O, no SOFA/NEWS2); the same unconfirmed MAR attempt across chart/workspace, switches, reload, re-auth')
  const doc = await open(DOC)
  await doc.page.goto(`${BASE}/patients/${P1}`)
  await doc.page.locator('.fluid').waitFor({ timeout: 15000 })
  await sleep(1500)
  const base = { fluid: await textOf(doc.page.locator('.fluid')), sofa: await cardText(doc.page, 'SOFA'), news2: await cardText(doc.page, 'NEWS2') }
  check(base.sofa !== null && base.news2 !== null && await doc.page.locator('.ncpanel').count() === 0,
    `doctor chart: SOFA + NEWS2 shown, no nurse care panel; fluid strip "${base.fluid}"`)
  await doc.page.screenshot({ path: `${OUT}/01-doctor-chart-light.png`, fullPage: true })

  const c = await open(NOOR)
  const cp = c.page
  await cp.waitForURL(u => u.pathname === '/nurse')
  await cp.getByRole('button', { name: /^Open chart Synthetic Integration Alpha/ }).click()     // client-side, from the workspace
  await cp.waitForURL(u => u.pathname === `/patients/${P1}`)
  await cp.locator(`.ncpanel[data-patient="${P1}"]`).waitFor()
  await marRowFor(cp, 'Vancomycin').waitFor({ timeout: 15000 })
  await cp.locator('.ncio .iotiles').waitFor({ timeout: 15000 })
  check(await cp.locator('.ncpanel .ncmar').count() === 1 && await cp.locator('.ncpanel .ncio').count() === 1 && (await textOf(cp.locator('.ncpanel .ncmar'))).includes('Vancomycin')
    && !(await textOf(cp.locator('.ncpanel'))).includes('Paracetamol'), "nurse chart: this patient's MAR (Vancomycin only) + I&O")
  check(await cardText(cp, 'SOFA') === null && await cardText(cp, 'NEWS2') === null && !(await cp.locator('main').innerText()).match(/\bSOFA\b|\bNEWS2\b/),
    'nurse chart: no SOFA, no NEWS2')
  await cp.screenshot({ path: `${OUT}/03-nurse-chart-light.png`, fullPage: true })
  const mh = await holdFirstThenExpire(cp, `**/api/icu/mar/${O.vanc}/administrations/*`)
  const marWrites = () => c.w.requests.filter(r => r.method === 'POST' && r.url.includes(`/api/icu/mar/${O.vanc}/administrations/`))
  await cp.getByRole('button', { name: 'Vancomycin: given' }).dblclick()
  const warnC = marRowFor(cp, 'Vancomycin').locator('.marwarn')
  await warnC.waitFor({ timeout: 12000 })
  check(marWrites().length === 1 && (await textOf(warnC)).startsWith('⚠ Not confirmed — your given documentation (') && await cp.getByRole('button', { name: 'Vancomycin: given' }).isDisabled(),
    `chart: double click -> ONE request; no answer -> "${(await textOf(warnC)).slice(0, 70)}…", controls locked`)
  await marRowFor(cp, 'Vancomycin').screenshot({ path: `${OUT}/09-chart-mar-unconfirmed.png` })
  // chart -> workspace (client-side navigation: the chart's Back button, no reload)
  await cp.evaluate(() => { window.__noReload = true })
  await cp.locator('button.hback').click()
  await cp.waitForURL(u => u.pathname === '/nurse')
  await marRowFor(cp, 'Vancomycin').locator('.marwarn').waitFor({ timeout: 10000 })
  check(await cp.evaluate(() => window.__noReload === true) && await cp.getByRole('button', { name: 'Vancomycin: given' }).isDisabled() && await cp.getByRole('button', { name: 'Paracetamol: given' }).isEnabled(),
    'workspace (navigated, no reload): the SAME attempt is unconfirmed and locked; another patient\'s dose is unaffected')
  await cp.locator('.ncmar').screenshot({ path: `${OUT}/10-workspace-mar-same-attempt-unconfirmed.png` })
  // back to the chart, switch patients
  await cp.goForward(); await cp.waitForURL(u => u.pathname === `/patients/${P1}`)
  await marRowFor(cp, 'Vancomycin').locator('.marwarn').waitFor({ timeout: 10000 })
  await cp.getByRole('button', { name: /^Open Synthetic Integration Bravo/ }).click()
  await cp.locator(`.ncpanel[data-patient="${P2}"]`).waitFor()
  await marRowFor(cp, 'Paracetamol').waitFor({ timeout: 10000 })
  check(!(await textOf(cp.locator('.ncpanel'))).includes('Vancomycin') && await cp.locator('.ncpanel .marwarn').count() === 0 && await cp.getByRole('button', { name: 'Paracetamol: given' }).isEnabled(),
    "patient switch to Bravo: only Bravo's MAR, no foreign warning, its dose open")
  await cp.getByRole('button', { name: /^Open Synthetic Integration Alpha/ }).click()
  await cp.locator(`.ncpanel[data-patient="${P1}"]`).waitFor()
  await marRowFor(cp, 'Vancomycin').locator('.marwarn').waitFor({ timeout: 10000 })
  check(true, 'back on Alpha: the same attempt is still unconfirmed')
  await cp.reload()
  await marRowFor(cp, 'Vancomycin').locator('.marwarn').waitFor({ timeout: 15000 })
  await sleep(6500)
  check(await marRowFor(cp, 'Vancomycin').locator('.marwarn').count() === 1, 'after a RELOAD and the 5 s re-check: still unconfirmed (restored from this tab\'s store)')
  // re-authentication: same nurse sees it; another nurse never does
  await signOutUi(cp); await signInOn(cp, NOOR)
  await cp.goto(`${BASE}/patients/${P1}`)
  await marRowFor(cp, 'Vancomycin').locator('.marwarn').waitFor({ timeout: 15000 })
  check(true, 'sign out + sign in as the SAME nurse: the attempt is restored, unconfirmed')
  await signOutUi(cp); await signInOn(cp, LINA)
  await cp.goto(`${BASE}/patients/${P1}`)
  await marRowFor(cp, 'Vancomycin').waitFor({ timeout: 15000 })
  await sleep(1500)
  check(await cp.locator('.marwarn, .marretry').count() === 0, 'a DIFFERENT nurse in the same tab never sees Noor\'s unconfirmed attempt')
  await signOutUi(cp); await signInOn(cp, NOOR)
  await cp.goto(`${BASE}/patients/${P1}`)
  await marRowFor(cp, 'Vancomycin').locator('.marwarn').waitFor({ timeout: 15000 })
  await marRowFor(cp, 'Vancomycin').locator('.marretry').click()
  await toast(cp, 'Save not confirmed').filter({ hasText: 'session has expired' }).waitFor({ timeout: 8000 })
  check(mh.seen.length === 2 && mh.seen[1].attemptId === mh.seen[0].attemptId && mh.seen[1].action === 'given',
    `the MAR retry re-sent the SAME attempt (${mh.seen[0]?.attemptId})`)
  check(await marRowFor(cp, 'Vancomycin').locator('.marwarn').count() === 1 && ((await orderOf(P1, O.vanc)).administrations ?? []).length === 0,
    'the real server answered the retry 401 -> still unconfirmed; nothing written')
  const md = await deliver(mh.held)
  check(md.status === 200, `the held ORIGINAL MAR documentation reaches the real server late and commits (${md.status})`)
  await toast(cp, 'Saved — confirmed').filter({ hasText: 'Vancomycin' }).waitFor({ timeout: 9000 })
  const vanc = await orderOf(P1, O.vanc)
  check((vanc.administrations ?? []).length === 1 && vanc.administrations[0].attemptId === mh.seen[0].attemptId && vanc.administrations[0].status === 'given'
    && await cp.locator('.marwarn').count() === 0 && (await textOf(cp.locator('.ncpanel .mardoc'))).startsWith('given at '),
    'confirmed from the authoritative MAR read: exactly ONE given fact (the original); the row shows "given at …"')
  await cp.unrouteAll({ behavior: 'ignoreErrors' })

  /* ================= I — I&O through the UI on the real server ================= */
  console.log('== I: I&O adapters — 500 then 200, zero, missing, one/both values, response loss, 401, amendments, scores untouched, A->B stale form')
  const io = cp.locator('.ncpanel .ncio'), pre = `#ncio-${P1}`
  const tiles = async (loc = io) => (await loc.locator('.iotile .iotv').allTextContents()).map(s => s.trim())
  const ioPosts = () => c.w.requests.filter(r => r.method === 'POST' && r.url.endsWith('/api/icu/observations'))
  const save = async (intake, output, expectText = 'Saved — ') => {
    if (intake !== null) await cp.fill(`${pre}-in`, String(intake))
    if (output !== null) await cp.fill(`${pre}-out`, String(output))
    await io.locator('.iosave').click()
    await io.locator('.iooutcome', { hasText: expectText }).waitFor({ timeout: 12000 })
    await sleep(600)
  }
  check(JSON.stringify(await tiles()) === JSON.stringify(['Not recorded', 'Not recorded', '—']) && (await textOf(io)).includes('needs both current values')
    && (await textOf(io)).includes('No I&O entered for this admission yet.'), 'new admission: Not recorded / Not recorded / balance — (needs both); empty history')
  const e1 = (await openEncounter(P1)).encounterId
  await save(500, null)
  const b1 = JSON.parse(ioPosts().at(-1).body)
  check(JSON.stringify(await tiles()) === JSON.stringify(['500 mL', 'Not recorded', '—']) && b1.entries.length === 1 && b1.expectedEncounterId === e1,
    `one-value save: ONE entry, bound to the admission (${b1.expectedEncounterId}); output stays Not recorded, no balance`)
  await save(200, null)
  check((await tiles())[0] === '200 mL' && JSON.stringify(await io.locator('.iohval').allTextContents()) === JSON.stringify(['200 mL', '500 mL']), '500 then 200 shows 200; both stay in the history (newest first)')
  await save(null, 0)
  check(JSON.stringify(await tiles()) === JSON.stringify(['200 mL', '0 mL', '+200 mL']), 'zero output is a value: balance +200 mL')
  await save(300, 120)
  const b2 = JSON.parse(ioPosts().at(-1).body)
  check(JSON.stringify(await tiles()) === JSON.stringify(['300 mL', '120 mL', '+180 mL']) && b2.entries.length === 2, 'both values in ONE save: 300 / 120, balance +180 mL')
  await io.screenshot({ path: `${OUT}/11-io-panel-values.png` })
  // response loss: the real server commits, the page sees no answer -> never resent; the re-read shows the record
  const before = (await ioRows(P1, e1)).length
  let lost = 0
  await cp.route('**/api/icu/observations', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    lost++; await route.fetch(); await route.abort('timedout')
  })
  await save(350, null, 'Not confirmed — ')
  await until(async () => (await tiles())[0] === '350 mL', 10000)
  check(lost === 1 && (await ioRows(P1, e1)).length === before + 1 && (await tiles())[0] === '350 mL'
    && (await textOf(io.locator('.iooutcome'))).includes('The values may already be saved: check the history below before saving again'),
    'response lost after the real server committed: "Not confirmed", sent once, the re-read shows 350 mL from the record')
  await cp.unrouteAll({ behavior: 'ignoreErrors' })
  // 401: the real server refuses an expired session; nothing written; the typed value stays
  await cp.route('**/api/icu/observations', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    await route.continue({ headers: { ...(await route.request().allHeaders()), authorization: 'Bearer expired.session.token' } })
  })
  const n401 = (await ioRows(P1, e1)).length
  await save(777, null, 'Not saved — ')
  check((await textOf(io.locator('.iooutcome'))).startsWith('Not saved — your session has expired') && (await ioRows(P1, e1)).length === n401
    && await cp.inputValue(`${pre}-in`) === '777' && (await tiles())[0] === '350 mL', '401 from the real server: "Not saved — session expired", nothing written, typed value kept')
  await cp.unrouteAll({ behavior: 'ignoreErrors' })
  await cp.fill(`${pre}-in`, '')
  // amendments (the existing correction API): effective values; amending an older entry never makes it current
  const rows1 = await ioRows(P1, e1)
  const intakes = rows1.filter(r => r.typeCode === IO[0]).sort((a, b) => b.clinicalTime.localeCompare(a.clinicalTime) || b.observationId.localeCompare(a.observationId))
  const am1 = await api('POST', `/api/icu/observations/${intakes[0].observationId}/correct`, await token(NOOR), { value: 360 })
  const am2 = await api('POST', `/api/icu/observations/${intakes.at(-1).observationId}/correct`, await token(DOC), { value: 550, reason: 'synthetic transcription check' })
  await cp.reload(); await io.locator('.iotiles').waitFor({ timeout: 15000 }); await sleep(800)
  const hist = await io.locator('.iohval').allTextContents()
  check(am1.status === 200 && am2.status === 200 && JSON.stringify(await tiles()) === JSON.stringify(['360 mL', '120 mL', '+240 mL'])
    && (await textOf(io.locator('.iotile.in .iostamp'))).includes('amended') && hist[0].startsWith('360 mL') && hist[0].includes('(charted 350 mL)')
    && hist.some(h => h.startsWith('550 mL') && h.includes('(charted 500 mL)')) && (await io.locator('.iohamend').count()) === 2,
    `amendments: current intake = effective 360 (charted 350); the amended OLDEST (500 -> 550) stays history; balance +240 (${hist.length} history rows)`)
  // the doctor's fluid strip and scores never read the snapshots
  await doc.page.reload(); await doc.page.locator('.fluid').waitFor({ timeout: 15000 }); await sleep(1500)
  const after = { fluid: await textOf(doc.page.locator('.fluid')), sofa: await cardText(doc.page, 'SOFA'), news2: await cardText(doc.page, 'NEWS2') }
  check(after.fluid === base.fluid && after.sofa === base.sofa && after.news2 === base.news2,
    `after ${rows1.length + 1} I&O snapshots: the doctor's fluid strip ("${after.fluid}"), SOFA and NEWS2 are byte-identical`)
  // the workspace selector shows the same record; another patient shows its own
  await cp.goto(`${BASE}/nurse`)
  await cp.locator('#nwioPatient').waitFor()
  await cp.selectOption('#nwioPatient', P1)
  await until(async () => JSON.stringify(await tiles(cp.locator('.ncio'))) === JSON.stringify(['360 mL', '120 mL', '+240 mL']), 10000)
  check(JSON.stringify(await tiles(cp.locator('.ncio'))) === JSON.stringify(['360 mL', '120 mL', '+240 mL']), 'workspace I&O (patient selector = Alpha): the same values as the chart')
  await cp.selectOption('#nwioPatient', P2)
  await until(async () => (await tiles(cp.locator('.ncio')))[0] === 'Not recorded', 10000)
  check(JSON.stringify(await tiles(cp.locator('.ncio'))) === JSON.stringify(['Not recorded', 'Not recorded', '—']), "workspace I&O switched to Bravo: Bravo's own (blank) record, nothing of Alpha")
  // A -> B: a form typed for admission A, then discharge + readmission B, then Save
  await cp.goto(`${BASE}/patients/${P4}`)
  const io4 = cp.locator('.ncpanel .ncio'), pre4 = `#ncio-${P4}`
  await io4.locator('.iotiles').waitFor({ timeout: 15000 })
  await cp.fill(`${pre4}-in`, '400'); await io4.locator('.iosave').click()
  await io4.locator('.iooutcome', { hasText: 'Saved — ' }).waitFor({ timeout: 10000 })
  const EA = P.p4.eid
  const aBefore = await ioRows(P4, EA)
  await cp.fill(`${pre4}-in`, '999'); await cp.fill(`${pre4}-out`, '111')
  await delayReads(cp, u => u.includes(`patientId=${P4}`), 5000)          // no poll can re-key the form before the Save
  const disA = await api('POST', `/api/icu/adt/encounters/${EA}/discharge`, await token(DOC), {})
  const freeBed = (await api('GET', '/api/icu/adt/beds', await token(DOC))).body.find(b => !b.patientId && b.active !== false).bedId
  const readm = await api('POST', '/api/icu/adt/admissions', await token(DOC), { patientId: P4, diagnosis: 'synthetic readmission (integration)', attending: 'Dr. Omar Synthetic', bedId: freeBed })
  const EB = readm.body?.encounter?.encounterId
  const staleResp = cp.waitForResponse(r => r.url().endsWith('/api/icu/observations') && r.request().method() === 'POST')
  await io4.locator('.iosave').click()
  const sr = await staleResp
  const staleBody = JSON.parse(sr.request().postData())
  await io4.locator('.iooutcome', { hasText: 'admission has changed' }).waitFor({ timeout: 15000 })
  check(disA.status === 200 && readm.status === 200 && EB && EB !== EA, `admission A ${EA} discharged, the same patient readmitted as B ${EB}`)
  check(sr.status() === 409 && staleBody.expectedEncounterId === EA, `the stale save was sent bound to A and the real server answered 409 (${sr.status()})`)
  check((await textOf(io4.locator('.iooutcome'))).endsWith('The patient\'s admission has changed, so the typed values were cleared; nothing was saved into the new admission.')
    && await cp.inputValue(`${pre4}-in`) === '' && await cp.inputValue(`${pre4}-out`) === '', 'the typed values were cleared and the nurse is told why')
  check((await ioRows(P4, EB)).length === 0 && JSON.stringify(await ioRows(P4, EA)) === JSON.stringify(aBefore), 'nothing written in B; A unchanged (its one entry, 400 mL)')
  check(JSON.stringify(await tiles(io4)) === JSON.stringify(['Not recorded', 'Not recorded', '—']), 'admission B starts blank')
  await io4.screenshot({ path: `${OUT}/12-io-stale-admission-409.png` })
  await cp.unrouteAll({ behavior: 'ignoreErrors' })
  check(c.w.errors.length === 0 && c.w.forbidden.length === 0, `nurse chart/workspace tab: no page errors, no 403 responses (${c.w.forbidden.join(', ') || 'none'})`)

  /* ================= S — patient switching with delayed reads ================= */
  console.log('== S: a switch while the previous patient\'s reads are delayed never renders the previous patient')
  for (const [who, sess] of [['nurse', c], ['doctor', doc]]) {
    const pg = sess.page
    await pg.goto(`${BASE}/patients/${P2}`)
    await pg.locator('.card', { hasText: 'Bedside' }).first().waitFor({ timeout: 15000 })
    await sleep(1200)
    const p2Bedside = await cardText(pg, 'Bedside')
    const p2Fluid = await textOf(pg.locator('.fluid'))
    await delayReads(pg, u => u.includes(P1), 3000)
    await pg.getByRole('button', { name: /^Open Synthetic Integration Alpha/ }).click()
    await sleep(300)
    await pg.getByRole('button', { name: /^Open Synthetic Integration Bravo/ }).click()
    await sleep(4500)
    const bed = await cardText(pg, 'Bedside')
    const leak = who === 'nurse'
      ? (await textOf(pg.locator('.ncpanel'))).includes('Vancomycin') || (await pg.locator(`.ncpanel[data-patient="${P2}"]`).count()) !== 1 || (await tiles(pg.locator('.ncpanel .ncio')))[0] !== 'Not recorded'
      : (await textOf(pg.locator('.fluid'))) !== p2Fluid
    check(new URL(pg.url()).pathname === `/patients/${P2}` && bed === p2Bedside && !leak,
      `${who}: Alpha's delayed reads landed after the switch to Bravo — nothing of Alpha rendered (Bedside, ${who === 'nurse' ? 'MAR, I&O' : 'fluid strip'} are Bravo's)`)
    await pg.unrouteAll({ behavior: 'ignoreErrors' })
  }

  /* ================= P — real-role read permissions (no grants) ================= */
  console.log('== P: restricted roles on the chart — no forbidden background reads through composite adapters')
  for (const u of ['rami.synthetic', 'huda.synthetic', 'sami.synthetic', 'dana.synthetic']) {
    const acct = A[u]
    const r = await open(acct)
    const landing = new URL(r.page.url()).pathname
    await r.page.goto(`${BASE}/patients/${P1}`)
    await r.page.locator('.card', { hasText: 'Bedside' }).first().waitFor({ timeout: 15000 }).catch(() => {})
    await sleep(3500)
    const cards = {
      care: await r.page.locator('.ncpanel').count() > 0, sofa: (await cardText(r.page, 'SOFA')) !== null, news2: (await cardText(r.page, 'NEWS2')) !== null,
      meds: await hasCardTitled(r.page, /^Active Medication/), labs: await hasCardTitled(r.page, /^Laborator/), imaging: await hasCardTitled(r.page, /^Imaging/),
    }
    const ioReads = r.w.requests.filter(q => q.url.includes('typeCode=io_current')).length
    const nursingReads = r.w.requests.filter(q => q.url.includes('/api/icu/mar') || q.url.includes('implement=true')).length
    const ov = await overlay(r.page)
    /* PRE-EXISTING (identical on main f0bf464): the chart's score hook (usePatientScores) and its
       detail composite (getPatientDetail) read the patient's orders and lab draws for EVERY role;
       a role without orders.view / results.view gets 403 and the production access refusal.
       Recorded, not changed here (no permission is granted; the scoring behaviour for such roles
       is an owner decision). Any OTHER 403 — e.g. from this update's I&O / MAR / nursing reads —
       fails the check. */
    const PRE = [`/api/icu/orders?patientId=${P1}`, `/api/icu/results/labs?patientId=${P1}`]
    const pre = r.w.forbidden.filter(f => PRE.some(x => f.endsWith(x)))
    const other = r.w.forbidden.filter(f => !pre.includes(f))
    check(other.length === 0 && ioReads === 0 && nursingReads === 0 && !cards.care,
      `${acct.role} (landing ${landing}): no 403 from this update's composites (I&O, MAR, nursing queue — none read: I&O ${ioReads}, MAR/queue ${nursingReads}), no nurse care panel; other 403: ${other.join(', ') || 'none'}`)
    if (pre.length || ov) info(`${acct.role}: PRE-EXISTING forbidden reads ${[...new Set(pre)].join(', ')} (x${pre.length}) -> overlay "${ov}"; cards ${JSON.stringify(cards)}`)
    else check(ov === '' && cards.sofa && cards.labs, `${acct.role}: full chart (no overlay), cards ${JSON.stringify(cards)}`)
    if (u === 'sami.synthetic') await r.page.screenshot({ path: `${OUT}/19-physiotherapist-chart-preexisting-refusal.png` })
    if (u === 'dana.synthetic') await r.page.screenshot({ path: `${OUT}/20-receptionist-chart-preexisting-refusal.png` })
    if (['rami.synthetic', 'huda.synthetic'].includes(u)) {
      const n = r.w.forbidden.length
      await r.page.goto(`${BASE}/orders/${P1}`)
      await r.page.locator('.orderlist').waitFor({ timeout: 15000 }).catch(() => {})
      await sleep(2500)
      check(r.w.forbidden.length === n && await r.page.getByRole('button', { name: /^Done: round|^Implement order/ }).count() === 0 && await overlay(r.page) === '',
        `${acct.role}: Orders & Medication view-only — no Done/Implement control, no 403`)
    }
    if (u === 'rami.synthetic') await r.page.screenshot({ path: `${OUT}/17-pharmacist-chart.png`, fullPage: false })
    const before = r.w.requests.length
    await r.page.goto(`${BASE}/nurse`); await sleep(2000)
    const after = r.w.requests.slice(before)
    check(new URL(r.page.url()).pathname !== '/nurse' || (await r.page.locator('.nw').count()) === 0, `${acct.role}: the Nurse Workspace does not open (no meds.administer) -> ${new URL(r.page.url()).pathname}`)
    check(!after.some(q => q.url.includes('typeCode=io_current') || q.url.includes('/api/icu/mar') || q.url.includes('implement=true')), `${acct.role}: no MAR / queue / I&O reads attempted from /nurse`)
    await r.ctx.close()
  }

  /* ================= T — themes and the combined 390 px layout ================= */
  console.log('== T: dark/light; 390 px (the care panel fits)')
  const overflowOf = async (pg, sel) => pg.evaluate(s => {
    const el = document.querySelector(s); if (!el) return null
    const all = [el, ...el.querySelectorAll('*')]
    return { inner: all.reduce((m, e) => Math.max(m, e.scrollWidth - e.clientWidth), 0), right: Math.round(el.getBoundingClientRect().right), vw: window.innerWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  }, sel)
  for (const [acct, route, name, sel] of [[NOOR, `/patients/${P1}`, '14-nurse-chart-390', '.ncpanel'], [NOOR, '/nurse', '15-workspace-390', '.ncmar'], [DOC, `/patients/${P1}`, '16-doctor-chart-390', 'main']]) {
    const n = await open(acct, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await n.page.goto(`${BASE}${route}`)
    await n.page.locator(sel).first().waitFor({ timeout: 15000 })
    await sleep(2500)
    const o = await overflowOf(n.page, sel)
    if (sel === '.ncpanel') {
      const io2 = await overflowOf(n.page, '.ncpanel .ncio'), mar2 = await overflowOf(n.page, '.ncpanel .ncmar')
      check(o.inner <= 0 && o.right <= o.vw && io2.inner <= 0 && mar2.inner <= 0, `390 px nurse chart: the care panel fits (panel ${o.right}/${o.vw} px, max inner overflow ${Math.max(o.inner, io2.inner, mar2.inner)} px)`)
    } else if (sel === '.ncmar') {
      const oc = await overflowOf(n.page, '.ordcard'), ic = await overflowOf(n.page, '.ncio')
      check(o.inner <= 0 && oc.inner <= 0 && ic.inner <= 0 && o.right <= o.vw, `390 px workspace: MAR, Orders to Implement and I&O cards fit (max inner overflow ${Math.max(o.inner, oc.inner, ic.inner)} px)`)
    }
    const offenders = await n.page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !(e.parentElement && e.parentElement.getBoundingClientRect().right > window.innerWidth + 1))
      .map(e => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`).slice(0, 6))
    info(`${name}: page-level horizontal overflow ${o.page} px; outermost overflowing elements: ${offenders.join(', ') || 'none'}`)
    await n.page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
    await n.ctx.close()
  }
  for (const [acct, route, name] of [[DOC, `/patients/${P1}`, '02-doctor-chart-dark'], [NOOR, `/patients/${P1}`, '04-nurse-chart-dark'], [NOOR, '/nurse', '06-nurse-workspace-dark']]) {
    const n = await open(acct, { colorScheme: 'dark' })
    await n.page.goto(`${BASE}${route}`)
    await n.page.locator(route === '/nurse' ? '.ordcard' : '.card').first().waitFor({ timeout: 15000 })
    await sleep(2500)
    check(await n.page.evaluate(() => document.documentElement.dataset.theme) !== 'light', `${name}: dark theme rendered (device preference)`)
    await n.page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
    await n.ctx.close()
  }
  check(await doc.page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'light theme rendered for the light-preference contexts')
  await doc.ctx.close(); await c.ctx.close()

  /* ================= A — compact API: concurrency + the four-code convention on the assembled server ================= */
  console.log('== A: same-attempt concurrency, competing attempts, error conventions (real server)')
  const NT = await token(NOOR), DT = await token(DOC), PT = await token(A['rami.synthetic'])
  const mk = async (summary, interval) => (await api('POST', '/api/icu/orders', DT, { drafts: [{ patientId: P2, category: 'Nursing', summary, priority: 'Routine', requiresImplementation: true,
    nursing: interval ? { intervalMinutes: interval } : {} }], sign: true })).body[0]
  const rep = await mk('API: concurrency (every 5 min)', 5)
  const same = await Promise.all(Array.from({ length: 6 }, () => api('POST', `/api/icu/orders/${rep.orderId}/implement`, NT, { roundId: rep.nursing.currentRound.roundId, attemptId: 'api-same-attempt-001' })))
  const repAfter = await orderOf(P2, rep.orderId)
  check(same.every(r => r.status === 200) && repAfter.nursing.completions.length === 1, `6 simultaneous copies of ONE attempt -> all 200, exactly ONE completion (${same.map(r => r.status).join(',')})`)
  const one = await mk('API: competing attempts (one-time)')
  const comp = await Promise.all(['api-compete-a1', 'api-compete-b2', 'api-compete-c3', 'api-compete-d4'].map(a => api('POST', `/api/icu/orders/${one.orderId}/implement`, NT, { roundId: one.nursing.currentRound.roundId, attemptId: a })))
  check(comp.filter(r => r.status === 200).length === 1 && comp.filter(r => r.status === 409).length === 3 && (await orderOf(P2, one.orderId)).nursing.completions.length === 1,
    `4 competing attempts on one round -> one 200, three 409, one completion (${comp.map(r => r.status).join(',')})`)
  const early = await api('POST', `/api/icu/orders/${rep.orderId}/implement`, NT, { roundId: repAfter.nursing.currentRound.roundId, attemptId: 'api-early-0001' })
  check(early.status === 409 && early.body.error.includes('not due yet — it opens at '), `early round -> 409 "${early.body.error}"`)
  const stale = await api('POST', `/api/icu/orders/${rep.orderId}/implement`, NT, { roundId: rep.nursing.currentRound.roundId, attemptId: 'api-stale-0001' })
  check(stale.status === 409 && stale.body.error.includes('already completed'), `stale round, new attempt -> 409 "${stale.body.error.slice(0, 90)}…"`)
  const absent = await api('POST', '/api/icu/orders/ORD-0000/implement', NT, { reason: 'x' })
  check(absent.status === 404, `absent order with an invalid body -> 404 before any 400 (Amendment 2) (${absent.status})`)
  const pair = await api('POST', `/api/icu/orders/${rep.orderId}/implement`, NT, { attemptId: 'api-pair-0001' })
  const badRound = await api('POST', `/api/icu/orders/${rep.orderId}/implement`, NT, { roundId: '2026-10-16T10:00~r1', attemptId: 'api-badround-1' })
  check(pair.status === 400 && badRound.status === 400, `shape errors -> 400 (attemptId without roundId: ${pair.status}; minute-form roundId: ${badRound.status})`)
  const docImpl = await api('POST', `/api/icu/orders/${rep.orderId}/implement`, DT, { roundId: repAfter.nursing.currentRound.roundId, attemptId: 'api-doctor-001' })
  check(docImpl.status === 403, `doctor (no orders.implement) -> 403 (${docImpl.status})`)
  const echoAgain = await api('POST', `/api/icu/orders/${O.n_echo}/implement`, NT, { roundId: ST.signedAt.n_echo + '~r1', attemptId: 'api-after-discharge' })
  check(echoAgain.status === 409, `completing a discharged admission's order -> 409 (${echoAgain.status}: ${echoAgain.body?.error})`)
  const e2 = (await openEncounter(P2)).encounterId
  const phIo = await api('POST', '/api/icu/observations', PT, { patientId: P2, entries: [{ typeCode: IO[0], value: 50 }], expectedEncounterId: e2 })
  check(phIo.status === 403 && (await ioRows(P2, e2)).length === 0, `pharmacist I&O write -> 403, nothing written (${phIo.status})`)

  /* ---------- the state snapshot for the restart phase ---------- */
  const snap = { io: { p1: await ioRows(P1, e1), p4a: await ioRows(P4, EA), p4b: await ioRows(P4, EB) }, e1, EA, EB, orders: {} }
  for (const pid of [P1, P2, P4, P5]) snap.orders[pid] = (await ordersOf(pid)).map(o => ({ orderId: o.orderId, status: o.status, nursing: o.nursing ?? null, administrations: o.administrations ?? null }))
  snap.round30 = (await orderOf(P1, O.n_30m)).nursing.currentRound
  fs.writeFileSync(SNAP, JSON.stringify(snap, null, 1))
  info(`state snapshot written for the restart phase (${Object.values(snap.orders).flat().length} orders, ${snap.io.p1.length + snap.io.p4a.length} I&O rows)`)
}

if (PHASE === 'post') {
  console.log('== R: after a server restart on the same database — nursing, MAR and I&O state identical')
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'))
  const io = { p1: await ioRows(P1, snap.e1), p4a: await ioRows(P4, snap.EA), p4b: await ioRows(P4, snap.EB) }
  check(JSON.stringify(io) === JSON.stringify(snap.io), `I&O rows identical after restart (Alpha ${io.p1.length}, Delta A ${io.p4a.length}, Delta B ${io.p4b.length})`)
  for (const pid of [P1, P2, P4, P5]) {
    const now = (await ordersOf(pid)).map(o => ({ orderId: o.orderId, status: o.status, nursing: o.nursing ?? null, administrations: o.administrations ?? null }))
    check(JSON.stringify(now) === JSON.stringify(snap.orders[pid]), `${pid}: every order's status, nursing completions/current round and MAR facts identical (${now.length} orders)`)
  }
  const r = await open(NOOR)
  await r.page.goto(`${BASE}/patients/${P1}`)
  const io1 = r.page.locator('.ncpanel .ncio')
  await io1.locator('.iotiles').waitFor({ timeout: 15000 }); await sleep(800)
  const t = (await io1.locator('.iotile .iotv').allTextContents()).map(s => s.trim())
  check(JSON.stringify(t) === JSON.stringify(['360 mL', '120 mL', '+240 mL']) && (await textOf(r.page.locator('.ncpanel .mardoc'))).startsWith('given at '),
    `nurse chart after restart: I&O ${t.join(' / ')}; the Vancomycin dose still "given at …"`)
  await r.page.screenshot({ path: `${OUT}/18-after-restart-nurse-chart.png`, fullPage: true })
  await r.page.goto(`${BASE}/nurse`)
  await ordRow(r.page, O.n_30m).waitFor({ timeout: 15000 })
  const line = await textOf(ordRow(r.page, O.n_30m).locator('.ordround'))
  check([`Round 2 · Next due ${hms24(Date.parse(snap.round30.dueTime))}`, `Round 2 · Due ${hms24(Date.parse(snap.round30.dueTime))}`].some(x => line.startsWith(x)),
    `workspace after restart: the 30-min order keeps its recorded round 2 ("${line}")`)
  check(r.w.errors.length === 0 && r.w.forbidden.length === 0, 'no page errors, no 403 responses')
  await r.ctx.close()
}

await browser.close()
console.log(`\nRESULT: ${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
