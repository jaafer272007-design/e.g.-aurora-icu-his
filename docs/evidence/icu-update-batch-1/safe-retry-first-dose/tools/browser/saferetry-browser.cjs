// Browser check (Chromium) of SAFE RETRY + FIRST DOSE on the live local stack (server
// zone Asia/Baghdad, browser device zone UTC), synthetic data from saferetry-setup.py.
// The TRANSPORT is controlled with Playwright routes, against the real page code:
//  - interceptOriginal: the page's documentation POST is captured verbatim and the page
//    gets NO answer (network failure); the harness later sends that exact request to the
//    server itself — "the original request was still processing and commits later";
//  - the out-of-order case holds one MAR read (fetched before the original commits) and
//    releases it AFTER a newer read has been applied.
// Scenarios: F (first dose / once open; subsequent + legacy rounds locked), S1 (delayed
// original + retry), S1b (delayed original lands by itself), S2 (out-of-order settlement
// reads), S3 (lost original, reload, retry). Each ends with an INTENTIONAL later
// documentation on the same PRN/continuous order (a new attempt).
// "The nurse follows the page": when the page offers "Retry saving" the harness uses it;
// when the page says the dose was NOT recorded and reopens it, the harness documents it
// again — what a nurse is told to do. That is how the pre-change build (run with
// ONLY=S1,S2 to reproduce Codex's two failures) ends with two facts for one dose.
// Usage: node saferetry-browser.cjs <shotsDir> <saferetry-setup.json> [ONLY e.g. S1,S2]
const { chromium, BASE, login } = require('../../../sidebar-mar-cards/tools/browser/lib.cjs')
const fs = require('fs')
const [SHOTS, SETUP, ONLY] = process.argv.slice(2)
const only = ONLY ? new Set(ONLY.split(',')) : null
const wants = k => !only || only.has(k)
const setup = JSON.parse(fs.readFileSync(SETUP, 'utf8'))
const { pid } = setup
const O = Object.fromEntries(Object.entries(setup.orders).map(([k, v]) => [k, v.oid]))
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
let passes = 0, fails = 0
const check = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
const wireMs = s => Date.parse(s.replace(' ', 'T') + ':00Z')
const wireOf = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
const hospHm = ms => new Date(ms + 3 * 3600_000).toISOString().slice(11, 16)   // Asia/Baghdad = UTC+3 (no DST)
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)))
const since = t => ((Date.now() - t) / 1000).toFixed(1)
async function waitFor(fn, ms, step = 50) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step) } return null }
const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
async function renderedContrast(page, selector) {   // one-action-per-round's rendered-pixel method (centred, unobstructed)
  const out = []
  for (const el of await page.$$(selector)) {
    if (!(await el.isVisible())) continue
    const clear = await el.evaluate(e => {
      e.scrollIntoView({ block: 'center' })
      const r = e.getBoundingClientRect(), top = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2)
      return !!top && (e === top || e.contains(top))
    })
    if (!clear) { out.push({ t: (await el.textContent()).trim().slice(0, 30), cr: NaN }); continue }
    const b64 = (await el.screenshot()).toString('base64')
    const r = await page.evaluate(async ([b64, fg]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const x = c.getContext('2d'); x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, c.width, c.height).data, hist = new Map()
      for (let i = 0; i < d.length; i += 4) { const k = `${d[i] >> 2},${d[i + 1] >> 2},${d[i + 2] >> 2}`; hist.set(k, (hist.get(k) || 0) + 1) }
      const [k] = [...hist.entries()].sort((a, b) => b[1] - a[1])[0]
      return { bg: `rgb(${k.split(',').map(v => (Number(v) << 2) + 2).join(', ')})`, fg }
    }, [b64, await el.evaluate(e => getComputedStyle(e).color)])
    out.push({ t: (await el.textContent()).trim().slice(0, 30), cr: contrast(r.fg, r.bg) })
  }
  return out
}
/* the API, as the harness / another station (node fetch, nurse token) */
let TOK = null
async function api(method, path, body) {
  if (!TOK) TOK = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'maya.chen', password: 'Aurora2026!' }) })).json()).token
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const orderOf = async oid => (await api('GET', `/api/icu/orders?patientId=${pid}`)).body.find(o => o.orderId === oid)
const facts = async oid => ((await orderOf(oid)).administrations ?? []).filter(a => a.status !== 'scheduled')
const audit = async oid => (await orderOf(oid)).history.filter(e => ['administered', 'held', 'refused'].includes(e.action))
/* the order's ONE actionable row on the page */
const sel = (oid, what = '') => `.mardaycard[id^="mar-${pid}-${oid}-"] .maracts ${what}`.trim()
const retrySel = oid => `.mardaycard[id^="mar-${pid}-${oid}-"] .marretry`
const rowState = (page, oid) => page.evaluate(([p, o]) => {
  const acts = [...document.querySelectorAll(`.mardaycard[id^="mar-${p}-${o}-"] .maracts`)]
  const docRows = document.querySelectorAll(`.mardaycard[id^="mar-${p}-${o}-"] .marrow:not(:has(.maracts))`).length
  if (acts.length !== 1) return { groups: acts.length, docRows }
  const row = acts[0].closest('.marrow')
  return {
    groups: 1, docRows, disabled: [...acts[0].querySelectorAll('button')].map(b => b.disabled),
    round: row.querySelector('.marround')?.textContent ?? null, label: row.querySelector('.marstate')?.textContent,
    lock: row.querySelector('.marlockline')?.textContent ?? null, route: row.querySelector('.mroute')?.textContent ?? null,
    retry: !!row.querySelector('.marretry'),
  }
}, [pid, oid])
const posts = []
const postsFor = oid => posts.filter(p => p.url.includes(`/mar/${oid}/administrations/`))
const toasts = (page, from = 0) => page.evaluate(f => window.__toasts.slice(f), from)
/** capture the page's next documentation POST for this order verbatim; the page gets no answer */
async function interceptOriginal(page, oid) {
  const box = { req: null, t: 0 }
  await page.route(`**/api/icu/mar/${oid}/administrations/**`, async route => {
    const r = route.request()
    box.req = { url: r.url(), auth: r.headers()['authorization'], body: r.postData() }
    box.t = Date.now()
    await route.abort('failed')
  }, { times: 1 })
  return box
}
/** the original request, sent to the server now — exactly as the page sent it */
async function sendOriginal(req) {
  const r = await fetch(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.auth }, body: req.body })
  return { status: r.status, body: await r.json().catch(() => null) }
}
async function groupShot(p, path) {   // this synthetic patient's MAR group only
  const vp = p.viewportSize()
  await p.setViewportSize({ width: vp.width, height: 2400 })
  const id = await p.evaluate(pp => document.querySelector(`.mardaycard[id^="mar-${pp}-"]`).id, pid)
  await p.evaluate(i => { const g = document.getElementById(i).closest('.margroup'); document.querySelectorAll('.margroup').forEach(x => { if (x !== g) x.style.display = 'none' }); g.scrollIntoView({ block: 'start' }) }, id)
  await p.waitForTimeout(300)
  const box = await (await p.$(`.margroup:has(#${id})`)).boundingBox()
  await p.screenshot({ path, clip: { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: Math.min(box.width + 12, p.viewportSize().width), height: Math.min(box.height + 12, 2400 - Math.max(0, box.y - 6)) } })
  await p.evaluate(() => document.querySelectorAll('.margroup').forEach(x => { x.style.display = '' }))
  await p.setViewportSize(vp)
}
async function openNurse(browser, opts, initPending) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, colorScheme: 'dark', timezoneId: 'UTC', ...opts })
  await ctx.addInitScript(([pending]) => {
    window.__toasts = []
    if (pending) { try { for (const [k, v] of pending) sessionStorage.setItem(k, v) } catch { /* */ } }
    new MutationObserver(() => {
      const t = document.querySelector('.toast.show b')
      const s = t && `${t.textContent}|${t.nextElementSibling?.textContent ?? ''}`
      if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s)
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
  }, [initPending ?? null])
  const page = await ctx.newPage()
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/administrations/')) posts.push({ url: r.url(), body: r.postData(), t: Date.now() }) })
  await login(page, 'maya.chen'); await page.goto(BASE + '/nurse'); await page.waitForLoadState('networkidle')
  await page.waitForSelector(sel(O.PRNDELAY))
  await page.mouse.move(1400, 1300)
  return { ctx, page }
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE })
  console.log(`setup ${pid} at ${setup.setupAtUtc} UTC; browser device zone UTC; scenarios: ${only ? [...only].join(',') : 'all'}`)
  const { ctx, page } = await openNurse(browser)
  let s

  if (wants('F')) {
    console.log('\n[F] FIRST DOSE open on signing (round 1 and the once dose); subsequent and legacy rounds stay locked')
    const fd = setup.orders.FIRST, od = setup.orders.ONCE, l2 = setup.orders.LOCK2, lg = setup.orders.LEGACY
    check(fd.firstDose === true && od.firstDose === true && !l2.firstDose && !lg.firstDose,
      `MAR rows: firstDose on FIRST and ONCE only (FIRST ${fd.firstDose}, ONCE ${od.firstDose}, LOCK2 ${l2.firstDose}, LEGACY ${lg.firstDose})`)
    s = await rowState(page, O.FIRST)
    check(Date.now() < wireMs(fd.due) && s.round === 'round 1' && s.disabled.every(d => !d) && s.route.includes('first dose — available now') && !s.lock,
      `FIRST round 1 (scheduled ${hospHm(wireMs(fd.due))} hospital, ${Math.round((wireMs(fd.due) - Date.now()) / 60000)} min away): Given/Held/Refused OPEN — "${s.route}"`)
    s = await rowState(page, O.ONCE)
    check(Date.now() < wireMs(od.due) && s.disabled.every(d => !d) && s.route.includes('first dose'), `ONCE dose (scheduled ${hospHm(wireMs(od.due))}): open — "${s.route}"`)
    s = await rowState(page, O.LOCK2)
    check(s.round === 'round 2' && s.disabled.every(Boolean) && s.lock?.includes(`Opens ${hospHm(wireMs(l2.due))}`), `LOCK2 round 2 (a subsequent round): locked — "${s.lock}"`)
    s = await rowState(page, O.LEGACY)
    check(s.round === 'round 1' && s.disabled.every(Boolean) && s.lock?.includes(`Opens ${hospHm(wireMs(lg.due))}`) && lg.due === wireOf(wireMs(lg.legacySlot) + 3600_000),
      `LEGACY round 1 = the slot after its legacy fact's (${hospHm(wireMs(lg.due))}), not a first dose: locked — "${s.lock}"`)
    await page.evaluate(([a, b]) => [a, b].forEach(x => document.querySelectorAll(`${x} button`).forEach(btn => btn.click())), [sel(O.LOCK2), sel(O.LEGACY)])
    await page.waitForTimeout(400)
    check(postsFor(O.LOCK2).length === 0 && postsFor(O.LEGACY).length === 0 && !(await page.$('.mardialog')), 'scripted clicks on the locked rounds: no request, no dialog')
    await groupShot(page, `${SHOTS}/dark-desktop-first-dose-open.png`)
    await page.click(sel(O.FIRST, '.mab.given'))
    await waitFor(async () => (await rowState(page, O.FIRST)).round === 'round 2', 10_000)
    const ff = await facts(O.FIRST), fpost = postsFor(O.FIRST)
    const actual = wireMs(ff[0]?.documentedTime ?? '1970-01-01 00:00')
    s = await rowState(page, O.FIRST)
    check(ff.length === 1 && ff[0].round === 1 && ff[0].status === 'given' && fpost.length === 1 && ff[0].attemptId === JSON.parse(fpost[0].body).attemptId,
      `Given before its scheduled time -> one fact, round 1, carrying the request's attemptId (${ff[0]?.attemptId})`)
    check(s.round === 'round 2' && s.disabled.every(Boolean) && s.lock?.includes(`Opens ${hospHm(actual + 3600_000)}`),
      `round 2 = actual ${hospHm(actual)} + 1 h, LOCKED until then — "${s.lock}"`)
    await page.click(sel(O.ONCE, '.mab.held'))
    await page.fill('#marReason', 'synthetic: NPO for procedure')
    await page.dblclick('.mardialog .mardfoot .btn:not(.ghost)')
    await waitFor(async () => (await rowState(page, O.ONCE)).groups === 0, 10_000)
    const of = await facts(O.ONCE)
    check(of.length === 1 && of[0].status === 'held' && of[0].reason === 'synthetic: NPO for procedure' && postsFor(O.ONCE).length === 1,
      'ONCE: Held with its reason before its scheduled time -> one fact (double-click confirm: one request); nothing further expected')
  }

  if (wants('S1')) {
    console.log('\n[S1] DELAYED ORIGINAL COMMIT beyond 15 s (PRN): the page gets no answer; the original request reaches the server 21 s later')
    const t0 = (await toasts(page)).length   // this scenario's toasts only
    const oid = O.PRNDELAY
    const f0 = (await facts(oid)).length, a0 = (await audit(oid)).length
    const cap = await interceptOriginal(page, oid)
    await page.click(sel(oid, '.mab.given'))
    await waitFor(() => cap.req, 5000)
    const sentId = JSON.parse(cap.req.body).attemptId
    console.log(`  original request captured: ${cap.req.body}`)
    const late = (async () => { await sleep(cap.t + 21_000 - Date.now()); return sendOriginal(cap.req) })()
    await waitFor(async () => Date.now() >= cap.t + 16_000, 30_000, 200)
    s = await rowState(page, oid)
    check(s.disabled.every(Boolean), `failure +${since(cap.t)} s, the original still pending: the controls stay LOCKED — "${s.lock}"`)
    check(!(await toasts(page, t0)).some(t => /NOT recorded/.test(t)), `no "NOT recorded" verdict while the original may still commit (toasts: ${JSON.stringify((await toasts(page, t0)).map(t => t.split('|')[0]))})`)
    if (s.retry) { console.log('  the page offers "Retry saving" -> the nurse retries saving'); await page.click(retrySel(oid)) }
    else if (s.disabled.every(d => !d)) { console.log('  the page reopened the dose -> the nurse documents it again, as told'); await page.click(sel(oid, '.mab.given')) }
    await waitFor(async () => (await facts(oid)).length > f0, 10_000)
    const lateRes = await late
    console.log(`  the original reached the server at failure +${since(cap.t)} s -> HTTP ${lateRes.status}`)
    await sleep(1500)
    const f = await facts(oid)
    check(f.length === f0 + 1, `one dose, ${f.length - f0} fact(s) on the record — exactly one`)
    check((await audit(oid)).length === a0 + 1, `audit: ${(await audit(oid)).length - a0} administration entr${(await audit(oid)).length - a0 === 1 ? 'y' : 'ies'} — exactly one`)
    if (sentId) {
      const retryPost = postsFor(oid).filter(p => p.t > cap.t + 1000).map(p => JSON.parse(p.body))
      check(retryPost.length === 1 && retryPost[0].attemptId === sentId && retryPost[0].action === 'given' && retryPost[0].administeredAt === wireOf(Math.floor(cap.t / 60000) * 60000),
        `the retry re-sent the SAME attempt (${sentId}), its minute pinned as the actual time: ${JSON.stringify(retryPost[0])}`)
      check(f[f.length - 1].attemptId === sentId && lateRes.status === 200 && JSON.stringify(lateRes.body.administrations) === JSON.stringify((await orderOf(oid)).administrations),
        'the late original was answered with the existing record (200) and added nothing')
      check(!!(await waitFor(async () => (await toasts(page, t0)).some(t => t.startsWith('Saved — confirmed')), 10_000)), 'the page said "Saved — confirmed"')
    }
    console.log('  intentional later documentation (a new attempt)')
    await waitFor(async () => (await rowState(page, oid)).disabled?.every(d => !d), 10_000)
    await page.click(sel(oid, '.mab.given'))
    await waitFor(async () => (await facts(oid)).length >= f0 + 2, 10_000)
    const f2 = await facts(oid)
    check(f2.length === f0 + 2 && !!f2[f2.length - 1].attemptId && f2[f2.length - 1].attemptId !== sentId, `a later Given on the PRN order is recorded as a second fact with a new attempt id (${f2[f2.length - 1].attemptId})`)
  }

  if (wants('S1b')) {
    console.log('\n[S1b] DELAYED ORIGINAL, no retry (continuous insulin): the late commit is confirmed from the record by itself')
    const t0 = (await toasts(page)).length   // this scenario's toasts only
    const oid = O.CONT
    const f0 = (await facts(oid)).length
    const cap = await interceptOriginal(page, oid)
    await page.click(sel(oid, '.mab.given'))
    await waitFor(() => cap.req, 5000)
    const sentId = JSON.parse(cap.req.body).attemptId
    const late = (async () => { await sleep(cap.t + 21_000 - Date.now()); return sendOriginal(cap.req) })()
    await waitFor(async () => Date.now() >= cap.t + 16_000, 30_000, 200)
    s = await rowState(page, oid)
    check(s.disabled.every(Boolean) && s.retry && s.lock.includes('Not confirmed'), `failure +${since(cap.t)} s: locked, unconfirmed — "${s.lock}"`)
    const lateRes = await late
    const conf = await waitFor(async () => (await toasts(page, t0)).find(t => t.startsWith('Saved — confirmed')), 12_000, 100)
    s = await rowState(page, oid)
    const f = await facts(oid)
    check(lateRes.status === 200 && !!conf && s.disabled.every(d => !d) && !s.lock, `committed at +21 s (HTTP ${lateRes.status}); the page confirmed it by itself at +${since(cap.t)} s and reopened the on-demand row: "${(conf ?? '').split('|')[1]}"`)
    check(f.length === f0 + 1 && f[f.length - 1].attemptId === sentId, 'exactly one fact, carrying the attempt id')
    await page.click(sel(oid, '.mab.given'))
    await waitFor(async () => (await facts(oid)).length >= f0 + 2, 10_000)
    const f2 = await facts(oid)
    check(f2.length === f0 + 2 && f2[f2.length - 1].attemptId !== sentId, 'a later Given on the continuous order: a new attempt, a second fact')
  }

  if (wants('S2')) {
    console.log('\n[S2] OUT-OF-ORDER settlement reads (PRN): a read taken before the commit arrives after a newer read showed the fact')
    const t0 = (await toasts(page)).length   // this scenario's toasts only
    const oid = O.PRNOOO
    const f0 = (await facts(oid)).length
    /* every decision is taken synchronously when the request arrives (before any await), so
       concurrent reads cannot race into the same slot */
    const gate = { armedAt: Infinity, A: null, B: null, committed: false, held: [], log: [], n: 0 }
    await page.route('**/api/icu/mar', async route => {
      if (route.request().method() !== 'GET') return route.continue()
      const n = ++gate.n
      if (Date.now() < gate.armedAt) { gate.log.push(`#${n} passed (before arming)`); return route.continue() }
      if (!gate.A) {
        const slot = gate.A = { route, n, resp: null }
        gate.log.push(`#${n} HELD — the stale read, fetched before the commit`)
        slot.resp = await route.fetch(); return
      }
      if (gate.committed && !gate.B) { gate.B = n; gate.log.push(`#${n} passed — the newer read, after the commit`); return route.continue() }
      const h = { route, resp: null }; gate.held.push(h); gate.log.push(`#${n} held until the stale read is released`)
      h.resp = await route.fetch()
    })
    const cap = await interceptOriginal(page, oid)
    await page.click(sel(oid, '.mab.given'))
    await waitFor(() => cap.req, 5000)
    gate.armedAt = cap.t + 15_000
    await waitFor(() => gate.A?.resp, 30_000, 50)
    console.log(`  stale read #${gate.A.n} held at failure +${since(cap.t)} s`)
    const res = await sendOriginal(cap.req)
    gate.committed = true
    console.log(`  the original commits (HTTP ${res.status}); a newer read is triggered (visibility change)`)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => gate.B, 10_000, 50)
    await page.waitForTimeout(800)
    const beforeStale = await rowState(page, oid)
    await gate.A.route.fulfill({ response: gate.A.resp })
    console.log('  the stale read is released')
    await page.waitForTimeout(1200)
    for (const h of gate.held) { await waitFor(() => h.resp, 10_000, 50); await h.route.fulfill({ response: h.resp }) }
    await page.waitForTimeout(800)
    await page.unroute('**/api/icu/mar')
    console.log('  reads: ' + gate.log.join('; '))
    const tl = await toasts(page, t0)
    const said = tl.filter(t => /NOT recorded|NOT saved|Saved — confirmed|Documented — confirmed/.test(t)).map(t => t.split('|')[0])
    s = await rowState(page, oid)
    check(!tl.some(t => /NOT recorded|NOT saved/.test(t)), `no "not recorded" verdict from the stale read (verdicts shown: ${JSON.stringify(said)})`)
    check(tl.some(t => t.startsWith('Saved — confirmed')), 'the newer read confirmed the save')
    check(beforeStale.docRows >= 1 && s.docRows === beforeStale.docRows, `the display kept the recorded dose after the stale read (documented rows ${beforeStale.docRows} -> ${s.docRows})`)
    if (tl.some(t => /NOT recorded/.test(t)) && s.disabled?.every(d => !d)) {
      console.log('  the page said NOT recorded and reopened the dose -> the nurse documents it again, as told')
      await page.click(sel(oid, '.mab.given'))
      await waitFor(async () => (await facts(oid)).length >= f0 + 2, 10_000)
    }
    const f = await facts(oid)
    check(f.length === f0 + 1, `one dose, ${f.length - f0} fact(s) on the record — exactly one`)
  }

  if (wants('S3')) {
    console.log('\n[S3] LOST ORIGINAL (PRN): it never reaches the server; the page keeps it unconfirmed across a reload; Retry saving records it once')
    const t0 = (await toasts(page)).length   // this scenario's toasts only
    const oid = O.PRNLOST
    const f0 = (await facts(oid)).length, a0 = (await audit(oid)).length
    const cap = await interceptOriginal(page, oid)
    await page.click(sel(oid, '.mab.given'))
    await waitFor(() => cap.req, 5000)
    const sentId = JSON.parse(cap.req.body).attemptId
    await waitFor(async () => Date.now() >= cap.t + 16_000, 30_000, 200)
    s = await rowState(page, oid)
    const tl = await toasts(page, t0)
    check(s.disabled.every(Boolean) && s.retry && s.lock.includes('Not confirmed') && s.lock.includes('Retry saving') && !tl.some(t => /NOT recorded/.test(t)),
      `failure +${since(cap.t)} s, nothing on the record: still unconfirmed, never declared not recorded — "${s.lock}"`)
    check(!/give|administer/i.test(s.lock.replace(/given documentation/, '')) && /same documentation/.test(s.lock), 'the wording is about saving the documentation, never about giving the dose again')
    const unconf = tl.find(t => t.startsWith('Save not confirmed'))
    check(!!unconf && /may already be on the record/.test(unconf) && /Retry saving/.test(unconf), `toast: "${(unconf ?? '').replace('|', ' — ').slice(0, 160)}…"`)
    await groupShot(page, `${SHOTS}/dark-desktop-unconfirmed-retry-saving.png`)
    const cDark = await renderedContrast(page, `.mardaycard[id^="mar-${pid}-${oid}-"] .marwarn, .mardaycard[id^="mar-${pid}-${oid}-"] .marretry`)
    // the same unconfirmed attempt in a LIGHT context (its sessionStorage carried over) — screenshot + contrast
    const pending = await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('aurora.marUnconfirmed:')).map(k => [k, sessionStorage.getItem(k)]))
    check(pending.length === 1 && JSON.parse(pending[0][1]).some(a => a.attemptId === sentId), `kept in sessionStorage for this tab (${pending[0]?.[0]})`)
    const light = await openNurse(browser, { colorScheme: 'light' }, pending)
    await waitFor(async () => (await rowState(light.page, oid)).retry, 10_000)
    await groupShot(light.page, `${SHOTS}/light-desktop-unconfirmed-retry-saving.png`)
    const cLight = await renderedContrast(light.page, `.mardaycard[id^="mar-${pid}-${oid}-"] .marwarn, .mardaycard[id^="mar-${pid}-${oid}-"] .marretry`)
    await light.page.setViewportSize({ width: 390, height: 1400 })
    await light.page.waitForTimeout(300)
    /* the MAR group itself must fit; the PAGE's own overflow at 390 px comes from the I&O card's
       totals row (.iototals — pre-existing, outside this change) and is reported, not judged */
    const narrow = await light.page.evaluate(([p, o]) => {
      const cw = document.documentElement.clientWidth
      const g = document.querySelector(`.mardaycard[id^="mar-${p}-${o}-"]`).closest('.margroup')
      const over = [...g.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > cw + 1).map(e => e.className)
      const pageOver = [...new Set([...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > cw + 1 && !e.closest('.margroup')).map(e => e.className.split(' ')[0]))].slice(0, 4)
      return { cw, sw: document.documentElement.scrollWidth, over, pageOver }
    }, [pid, oid])
    await groupShot(light.page, `${SHOTS}/light-narrow390-unconfirmed-retry-saving.png`)
    await light.ctx.close()
    const fmt = c => c.map(x => `${x.t.slice(0, 14)} ${x.cr.toFixed(2)}`).join(', ')
    check(cDark.length >= 2 && cLight.length >= 2 && [...cDark, ...cLight].every(x => x.cr >= 4.5), `rendered contrast ≥ 4.5:1 — dark: ${fmt(cDark)} · light: ${fmt(cLight)}`)
    check(narrow.over.length === 0, `390 px: nothing in the MAR group (lock line + Retry saving) overflows the ${narrow.cw} px viewport (${JSON.stringify(narrow.over)})`)
    console.log(`  info: page scrollWidth ${narrow.sw} at ${narrow.cw} px — from outside the MAR: ${JSON.stringify(narrow.pageOver)} (pre-existing, not this change)`)
    await page.reload(); await page.waitForLoadState('networkidle')
    await waitFor(async () => (await rowState(page, oid)).groups === 1, 10_000)
    s = await rowState(page, oid)
    check(s.disabled.every(Boolean) && s.retry && s.lock.includes('Not confirmed'), `after a RELOAD: the attempt is still unconfirmed, the dose still locked — "${s.lock.slice(0, 80)}…"`)
    const n0 = postsFor(oid).length
    await page.dblclick(retrySel(oid))   // a real double-click: clicks with detail 1 and 2
    const conf = await waitFor(async () => (await toasts(page)).find(t => t.startsWith('Saved — confirmed')), 10_000)
    await page.waitForTimeout(500)
    const rp = postsFor(oid).slice(n0).map(p => JSON.parse(p.body))
    const f = await facts(oid)
    check(rp.length === 1 && rp[0].attemptId === sentId && rp[0].administeredAt === wireOf(Math.floor(cap.t / 60000) * 60000),
      `a real double-click on Retry saving -> ONE request: the same attempt, its minute pinned (${JSON.stringify(rp[0])})`)
    check(!!conf && f.length === f0 + 1 && f[f.length - 1].attemptId === sentId && f[f.length - 1].documentedTime === wireOf(Math.floor(cap.t / 60000) * 60000),
      `recorded once, given at the minute it was documented (${f[f.length - 1]?.documentedTime}), not when it was saved`)
    const au = await audit(oid)
    check(au.length === a0 + 1, `audit: one entry — "${au[au.length - 1]?.detail}"`)
    s = await rowState(page, oid)
    check(s.disabled.every(d => !d) && !s.lock, 'confirmed: the PRN row is open again')
    await page.click(sel(oid, '.mab.given'))
    await waitFor(async () => (await facts(oid)).length >= f0 + 2, 10_000)
    const f2 = await facts(oid)
    check(f2.length === f0 + 2 && f2[f2.length - 1].attemptId !== sentId, 'a later intentional Given: a new attempt, a second fact')
    check(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('aurora.marUnconfirmed:')).length) === 0, 'nothing left pending in sessionStorage')
  }

  await ctx.close(); await browser.close()
  console.log(`\nRESULT ${passes} passed, ${fails} failed`)
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
