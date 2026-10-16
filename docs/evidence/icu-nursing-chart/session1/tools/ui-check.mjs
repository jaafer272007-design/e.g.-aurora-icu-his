// Browser check of the Orders & Medication nursing UI against the REAL API (synthetic data,
// local only). Topology = the appliance: a PRODUCTION bundle (VITE_APP_ENV=production) served
// by the server itself from wwwroot, same-origin — so a 401 is the production refusal path.
//   doctor : New Nursing Order (one-time / repeat / interval validation / Pending / Sign & order),
//            the Nursing type filter; no Done control
//   nurse  : no order form; Done on a one-time and a repeating order; the exact unlock of the next
//            round without a reload; CONTROLLED TRANSPORT (Amendment 1 §9.2): the original request
//            is held (the page sees no answer) -> Not confirmed; the 5 s re-check proves nothing;
//            Retry with an EXPIRED session (the real server answers 401) stays unconfirmed; the
//            held original then reaches the server and commits -> the page confirms it from the
//            authoritative read; exactly one completion. A legacy order keeps ✓ Implement.
//   screenshots: light, dark, narrow (390 px).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.NURSING_UI ?? 'http://localhost:8080'
const OUT = process.env.SHOTS ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../screenshots')
// prod-setup.py's output (scratchpad only): the patient, the legacy-style order, the synthetic accounts
const state = JSON.parse(fs.readFileSync(path.join(process.env.SCRATCH, 'prod-state.json'), 'utf8'))
const PID = state.pid, LEGACY_PID = state.legacyPid, LEGACY_ORDER = state.legacyOrder
const DOCTOR = state.doctor, NURSE = state.nurse
const passwordOf = u => [DOCTOR, NURSE].find(a => a.username === u).password
fs.mkdirSync(OUT, { recursive: true })
let passes = 0, fails = 0
const check = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${msg}`); cond ? passes++ : fails++ }
const run = new Date().toISOString().slice(11, 19).replaceAll(':', '')

const api = async (method, p, token, body) => {
  const r = await fetch(BASE + p, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const token = async u => (await api('POST', '/api/auth/login', null, { username: u, password: passwordOf(u) })).body.token
const NUR_TOKEN = await token(NURSE.username)
const orderOf = async oid => (await api('GET', `/api/icu/orders?patientId=${PID}`, NUR_TOKEN)).body.find(o => o.orderId === oid)
const findBySummary = async s => (await api('GET', `/api/icu/orders?patientId=${PID}`, NUR_TOKEN)).body.filter(o => o.summary === s)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
async function signIn(user, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...opts })
  const page = await ctx.newPage()
  page.on('pageerror', e => { console.log(`  page error: ${e.message}`); fails++ })
  await page.goto(`${BASE}/login`)
  await page.fill('#lguser', user)
  await page.fill('#lgpass', passwordOf(user))
  await page.click('button.lgsubmit')
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 })
  return { ctx, page }
}
const row = (page, oid) => page.locator('.oorow', { has: page.locator('.oor2', { hasText: oid }) })
const toast = page => page.locator('.toast.show')

/* ================= doctor ================= */
console.log('== doctor: New Nursing Order + Nursing filter')
const doc = await signIn(DOCTOR.username)
const dp = doc.page
await dp.goto(`${BASE}/orders/${PID}`)
const card = dp.locator('.card', { hasText: 'New Nursing Order' })
await card.waitFor()
const signBtn = card.getByRole('button', { name: 'Sign & order' }), pendBtn = card.getByRole('button', { name: 'Pending' })
check(await signBtn.isDisabled() && await pendBtn.isDisabled(), 'instructions empty -> Pending and Sign & order disabled')
check(await card.getByRole('button', { name: 'One-time' }).getAttribute('aria-pressed') === 'true', 'ONE-TIME is the default schedule')
await card.locator('#nuInstr').fill(`UI one-time check ${run}`)
await card.locator('#nuPriority').selectOption('Urgent')
await card.screenshot({ path: `${OUT}/01-doctor-nursing-form-one-time.png` })
await signBtn.click()
await toast(dp).filter({ hasText: `UI one-time check ${run}` }).filter({ hasText: 'Nursing order signed & active' }).waitFor()
const [oneTime] = await findBySummary(`UI one-time check ${run}`)
check(oneTime && oneTime.status === 'active' && oneTime.priority === 'Urgent' && oneTime.nursing.intervalMinutes === undefined && oneTime.nursing.currentRound?.number === 1,
  `one-time order created + signed through the form (${oneTime?.orderId}; Urgent; round 1 open)`)
check(await card.locator('#nuInstr').inputValue() === '', 'the form resets after a successful create')

await card.getByRole('button', { name: 'Repeat' }).click()
await card.locator('#nuInstr').fill(`UI repeating check ${run}`)
const every = card.locator('#nuEvery'), unit = card.getByLabel('Interval unit'), hint = card.locator('#nuEveryHint')
for (const [v, u, label] of [['0', 'minutes', '0 minutes'], ['49', 'hours', '49 hours'], ['2.5', 'hours', '2.5 hours'], ['2881', 'minutes', '2881 minutes']]) {
  await every.fill(v); await unit.selectOption(u)
  check(await hint.textContent() === 'Enter a whole number from 1 minute to 48 hours.' && await signBtn.isDisabled() && await every.getAttribute('aria-invalid') === 'true',
    `interval ${label} refused in the form (hint, aria-invalid, buttons disabled)`)
}
await every.fill('48'); await unit.selectOption('hours')
check((await hint.textContent()).startsWith('Due again 48 h after each completion') && await signBtn.isEnabled(), 'interval 48 hours accepted')
await every.fill('1'); await unit.selectOption('minutes')
check((await hint.textContent()).startsWith('Due again 1 min after each completion'), 'interval 1 minute accepted')
await card.screenshot({ path: `${OUT}/02-doctor-nursing-form-repeat.png` })
await signBtn.click()
await toast(dp).filter({ hasText: `UI repeating check ${run}` }).filter({ hasText: 'Nursing order signed & active' }).waitFor()
const [rep] = await findBySummary(`UI repeating check ${run}`)
check(rep && rep.status === 'active' && rep.nursing.intervalMinutes === 1 && rep.nursing.currentRound?.number === 1, `repeating 1-minute order created + signed (${rep?.orderId})`)
await card.getByRole('button', { name: 'Repeat' }).click()
await card.locator('#nuInstr').fill(`UI pending check ${run}`)
await every.fill('2'); await unit.selectOption('hours')
await pendBtn.click()
await toast(dp).filter({ hasText: `UI pending check ${run}` }).filter({ hasText: 'Nursing order saved as pending' }).waitFor()
const [pend] = await findBySummary(`UI pending check ${run}`)
check(pend && pend.status === 'pending' && pend.nursing.intervalMinutes === 120 && pend.nursing.currentRound === undefined, `Pending repeating order (every 2 h; no current round) (${pend?.orderId})`)

await dp.locator('.oftypes').getByRole('button', { name: 'Nursing' }).click()
await dp.waitForTimeout(300)
const nursingApi = (await api('GET', `/api/icu/orders?patientId=${PID}`, NUR_TOKEN)).body.filter(o => o.category === 'Nursing').length
const badges = await dp.locator('.orderlist .oorow .oor1 > :first-child').allTextContents()
check(badges.length === nursingApi && badges.every(b => b === 'NURSING'), `Nursing filter: ${badges.length} rows, all NURSING (API: ${nursingApi} nursing orders)`)
check(await dp.getByRole('button', { name: /^(Done: round|Round \d+ of order)/ }).count() === 0 && await dp.getByText('✓ Done', { exact: false }).count() === 0,
  'the doctor has no Done control (orders.implement is nursing)')
await dp.locator('.omcolL').screenshot({ path: `${OUT}/03-doctor-order-list-nursing-filter.png` })

/* ================= nurse ================= */
console.log('== nurse: Done, exact unlock')
const nur = await signIn(NURSE.username)
const np = nur.page
await np.goto(`${BASE}/orders/${PID}`)
await row(np, oneTime.orderId).waitFor()
check(await np.locator('.card', { hasText: 'New Nursing Order' }).count() === 0, 'the nurse has no order form')
const oneRow = row(np, oneTime.orderId)
check((await oneRow.locator('.oonurse').textContent()).includes('One-time') && (await oneRow.locator('.oonurse').textContent()).includes('round 1 due'), 'one-time row: "One-time · round 1 due … · OPEN"')
const oneDone = oneRow.getByRole('button', { name: `Done: round 1 of order ${oneTime.orderId}` })
check(await oneDone.textContent() === '✓ Done · round 1', `one-time row control reads "${await oneDone.textContent()}"`)
await oneDone.click()
await toast(np).filter({ hasText: 'Done' }).waitFor()
await oneRow.locator('.oostatus', { hasText: /completed/i }).waitFor({ timeout: 10000 })
const oneAfter = await orderOf(oneTime.orderId)
check(oneAfter.status === 'completed' && oneAfter.nursing.completions.length === 1 && oneAfter.nursing.completions[0].completedBy === NURSE.name, 'one-time Done -> completed, one completion by the signed-in nurse')

const repRow = row(np, rep.orderId)
await repRow.getByRole('button', { name: `Done: round 1 of order ${rep.orderId}` }).click()
await toast(np).filter({ hasText: 'Done' }).waitFor()
const opens = repRow.getByRole('button', { name: /opens at/ })
await opens.waitFor({ timeout: 10000 })
const r1 = await orderOf(rep.orderId)
const c1 = r1.nursing.completions[0], due2 = Date.parse(r1.nursing.currentRound.dueTime)
check(due2 === Date.parse(c1.completedTime) + 60_000, `round 2 due = completion 1 (${c1.completedTime}) + 60 000 ms`)
check(await opens.isDisabled() && (await opens.textContent()).startsWith('Opens '), `the control shows "${await opens.textContent()}", disabled`)
await repRow.scrollIntoViewIfNeeded()
await repRow.screenshot({ path: `${OUT}/04-nurse-round-locked-row.png` })
/* the page itself records the instant the Done control appears (no polling latency) */
await np.evaluate(label => {
  window.__flip = null
  new MutationObserver((_, obs) => {
    if (document.querySelector(`button[aria-label="${label}"]`)) { window.__flip = Date.now(); obs.disconnect() }
  }).observe(document.body, { subtree: true, childList: true, attributes: true })
}, `Done: round 2 of order ${rep.orderId}`)
while (Date.now() < due2 - 400) await np.waitForTimeout(50)
check(await repRow.getByRole('button', { name: /^Done: round/ }).count() === 0 && await opens.isDisabled(), 'still locked 400 ms before the due instant')
const doneBtn = repRow.getByRole('button', { name: `Done: round 2 of order ${rep.orderId}` })
await doneBtn.waitFor({ timeout: 5000 })
const flippedAt = await np.evaluate(() => window.__flip)
check(flippedAt !== null && flippedAt >= due2 && flippedAt - due2 < 250, `unlocked without a reload ${flippedAt - due2} ms after the due instant, measured in the page (never before)`)

console.log('== nurse: controlled transport — held original, expired-session retry, original commits')
const implPath = `/api/icu/orders/${rep.orderId}/implement`
const seen = []
let held = null
await np.route(`**${implPath}`, async route => {
  const req = route.request()
  seen.push(JSON.parse(req.postData()))
  if (seen.length === 1) {               // the ORIGINAL: kept for later delivery; the page gets no answer
    held = { headers: await req.allHeaders(), body: req.postData() }
    await route.abort('timedout')
  } else {                               // the RETRY: sent to the real server with an expired session
    await route.continue({ headers: { ...(await req.allHeaders()), authorization: 'Bearer expired.session.token' } })
  }
})
await doneBtn.click()
await toast(np).filter({ hasText: 'Save not confirmed' }).waitFor()
await repRow.getByRole('button', { name: /Retry saving/ }).waitFor()
check(await repRow.getByRole('button', { name: /^Completing round 2/ }).textContent() === 'Not confirmed', 'no answer -> "Not confirmed" with ↻ Retry saving')
check((await orderOf(rep.orderId)).nursing.completions.length === 1, 'the server holds no round-2 completion yet (the original is in flight)')
await np.waitForTimeout(6500)
check(await repRow.getByRole('button', { name: /Retry saving/ }).count() === 1, 'after the 5 s authoritative re-check: still Not confirmed (an absent completion is not proof)')
await repRow.getByRole('button', { name: /Retry saving/ }).click()
const note = repRow.locator('.oonursenote')
await note.filter({ hasText: 'session has expired' }).waitFor()
check(seen.length === 2 && seen[1].roundId === seen[0].roundId && seen[1].attemptId === seen[0].attemptId && seen[0].roundId === r1.nursing.currentRound.roundId,
  `the retry re-sent the SAME { roundId, attemptId } (${seen[0].roundId} / ${seen[0].attemptId})`)
check(await note.textContent() === 'Not confirmed — your session has expired — sign in again, then retry saving.', `the 401 retry is shown: "${await note.textContent()}"`)
check(await repRow.getByRole('button', { name: /Retry saving/ }).count() === 1 && await repRow.getByRole('button', { name: /^Done: round/ }).count() === 0,
  'after the refused retry the save is STILL unconfirmed (Retry offered, no new Done)')
check((await orderOf(rep.orderId)).nursing.completions.length === 1, 'the 401 retry wrote nothing')
await toast(np).filter({ hasText: 'Save still not confirmed' }).waitFor()
await repRow.scrollIntoViewIfNeeded()
await repRow.screenshot({ path: `${OUT}/05-nurse-unconfirmed-after-401-retry-row.png` })
await np.screenshot({ path: `${OUT}/05b-nurse-unconfirmed-after-401-retry-page.png` })

const deliveredAt = Date.now()
const delivered = await fetch(BASE + implPath, { method: 'POST', headers: { authorization: held.headers.authorization, 'content-type': 'application/json' }, body: held.body })
const dbody = await delivered.json()
check(delivered.status === 200 && dbody.nursing.completions.some(c => c.attemptId === seen[0].attemptId), `the held ORIGINAL reaches the server late and commits (${delivered.status})`)
await toast(np).filter({ hasText: 'Saved — confirmed' }).waitFor({ timeout: 8000 })
const confirmedAt = Date.now()
await note.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
check(await note.count() === 0 && await repRow.getByRole('button', { name: /Retry saving/ }).count() === 0, 'the page confirmed it from the authoritative read (notice cleared, Retry gone)')
const r2 = await orderOf(rep.orderId)
const mine = r2.nursing.completions.filter(c => c.attemptId === seen[0].attemptId)
check(r2.nursing.completions.length === 2 && mine.length === 1 && mine[0].round === 2 && r2.nursing.currentRound.number === 3, 'exactly ONE round-2 completion (the original); round 3 current')
await repRow.getByRole('button', { name: /opens at/ }).waitFor()
check(confirmedAt - deliveredAt <= 6000, `confirmed ${confirmedAt - deliveredAt} ms after the original committed (5 s re-check); the row is back to "${await repRow.getByRole('button', { name: /opens at/ }).textContent()}"`)
await np.unroute(`**${implPath}`)
await repRow.scrollIntoViewIfNeeded()
await repRow.screenshot({ path: `${OUT}/06-nurse-confirmed-after-original-commits-row.png` })

console.log('== nurse: a legacy order keeps ✓ Implement')
await np.goto(`${BASE}/orders/${LEGACY_PID}`)
const legRow = row(np, LEGACY_ORDER)
await legRow.waitFor()
check(await legRow.getByRole('button', { name: `Implement order ${LEGACY_ORDER}` }).count() === 1 && await legRow.locator('.oonurse').count() === 0 && await legRow.getByRole('button', { name: /Done/ }).count() === 0,
  `legacy ${LEGACY_ORDER}: ✓ Implement, no nursing line, no Done`)
await legRow.getByRole('button', { name: `Implement order ${LEGACY_ORDER}` }).click()
await toast(np).filter({ hasText: 'Order implemented' }).waitFor()
const leg = (await api('GET', `/api/icu/orders?patientId=${LEGACY_PID}`, NUR_TOKEN)).body.find(o => o.orderId === LEGACY_ORDER)
check(leg.status === 'completed' && leg.nursing === undefined, 'legacy Implement (the empty request) still completes it; no nursing data invented')
const mar = (await api('GET', '/api/icu/mar', NUR_TOKEN)).body
check(!mar.some(m => [oneTime.orderId, rep.orderId].includes(m.orderId)), 'no nursing order is on the MAR')

console.log('== screenshots: dark, narrow')
const dark = await signIn(NURSE.username, { colorScheme: 'dark' })
await dark.page.goto(`${BASE}/orders/${PID}`)
await row(dark.page, rep.orderId).waitFor()
await dark.page.locator('.oftypes').getByRole('button', { name: 'Nursing' }).click()
await dark.page.locator('.oftypes button[aria-pressed="true"]', { hasText: 'Nursing' }).waitFor()
await row(dark.page, rep.orderId).scrollIntoViewIfNeeded()
check(await dark.page.evaluate(() => document.documentElement.dataset.theme) !== 'light' && await dp.evaluate(() => document.documentElement.dataset.theme) === 'light',
  'dark and light themes both rendered (device preference)')
await dark.page.screenshot({ path: `${OUT}/07-nurse-orders-dark.png`, fullPage: false })
const narrow = await signIn(DOCTOR.username, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await narrow.page.goto(`${BASE}/orders/${PID}`)
const ncard = narrow.page.locator('.card', { hasText: 'New Nursing Order' })
await ncard.waitFor()
await ncard.getByRole('button', { name: 'Repeat' }).click()
await ncard.locator('#nuEvery').fill('45'); await ncard.getByLabel('Interval unit').selectOption('minutes')
await ncard.scrollIntoViewIfNeeded()
const cardOverflow = await ncard.evaluate(el => [el, ...el.querySelectorAll('*')].reduce((m, e) => Math.max(m, e.scrollWidth - e.clientWidth), 0))
const pageOverflow = await narrow.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(cardOverflow <= 0, `narrow 390 px: nothing in the New Nursing Order card overflows (max ${cardOverflow} px)`)
const offenders = await narrow.page.evaluate(() => [...document.querySelectorAll('body *')]
  .filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !(e.parentElement && e.parentElement.getBoundingClientRect().right > window.innerWidth + 1))
  .map(e => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`).slice(0, 6))
console.log(`  info: page-level horizontal overflow at 390 px = ${pageOverflow} px; outermost overflowing elements: ${offenders.join(', ') || 'none'}`)
await ncard.screenshot({ path: `${OUT}/08-doctor-nursing-form-narrow.png` })
await row(narrow.page, rep.orderId).scrollIntoViewIfNeeded()
await row(narrow.page, rep.orderId).screenshot({ path: `${OUT}/09-order-row-narrow.png` })

await browser.close()
console.log(`\nRESULT: ${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
