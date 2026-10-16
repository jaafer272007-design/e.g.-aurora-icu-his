// Approval fixes (Codex review of 72a7894) — the two FOCUSED browser legs on ONE disposable PRODUCTION
// pairing: the server publish serving a production bundle from wwwroot (same origin), APP_ENV=production,
// disposable PostgreSQL, the synthetic accounts of approval-setup.py (shipped role profiles; nothing granted).
// Every MAR documentation, order read and order create below reaches the REAL server and database. The only
// test-side control is Playwright routing of the browser's own requests (the integration harness's method):
//   M — the MAR refused retry: the page's FIRST Given is held (the page sees no answer; the request is kept and
//       delivered to the real server LATE, with the nurse's own token); the page's RETRY is sent to the real server
//       carrying the disposable Receptionist's token, so the real server refuses it with 403 in RBAC — before the
//       order lock and the attempt lookup; reads are real.
//   N — the New Nursing Order draft across a patient switch: no route control (N1), patient A's order/roster reads
//       held and released after B is shown (N2), and patient A's real create committed by the server with its
//       answer to the page held until B is shown and has its own draft (N3).
// Run once against the PRE-FIX bundle (label pre-fix: the reproduction — FAILs are the defects) and once against
// the corrected bundle (label fixed), on the same database.   node approval-legs.mjs <pre-fix|fixed>
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LABEL = process.argv[2] ?? 'fixed'
const BASE = process.env.NURSING_UI ?? 'http://localhost:8080'
const S = process.env.SCRATCH
const OUT = path.join(process.env.SHOTS ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../screenshots'), LABEL)
fs.mkdirSync(OUT, { recursive: true })
const ST = JSON.parse(fs.readFileSync(path.join(S, 'approval-state.json'), 'utf8'))
const NOOR = ST.accounts['noor.approval'], DOC = ST.accounts['omar.approval'], DANA = ST.accounts['dana.approval']
const A = ST.patients.a, B = ST.patients.b
let passes = 0, fails = 0
const check = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${msg}`); cond ? passes++ : fails++ }
const info = msg => console.log(`  info: ${msg}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, timeout = 10000, step = 100) => { const end = Date.now() + timeout; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(step) } }

/* ---------- the real API + database (node side) ---------- */
const api = async (method, p, tok, body) => {
  const r = await fetch(BASE + p, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const tokens = {}
const token = async acct => (tokens[acct.username] ??= (await api('POST', '/api/auth/login', null, { username: acct.username, password: acct.password })).body.token)
const ordersOf = async pid => (await api('GET', `/api/icu/orders?patientId=${pid}`, await token(DOC))).body
const sql = q => execFileSync('psql', ['-h', 'localhost', '-U', 'aurora', '-d', process.env.NURSING_DB ?? 'aurora_nursing_prod', '-Atq', '-c', q],
  { env: { PGPASSWORD: fs.readFileSync(path.join(S, 'db.pw'), 'utf8').trim(), PATH: process.env.PATH } }).toString().trim()
const dbFacts = oid => JSON.parse(sql(`select coalesce("AdministrationsJson", '[]') from "Orders" where "OrderId" = '${oid}'`) || '[]')

/* ---------- the browser ---------- */
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
async function open(acct) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  ctx.setDefaultTimeout(20000)
  const page = await ctx.newPage()
  const started = new WeakMap(), errors = []
  page.on('request', r => started.set(r, Date.now()))
  page.on('pageerror', e => { errors.push(e.message); console.log(`  page error: ${e.message}`) })
  await page.goto(`${BASE}/login`)
  await page.fill('#lguser', acct.username); await page.fill('#lgpass', acct.password); await page.click('button.lgsubmit')
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 })
  return { ctx, page, started, errors }
}
const textOf = async loc => (await loc.count()) ? ((await loc.first().innerText({ timeout: 3000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim() : ''
const toast = (page, text) => page.locator('.toast.show').filter({ hasText: text })
const overlay = async page => (await page.locator('.envrefusal h1').allTextContents()).join(' | ')

console.log(`# approval legs (${LABEL}) against ${BASE}: ${JSON.stringify((await api('GET', '/healthz')).body)}`)
console.log(`# bundle served: ${LABEL === 'fixed' ? 'corrected source' : 'PRE-FIX reviewed head 72a7894 (reproduction: FAIL lines are the defects)'}; patients A=${A.pid} B=${B.pid}`)

/* ======================= M — MAR: a refused retry of an unresolved PRN Given ======================= */
{
  console.log('== M: PRN Given unanswered -> Retry refused 403 by the real server (RBAC, before the order lock) -> real empty reads -> the original lands late')
  const created = await api('POST', '/api/icu/orders', await token(DOC), { drafts: [{ patientId: A.pid, category: 'Medication', priority: 'Routine',
    medication: { drugId: 'paracetamol', drug: 'Paracetamol', dose: '1 g', route: 'IV', frequency: 'q6h', duration: '5 days', prn: true, prnIndication: `synthetic pain (${LABEL})` } }], sign: true })
  const oid = created.body?.[0]?.orderId
  check(created.status === 200 && created.body[0].status === 'active', `the doctor's PRN paracetamol for A is active (${oid})`)
  const { ctx, page, started, errors } = await open(NOOR)
  await page.waitForURL(u => u.pathname === '/nurse')
  await page.getByRole('button', { name: new RegExp(`^Open chart ${A.name}`) }).click()
  await page.waitForURL(u => u.pathname === `/patients/${A.pid}`)
  const row = () => page.locator('.ncpanel .marrow', { has: page.getByRole('button', { name: 'Paracetamol: given' }) })
  await row().waitFor({ timeout: 15000 })
  const given = () => page.getByRole('button', { name: 'Paracetamol: given' }).first()
  const h = { held: null, seen: [], statuses: [], answeredAt: [] }
  const danaTok = await token(DANA)
  await page.route(`**/api/icu/mar/${oid}/administrations/*`, async route => {
    const req = route.request()
    h.seen.push(JSON.parse(req.postData() ?? 'null'))
    if (!h.held) { h.held = { url: req.url(), headers: await req.allHeaders(), body: req.postData() }; return route.abort('timedout') }   // the page gets no answer
    if (h.seen.length === 2) return route.continue({ headers: { ...(await req.allHeaders()), authorization: `Bearer ${danaTok}` } })   // the retry: a real 403
    return route.continue()                                                                                                          // anything later: as sent
  })
  page.on('response', r => { if (r.url().includes(`/api/icu/mar/${oid}/administrations/`)) { h.statuses.push(r.status()); h.answeredAt.push(Date.now()) } })
  await given().click()
  await row().locator('.marwarn').waitFor({ timeout: 12000 })
  check(h.seen.length === 1 && await given().isDisabled(), 'first Given: no answer -> "Not confirmed", controls locked')
  const ans = page.waitForResponse(r => r.url().includes(`/api/icu/mar/${oid}/administrations/`) && r.request().method() === 'POST', { timeout: 10000 })
  await row().locator('.marretry').click()
  const refusal = await ans
  await until(() => h.answeredAt.length >= 1, 3000, 20)
  const t403 = h.answeredAt[0]   // the page received the refusal (browser event order: any read requested after it starts later)
  const refusalBody = await refusal.json().catch(() => null)
  check(refusal.status() === 403 && refusalBody?.error === 'Insufficient permissions' && h.seen[1]?.attemptId === h.seen[0]?.attemptId,
    `Retry saving sent the SAME attempt (${h.seen[0]?.attemptId}); the real server refused it ${refusal.status()} "${refusalBody?.error}"`)
  /* a real authoritative MAR read STARTED after the refusal, applied */
  const readAfter = await page.waitForResponse(r => r.url().endsWith('/api/icu/mar') && r.request().method() === 'GET' && (started.get(r.request()) ?? 0) > t403, { timeout: 25000 }).then(r => r.status(), () => null)
  info(`a MAR read started after the refusal was answered ${readAfter} by the real server`)
  await sleep(600)
  const facts0 = dbFacts(oid)
  const stored = async () => JSON.parse(await page.evaluate(k => sessionStorage.getItem(k), `aurora.marUnconfirmed:${NOOR.name}`) ?? '[]')
  const noticeText = await textOf(row().locator('.marnotice'))
  check(facts0.length === 0, 'the real record: no fact yet (the original is still held)')
  check(await row().locator('.marwarn').count() === 1, `after a real empty authoritative read: still "Not confirmed" (row: "${(await textOf(row())).slice(0, 160)}")`)
  check(await given().isDisabled() && await page.getByRole('button', { name: 'Paracetamol: held' }).first().isDisabled() && await page.getByRole('button', { name: 'Paracetamol: refused' }).first().isDisabled(),
    'Given / Held / Refused stay disabled')
  check((await stored()).some(x => x.attemptId === h.seen[0].attemptId), 'the SAME attempt is still stored for the nurse (this tab)')
  check(/Insufficient permissions/.test(noticeText) && !/session has expired/i.test(noticeText) && !/\b(give|administer)\b[^.]*\bagain\b/i.test(noticeText),
    `the actual refusal reason is shown, never "session expired", never "give again" ("${noticeText}")`)
  await row().screenshot({ path: `${OUT}/m1-chart-retry-refused-locked.png` })
  /* the Nurse Workspace entry point (client-side navigation: the same controller) */
  await page.locator('button.hback').click()
  await page.waitForURL(u => u.pathname === '/nurse')
  const wrow = page.locator('.ncmar .marrow', { has: page.getByRole('button', { name: 'Paracetamol: given' }) })
  await wrow.waitFor({ timeout: 10000 })
  check(await wrow.locator('.marwarn').count() === 1 && await page.getByRole('button', { name: 'Paracetamol: given' }).first().isDisabled(),
    'Nurse Workspace (navigated, no reload): the same attempt is unconfirmed and locked there too')
  await wrow.screenshot({ path: `${OUT}/m2-workspace-retry-refused-locked.png` })
  await page.goForward(); await page.waitForURL(u => u.pathname === `/patients/${A.pid}`)
  await row().waitFor({ timeout: 10000 })
  /* 390 px: the notice wraps inside the care panel */
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(400)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(overflow <= 0, `390 px: no horizontal page overflow with the refusal notice (${overflow}px)`)
  await page.locator('.ncpanel .ncmar').screenshot({ path: `${OUT}/m3-chart-390-retry-refused.png` })
  await page.setViewportSize({ width: 1440, height: 1000 }); await sleep(300)
  /* "the nurse follows the page": if the controls reopened, she documents the dose (a NEW attempt) */
  if (await given().isEnabled()) {
    info('the page reopened the dose after the refused retry -> the nurse documents it again, as the controls allow')
    await given().click(); await sleep(2500)
  }
  const d = await fetch(h.held.url, { method: 'POST', headers: { authorization: h.held.headers.authorization, 'content-type': 'application/json' }, body: h.held.body })
  check(d.status === 200, `the held ORIGINAL reaches the real server late (nurse's own token) and commits (${d.status})`)
  const confirmed = await toast(page, 'Saved — confirmed').filter({ hasText: 'Paracetamol' }).waitFor({ timeout: 10000 }).then(() => true, () => false)
  await sleep(500)
  const facts = dbFacts(oid)
  check(facts.length === 1, `the real record holds exactly ONE fact (${facts.length}: ${facts.map(f => `${f.Status ?? f.status}/${f.AttemptId ?? f.attemptId}`).join(', ')})`)
  check(facts.length === 1 && (facts[0].AttemptId ?? facts[0].attemptId) === h.seen[0].attemptId, 'it is the original attempt')
  check(confirmed && await given().isEnabled() && await row().locator('.marwarn, .marnotice').count() === 0 && !(await stored()).length,
    'confirmed from the record: "Saved — confirmed", controls reopen, no stale notice, nothing left stored')
  check(h.seen.length === 2, `the page sent exactly the original + its one retry — no new attempt (${h.seen.length} requests; answers ${h.statuses.join(',') || '—'})`)
  check(errors.length === 0 && await overlay(page) === '', 'no page error, no overlay')
  await row().screenshot({ path: `${OUT}/m4-chart-confirmed.png` })
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await ctx.close()
  const dc = await api('POST', `/api/icu/orders/${oid}/discontinue`, await token(DOC), { reason: 'synthetic leg cleanup' })
  info(`cleanup: the doctor discontinued ${oid} (${dc.status})`)
}

/* ======================= N — New Nursing Order across a patient switch ======================= */
{
  const { ctx, page, errors } = await open(DOC)
  const bar = () => textOf(page.locator('.ptbar .ptbarname'))
  const card = () => page.locator('.card', { hasText: 'New Nursing Order' })
  const instr = () => page.locator('#nuInstr')
  const rail = name => page.locator('button.ptrailcard', { has: page.locator('.prname', { hasText: name }) })
  const btn = name => card().getByRole('button', { name, exact: true })
  const list = () => textOf(page.locator('.omcolL'))
  const editorState = async () => (await card().count()) ? {
    instr: await instr().inputValue(), priority: await page.locator('#nuPriority').inputValue(),
    oneTime: await card().getByRole('button', { name: 'One-time' }).getAttribute('aria-pressed'), every: await page.locator('#nuEvery').count(),
    pending: await btn('Pending').isEnabled(), sign: await btn('Sign & order').isEnabled(),
  } : null
  const shown = async (who, pid) => {
    await page.waitForURL(u => u.pathname === `/orders/${pid}`)
    const ok = await until(async () => (await bar()) === who.name && (await card().count()) === 1 && (await list()).includes(`${who.family} baseline`), 12000)
    if (!ok) info(`${who.family}'s page did not settle on its own header + list + editor within 12 s (bar "${await bar()}")`)
    return ok
  }
  const transition = async () => ({ url: new URL(page.url()).pathname, bar: await bar(), editor: await editorState(), list: (await list()).slice(0, 400) })

  console.log('== N1: A\'s typed draft (Urgent, repeat 30 min) and a patient-rail switch to B — no order is written')
  await page.goto(`${BASE}/orders/${A.pid}`); await shown(A, A.pid)
  const draftA = `APPROVAL PROBE — PATIENT A ONLY — DO NOT SIGN (${LABEL})`
  await instr().fill(draftA)
  await page.locator('#nuPriority').selectOption('Urgent')
  await card().getByRole('button', { name: 'Repeat' }).click()
  await page.locator('#nuEvery').fill('30')
  await card().getByRole('combobox', { name: 'Interval unit' }).selectOption('minutes')
  check(await btn('Sign & order').isEnabled(), 'A: a complete draft enables Sign & order')
  await card().screenshot({ path: `${OUT}/n1-a-draft.png` })
  await rail(B.name).click()
  await page.waitForURL(u => u.pathname === `/orders/${B.pid}`)
  const t1 = await transition()
  info(`first sample after the switch: ${JSON.stringify({ url: t1.url, bar: t1.bar, editor: t1.editor })}`)
  check(!(t1.bar === A.name && (t1.editor?.pending || t1.editor?.sign)) && t1.editor?.instr !== draftA,
    'during the switch: no A display with an enabled submit under B\'s route, no A draft')
  await shown(B, B.pid)
  const eb = await editorState()
  check(eb && eb.instr === '' && eb.priority === 'Routine' && eb.oneTime === 'true' && eb.every === 0 && !eb.pending && !eb.sign,
    `B: a clean one-time / Routine editor, submit disabled (${JSON.stringify(eb)})`)
  const pageText = await page.evaluate(() => `${document.querySelector('main').innerText} ${[...document.querySelectorAll('main textarea, main input')].map(e => e.value).join(' ')}`)
  check(!pageText.includes('PATIENT A ONLY'), 'B: A\'s draft text appears nowhere on B\'s page (text or any field value)')
  await card().screenshot({ path: `${OUT}/n1-b-clean-editor.png` })
  await instr().fill('Bravo: own valid instruction')
  check(await btn('Sign & order').isEnabled(), 'B: submit enables only with B\'s own valid input')
  await instr().fill('')
  await rail(A.name).click(); await shown(A, A.pid)
  const ea = await editorState()
  check(ea && ea.instr === '' && ea.priority === 'Routine' && ea.oneTime === 'true', `back on A: no A draft revived (${JSON.stringify(ea)})`)
  const probeOrders = [...await ordersOf(A.pid), ...await ordersOf(B.pid)].filter(o => (o.summary ?? '').includes('PATIENT A ONLY'))
  check(probeOrders.length === 0, 'the real record: no order carries the probe text (nothing was written)')

  console.log('== N2: A\'s order + roster reads held, released after B is shown with its own draft')
  await rail(B.name).click(); await shown(B, B.pid)
  const gate = { open: null, held: [] }
  const released = new Promise(r => { gate.open = r })
  let rosterArmed = true
  await page.route(u => /\/api\/icu\/orders\?patientId=/.test(u.toString()) || u.pathname === '/api/icu/patients', async route => {
    const u = route.request().url()
    const isA = u.includes(`/api/icu/orders?patientId=${A.pid}`)
    const isRoster = new URL(u).pathname === '/api/icu/patients' && rosterArmed
    if (route.request().method() !== 'GET' || (!isA && !isRoster)) return route.fallback()
    if (isRoster) rosterArmed = false
    gate.held.push(u); await released; await route.continue().catch(() => {})
  })
  const tHold = Date.now()
  await rail(A.name).click()
  await page.waitForURL(u => u.pathname === `/orders/${A.pid}`)
  await sleep(150)
  const t2 = await transition()
  info(`A routed, its reads held: ${JSON.stringify({ url: t2.url, bar: t2.bar, editor: t2.editor })}`)
  check(!(t2.bar === B.name && (t2.editor?.pending || t2.editor?.sign)) && !(t2.list.includes('Bravo baseline')),
    'while A\'s reads are held: no B display (header / list / enabled editor) under A\'s route')
  await rail(B.name).click(); await shown(B, B.pid)
  const draftB = `Bravo draft kept while A's reads land (${LABEL})`
  await instr().fill(draftB)
  info(`held: ${gate.held.join(' | ')}`)
  gate.open(); await page.unrouteAll({ behavior: 'wait' })
  info(`released after ${Date.now() - tHold} ms (under the client's 8 s read timeout)`)
  await sleep(1500)
  const after2 = await transition()
  check(after2.url === `/orders/${B.pid}` && after2.bar === B.name, `after A's late reads: still B's header (${after2.bar})`)
  check(after2.list.includes('Bravo baseline') && !after2.list.includes('Alpha baseline'), 'after A\'s late reads: still B\'s order list (no Alpha order)')
  check(after2.editor?.instr === draftB, `after A's late reads: B's draft is intact ("${after2.editor?.instr}")`)
  await page.screenshot({ path: `${OUT}/n2-b-after-late-a-reads.png`, fullPage: true })
  await instr().fill('')

  console.log('== N3: A\'s real create committed, its answer held while B is shown and gets its own draft')
  await rail(A.name).click(); await shown(A, A.pid)
  const inflightA = `APPROVAL A in-flight create (${LABEL})`, draftB3 = `APPROVAL B draft must stay (${LABEL})`
  const g3 = { open: null, server: null }
  const rel3 = new Promise(r => { g3.open = r })
  await page.route('**/api/icu/orders', async route => {
    const req = route.request()
    const body = JSON.parse(req.postData() ?? 'null')
    if (req.method() !== 'POST' || body?.drafts?.[0]?.patientId !== A.pid) return route.fallback()
    const resp = await route.fetch()                       // the REAL server creates it now
    g3.server = { status: resp.status(), body: await resp.json().catch(() => null) }
    await rel3                                             // the page gets the answer only later
    await route.fulfill({ response: resp }).catch(() => {})
  })
  await instr().fill(inflightA)
  const tCreate = Date.now()
  await btn('Sign & order').click()
  await until(() => g3.server, 6000, 50)
  check(g3.server?.status === 200 && g3.server.body?.[0]?.patientId === A.pid, `the real server created A's order (${g3.server?.status}, ${g3.server?.body?.[0]?.orderId}); the page has no answer yet`)
  await rail(B.name).click(); await shown(B, B.pid)
  await instr().fill(draftB3)
  g3.open(); info(`A's answer released ${Date.now() - tCreate} ms after the click`)
  const t3 = await toast(page, 'Nursing order').filter({ hasText: inflightA }).waitFor({ timeout: 8000 }).then(async () => textOf(page.locator('.toast.show')), () => '')
  info(`toast: "${t3}"`)
  await sleep(1500)
  const after3 = await transition()
  check(after3.bar === B.name && after3.url === `/orders/${B.pid}`, 'after A\'s answer: still B\'s header')
  check(after3.editor?.instr === draftB3, `after A's answer: B's draft is not cleared or replaced ("${after3.editor?.instr}")`)
  check(after3.list.includes('Bravo baseline') && !after3.list.includes(inflightA) && !after3.list.includes('Alpha baseline'), 'after A\'s answer: B\'s list is not refreshed with A\'s orders')
  const aOrders = (await ordersOf(A.pid)).filter(o => o.summary === inflightA), bOrders = (await ordersOf(B.pid)).filter(o => o.summary === inflightA || o.summary === draftB3)
  check(aOrders.length === 1 && aOrders[0].patientId === A.pid && aOrders[0].status === 'active' && bOrders.length === 0,
    `the real record: exactly one "${inflightA}" order, for A (${aOrders.map(o => o.orderId).join(',')}); none on B; B's draft never sent`)
  await page.screenshot({ path: `${OUT}/n3-b-after-a-answer.png`, fullPage: true })
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await rail(A.name).click(); await shown(A, A.pid)
  check((await list()).includes(inflightA) && (await editorState())?.instr === '', 'back on A: its new order is listed; its editor is empty')
  check(errors.length === 0 && await overlay(page) === '', 'no page error, no overlay')
  await ctx.close()
}

await browser.close()
console.log(`RESULT ${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
