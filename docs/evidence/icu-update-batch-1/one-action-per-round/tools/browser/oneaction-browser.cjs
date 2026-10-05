// Browser check (Chromium) of ONE ACTION PER ROUND on the live local stack
// (this branch's server + its staging bundle, PostgreSQL 16, server zone
// Asia/Baghdad, browser device zone UTC). Synthetic data from
// oneaction-setup.py only. Every POST the page sends to
// /api/icu/mar/.../administrations/ is recorded, and the stored facts are
// re-read from the server after each scenario.
// Usage: node oneaction-browser.cjs <shotsDir> <oneaction-setup.json>
const { chromium, BASE, login } = require('../../../sidebar-mar-cards/tools/browser/lib.cjs')
const fs = require('fs')
const [SHOTS, SETUP] = process.argv.slice(2)
const setup = JSON.parse(fs.readFileSync(SETUP, 'utf8'))
const { pid } = setup
const O = Object.fromEntries(Object.entries(setup.orders).map(([k, v]) => [k, v.oid]))
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
let passes = 0, fails = 0
const check = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
const wireMs = s => Date.parse(s.replace(' ', 'T') + ':00Z')
const hospHm = ms => new Date(ms + 3 * 3600_000).toISOString().slice(11, 16)   // Asia/Baghdad = UTC+3 (no DST)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
async function renderedContrast(page, selector) {   // the earlier rounds' rendered-pixel method
  const out = []
  for (const el of await page.$$(selector)) {
    if (!(await el.isVisible())) continue
    /* centre it first: an edge-aligned element can sit under the fixed
       staging banner, which would be measured instead of the row */
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
/* the API, as another station / for read-back (node fetch, nurse token) */
let TOK = null
async function api(method, path, body) {
  if (!TOK) TOK = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'maya.chen', password: 'Aurora2026!' }) })).json()).token
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const facts = async oid => ((await api('GET', `/api/icu/orders?patientId=${pid}`)).body.find(o => o.orderId === oid).administrations ?? [])
/* the order's ONE actionable row on the page (there is never a second) */
const sel = (oid, what = '') => `.mardaycard[id^="mar-${pid}-${oid}-"] .maracts ${what}`.trim()
const rowState = (page, oid) => page.evaluate(([p, o]) => {
  const acts = [...document.querySelectorAll(`.mardaycard[id^="mar-${p}-${o}-"] .maracts`)]
  if (acts.length !== 1) return { groups: acts.length }
  const row = acts[0].closest('.marrow')
  const btn = [...acts[0].querySelectorAll('button')]
  return {
    groups: 1, disabled: btn.map(b => b.disabled), round: row.querySelector('.marround')?.textContent ?? null,
    label: row.querySelector('.marstate')?.textContent, lock: row.querySelector('.marlockline')?.textContent ?? null,
    time: row.querySelector('.martime')?.textContent, kind: row.querySelector('.markind')?.textContent ?? null,
  }
}, [pid, oid])
const posts = []
const toasts = page => page.evaluate(() => window.__toasts.slice())
async function waitFor(fn, ms, step = 50) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step) } return null }
async function groupShot(p, path) {   // this synthetic patient's MAR group only (the earlier rounds' helper)
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
async function openNurse(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, colorScheme: 'dark', timezoneId: 'UTC', ...opts })
  await ctx.addInitScript(() => {
    window.__toasts = []
    new MutationObserver(() => {
      const t = document.querySelector('.toast.show b')
      const s = t && `${t.textContent}|${t.nextElementSibling?.textContent ?? ''}`
      if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s)
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
  })
  const page = await ctx.newPage()
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/administrations/')) posts.push({ url: r.url(), body: r.postData(), t: Date.now() }) })
  await login(page, 'maya.chen'); await page.goto(BASE + '/nurse'); await page.waitForLoadState('networkidle')
  await page.waitForSelector(sel(O.LOCK))
  await page.mouse.move(1400, 1300)
  return { ctx, page }
}
const postsFor = oid => posts.filter(p => p.url.includes(`/mar/${oid}/administrations/`))

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE })
  const D = wireMs(setup.lockDueUtc)
  console.log(`setup ${pid}: LOCK round 2 due ${setup.lockDueUtc} UTC = ${hospHm(D)} hospital; browser device zone UTC`)
  const { ctx, page } = await openNurse(browser)
  let marGets = 0
  page.on('request', r => { if (r.method() === 'GET' && r.url().endsWith('/api/icu/mar')) marGets++ })

  console.log('\n[1] LOCK: before its scheduled time the current round is shown, all three actions disabled, with when they open')
  let s = await rowState(page, O.LOCK)
  check(s.groups === 1 && s.disabled.every(Boolean), `round 2 (${s.round}): Given/Held/Refused disabled ${JSON.stringify(s.disabled)}`)
  check(s.lock?.includes(`Opens ${hospHm(D)}`) && /in \d+ min|in under a minute/.test(s.lock) && s.lock.includes('one action per round'), `lock line: "${s.lock}"`)
  check(s.label === 'DUE SOON', `state label "${s.label}" — the 30-min reminder, not permission`)
  check(await page.evaluate(sl => document.querySelector(sl).closest('.marrow').querySelector('.mab.given').getAttribute('aria-describedby') !== null, sel(O.LOCK)), 'the disabled buttons are described by the lock line (aria-describedby)')
  await groupShot(page, `${SHOTS}/dark-desktop-round-locked-until-due.png`)
  const g0 = marGets
  await waitFor(async () => marGets > g0 + 0, 25_000, 250)
  await page.waitForLoadState('networkidle')
  s = await rowState(page, O.LOCK)
  check(marGets > g0 && s.disabled.every(Boolean) && s.lock?.includes(`Opens ${hospHm(D)}`), `after a poll refresh (${marGets - g0} MAR read): still locked`)
  // try every way in while locked: real clicks (Playwright refuses disabled targets) and synthetic same-task clicks
  await page.evaluate(sl => document.querySelectorAll(`${sl} button`).forEach(b => b.click()), sel(O.LOCK))
  await page.waitForTimeout(400)
  check(postsFor(O.LOCK).length === 0 && !(await page.$('.mardialog')), 'scripted clicks on the locked buttons: no request, no dialog')
  console.log(`  … waiting for ${hospHm(D)} hospital (${Math.round((D - Date.now()) / 1000)} s)`)
  await waitFor(async () => Date.now() >= D - 1500, 600_000, 200)
  s = await rowState(page, O.LOCK)
  check(s.disabled.every(Boolean), `1.5 s before ${hospHm(D)}: still disabled`)
  const opened = await waitFor(async () => (await rowState(page, O.LOCK)).disabled.every(d => !d) && Date.now(), 5000, 20)
  check(opened && opened - D < 1200 && opened >= D, `the controls opened by themselves ${opened ? opened - D : '?'} ms after ${hospHm(D)} (no reload, no click)`)
  s = await rowState(page, O.LOCK)
  check(!s.lock || !s.lock.includes('Opens'), 'the lock line is gone once open')
  // rapid mixed clicks in ONE task (before React can re-render), then more clicks 40 ms later
  await page.evaluate(sl => { const [g, h, r] = document.querySelectorAll(`${sl} button`); g.click(); g.click(); h.click(); r.click(); g.click() }, sel(O.LOCK))
  await page.waitForTimeout(40)
  await page.evaluate(sl => document.querySelectorAll(`${sl} button`).forEach(b => b.click()), sel(O.LOCK))
  await waitFor(async () => { const x = await rowState(page, O.LOCK); return x.round === 'round 3' && x }, 10_000)
  await page.waitForTimeout(300)
  s = await rowState(page, O.LOCK)
  const lockPosts = postsFor(O.LOCK)
  check(lockPosts.length === 1 && JSON.parse(lockPosts[0].body).action === 'given', `5 + 3 rapid clicks -> exactly ONE request (${lockPosts.map(p => JSON.parse(p.body).action)})`)
  check(!(await page.$('.mardialog')), 'no reason dialog left open (a same-frame Held/Refused click is closed with its round)')
  check(s.round === 'round 3' && s.disabled.every(Boolean) && s.lock?.includes(`Opens ${hospHm(D + 3600_000)}`),
    `after the save + refresh: round 3 locked — "${s.lock}" — recording the dose opened no future round`)
  const lf = await facts(O.LOCK)
  check(lf.length === 2 && lf[1].round === 2 && lf[1].status === 'given', `server: ${lf.length} facts (round 1 setup + ONE round-2 Given)`)

  console.log('\n[2] RAPID: an open round, mixed clicks in one task -> one request')
  await page.evaluate(sl => { const [g, h, r] = document.querySelectorAll(`${sl} button`); g.click(); h.click(); r.click(); g.click(); g.click() }, sel(O.RAPID))
  await waitFor(async () => (await rowState(page, O.RAPID)).round === 'round 3', 10_000)
  await page.waitForTimeout(300)
  const rp = postsFor(O.RAPID)
  check(rp.length === 1, `requests: ${rp.length} (${rp.map(p => JSON.parse(p.body).action)})`)
  check(!(await page.$('.mardialog')), 'no dialog left open')
  check((await facts(O.RAPID)).length === 2 && (await rowState(page, O.RAPID)).disabled.every(Boolean), 'server: one new fact; round 3 locked')

  console.log('\n[3] DIALOG: Held -> reason -> double-click confirm -> one request')
  await page.click(sel(O.DIALOG, '.mab.held'))
  await page.fill('#marReason', 'synthetic: SBP 82 — holding per parameters')
  await page.dblclick('.mardialog .mardfoot .btn:not(.ghost)')
  await waitFor(async () => (await rowState(page, O.DIALOG)).round === 'round 3', 10_000)
  const dp = postsFor(O.DIALOG)
  const df = await facts(O.DIALOG)
  check(dp.length === 1 && JSON.parse(dp[0].body).action === 'held' && df.length === 2 && df[1].status === 'held' && df[1].reason.startsWith('synthetic: SBP 82'),
    `double-click confirm -> ${dp.length} request; server: one Held fact with its reason`)

  console.log('\n[4] UNCERTAIN, recorded: the request reaches the server, the answer is lost -> settled by a fresh read as RECORDED')
  await page.route(`**/api/icu/mar/${O.UNCREC}/administrations/**`, async route => { await route.fetch(); await route.abort('failed') })
  await page.click(sel(O.UNCREC, '.mab.given'))
  const sawChecking = await waitFor(async () => (await toasts(page)).some(t => t.startsWith('Checking the record')), 5000)
  const confirmed = await waitFor(async () => (await toasts(page)).some(t => t.startsWith('Documented — confirmed')), 10_000)
  await page.unroute(`**/api/icu/mar/${O.UNCREC}/administrations/**`)
  s = await rowState(page, O.UNCREC)
  check(!!sawChecking && !!confirmed, `toasts: "Checking the record" then "Documented — confirmed"`)
  check((await facts(O.UNCREC)).length === 2 && s.round === 'round 3' && s.disabled.every(Boolean), 'server: exactly one new fact; the page shows round 3, locked — no blind retry')

  console.log('\n[5] UNCERTAIN, not recorded: the request never arrives -> locked while checking, then reported NOT recorded and reopened')
  await page.route(`**/api/icu/mar/${O.UNCNOT}/administrations/**`, route => route.abort('failed'))
  const tFail = Date.now()
  await page.click(sel(O.UNCNOT, '.mab.given'))
  await waitFor(async () => (await rowState(page, O.UNCNOT)).lock?.includes('Checking the record'), 5000)
  s = await rowState(page, O.UNCNOT)
  check(s.disabled.every(Boolean) && s.lock.includes('Checking the record'), `while unsettled: all disabled — "${s.lock}"`)
  await groupShot(page, `${SHOTS}/dark-desktop-checking-uncertain-outcome.png`)
  await page.waitForTimeout(8000)
  s = await rowState(page, O.UNCNOT)
  check(s.disabled.every(Boolean), '8 s later: still locked (a NOT-recorded verdict needs a read ≥ 15 s after the failure)')
  const notRec = await waitFor(async () => (await toasts(page)).some(t => t.startsWith('Dose NOT recorded') && t.includes('did not record')), 20_000)
  s = await rowState(page, O.UNCNOT)
  check(!!notRec && Date.now() - tFail >= 15_000 && s.disabled.every(d => !d) && s.lock?.includes('Not recorded'),
    `after ${Math.round((Date.now() - tFail) / 1000)} s: "Dose NOT recorded"; the round reopens with the notice "${s.lock}"`)
  check((await facts(O.UNCNOT)).length === 1 && postsFor(O.UNCNOT).length === 1, 'server: nothing was recorded; one request was sent')
  await page.unroute(`**/api/icu/mar/${O.UNCNOT}/administrations/**`)
  await page.click(sel(O.UNCNOT, '.mab.given'))
  await waitFor(async () => (await rowState(page, O.UNCNOT)).round === 'round 3', 10_000)
  check((await facts(O.UNCNOT)).length === 2, 'documenting it again after the verdict -> recorded once')

  console.log('\n[6] STALE page: another station documents the round while this page still shows it')
  let frozen = null
  await page.route('**/api/icu/mar', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    if (frozen) return route.fulfill({ status: 200, contentType: 'application/json', body: frozen })
    return route.continue()
  })
  frozen = JSON.stringify((await api('GET', '/api/icu/mar')).body)   // the view as it is now
  const other = await api('POST', `/api/icu/mar/${O.STALE}/administrations/${setup.orders.STALE.round2}`, { action: 'given' })
  check(other.status === 200, 'the other station documents round 2 (API) -> 200')
  s = await rowState(page, O.STALE)
  check(s.round === 'round 2' && s.disabled.every(d => !d), 'this page still shows round 2 open (stale view)')
  frozen = null
  await page.click(sel(O.STALE, '.mab.given'))
  const stale = await waitFor(async () => (await toasts(page)).find(t => t.startsWith('Dose NOT recorded') && t.includes('already documented')), 8000)
  await waitFor(async () => (await rowState(page, O.STALE)).round === 'round 3', 8000)
  s = await rowState(page, O.STALE)
  const docMin = (await facts(O.STALE))[1].documentedTime
  check(!!stale && stale.includes(hospHm(wireMs(docMin))) && !stale.includes(docMin), `refusal shown in HOSPITAL time: "${(stale ?? '').split('|')[1]?.slice(0, 120)}"`)
  check(s.round === 'round 3' && s.disabled.every(Boolean) && s.lock?.includes('Not recorded — dose round 2'), `refreshed: round 3 locked, with the notice "${s.lock?.slice(0, 90)}…"`)
  check((await facts(O.STALE)).length === 2, 'server: only the other station\'s fact')
  await page.unroute('**/api/icu/mar')
  await groupShot(page, `${SHOTS}/dark-desktop-stale-page-refusal.png`)

  console.log('\n[7] CONTINUOUS Insulin (Actrapid) 2.5 U/h — the owner\'s screenshot')
  s = await rowState(page, O.CONT)
  check(s.kind === 'on demand' && s.label === 'ON DEMAND' && s.disabled.every(d => !d), `ON DEMAND row, open (no schedule): ${JSON.stringify(s)}`)
  // a real TRIPLE click (click events with detail 1, 2, 3), then a real DOUBLE click whose two clicks are
  // 150 ms apart — on this local server the first click's save + refresh finishes inside that gap, so the
  // second click lands on an OPEN on-demand row: only the click count (detail 2) tells it apart
  await page.click(sel(O.CONT, '.mab.given'), { clickCount: 3 })
  await waitFor(async () => (await facts(O.CONT)).length >= 1 && (await rowState(page, O.CONT)).disabled.every(d => !d), 10_000)
  await page.waitForTimeout(400)
  const triple = postsFor(O.CONT).length
  const box = await (await page.$(sel(O.CONT, '.mab.given'))).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(150)
  const reopenedBetween = (await rowState(page, O.CONT)).disabled.every(d => !d)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 })
  await waitFor(async () => (await facts(O.CONT)).length >= 2 && (await rowState(page, O.CONT)).disabled.every(d => !d), 10_000)
  await page.waitForTimeout(400)
  const cf = await facts(O.CONT)
  s = await rowState(page, O.CONT)
  check(triple === 1, `a real triple click on Given -> ${triple} request`)
  check(postsFor(O.CONT).length === 2 && cf.length === 2, `a real double click (clicks 150 ms apart${reopenedBetween ? ', the row already open again between them' : ''}) -> 1 more request; server: ${cf.length} facts in total — one per multi-click (the screenshot's three same-minute Givens from repeated clicks cannot happen)`)
  check(s.disabled.every(d => !d), 'UNRESOLVED, by design of this change: after the save the ON DEMAND controls are open again — no prescription field defines a next documentation round for a continuous infusion')
  await groupShot(page, `${SHOTS}/dark-desktop-continuous-insulin-after-one-given.png`)

  console.log('\n[8] readability (rendered contrast, dark)')
  await waitFor(async () => !(await page.$('.toast.show')), 10_000)   // a toast over the list would be measured instead of the text's background
  for (const c of [...await renderedContrast(page, '.margroup .marlock'), ...await renderedContrast(page, '.margroup .marnotice')])
    check(c.cr >= 4.5, `dark ${c.t}… ${c.cr.toFixed(2)}:1`)
  await ctx.close()

  console.log('\n[9] light theme + 390 px')
  const l = await openNurse(browser, { colorScheme: 'light' })
  check(await l.page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'light theme active')
  for (const c of await renderedContrast(l.page, '.margroup .marlock'))
    check(c.cr >= 4.5, `light ${c.t}… ${c.cr.toFixed(2)}:1`)
  await groupShot(l.page, `${SHOTS}/light-desktop-round-locked.png`)
  await l.ctx.close()
  const n = await openNurse(browser, { viewport: { width: 390, height: 1400 } })
  const over = await n.page.evaluate(pp => [...document.querySelectorAll(`.mardaycard[id^="mar-${pp}-"]`)].some(c => c.scrollWidth > c.clientWidth + 1), pid)
  check(!over, '390 px: no horizontal overflow inside this patient\'s MAR cards')
  await groupShot(n.page, `${SHOTS}/dark-narrow390-round-locked.png`)
  await n.ctx.close()
  await browser.close()
  console.log(`\nRESULT ${passes} passed, ${fails} failed`)
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
