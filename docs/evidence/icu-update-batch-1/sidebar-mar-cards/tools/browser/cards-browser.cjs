// Browser check (Chromium) of the 2026-10-04 changes on the live local stack
// (server f42523a + its staging bundle, PostgreSQL 16, server zone
// Asia/Baghdad; the BROWSER's device zone is UTC so a browser-zone date
// would visibly differ). Synthetic data from cards-setup.py only.
// Usage: node cards-browser.cjs <shotsDir> <cards-setup.json>
const { chromium, BASE, login } = require('./lib.cjs')   // the first round's helper (../../../tools/browser/lib.cjs)
const fs = require('fs')
const [SHOTS, SETUP] = process.argv.slice(2)
const setup = JSON.parse(fs.readFileSync(SETUP, 'utf8'))
const run = setup.marRows[0].medication.split(' ')[2]
const O = Object.fromEntries(Object.entries(setup.orders).map(([k, v]) => [k, v.oid]))
const { today, yesterday, tomorrow, pid } = setup
let passes = 0, fails = 0
const check = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const cardId = (oid, day) => `mar-${pid}-${oid}-${day ?? 'undated'}`.replace(/[^A-Za-z0-9_-]/g, '-')
const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
async function renderedContrast(page, selector) {   // rolling-browser.cjs's rendered-pixel method
  const out = []
  for (const el of await page.$$(selector)) {
    if (!(await el.isVisible())) continue
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
    out.push({ sel: selector, t: (await el.textContent()).trim().slice(0, 24), cr: contrast(r.fg, r.bg) })
  }
  return out
}
const navState = page => page.evaluate(() => {
  const nav = document.querySelector('.nav-sidebar'); if (!nav) return null
  return { open: nav.classList.contains('nav-open'), overlay: nav.classList.contains('nav-overlay'), width: Math.round(nav.getBoundingClientRect().width),
    current: nav.querySelector('[aria-current="page"]')?.getAttribute('aria-label'), toggle: nav.querySelector('.nvtoggle')?.getAttribute('aria-expanded') ?? null }
})
const underPointer = (page, x, y) => page.evaluate(([x, y]) => !!document.querySelector('.nav-sidebar')?.contains(document.elementFromPoint(x, y)), [x, y])
const itemY = (page, label) => page.evaluate(l => { const r = document.querySelector(`.nav-sidebar .nv[aria-label="${l}"]`)?.getBoundingClientRect(); return r ? Math.round(r.top + r.height / 2) : null }, label)
const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(600) }   // > hover-open 90 + close 180 ms, no pointer movement
const marCards = page => page.evaluate(p => [...document.querySelectorAll(`.mardaycard[id^="mar-${p}-"]`)].map(s => ({
  id: s.id, pinned: s.classList.contains('pinned'), open: s.classList.contains('open'), date: s.querySelector('.mddate')?.textContent,
  rows: s.querySelectorAll('.marrow').length, acts: s.querySelectorAll('.maracts').length, ref: s.querySelector('.mdref')?.className ?? null,
  refText: s.querySelector('.mdref')?.textContent ?? null, head: s.querySelector('.mdhead')?.textContent, text: s.textContent,
  toggle: s.querySelector('.mdtoggle')?.getAttribute('aria-expanded') ?? null,
  sum: s.querySelector('.mdsum')?.textContent ?? '',
})), pid)

/* screenshot of THIS synthetic patient's MAR group only: the MAR scrolls
   inside the page's own scroll container, where an element capture can land
   on the wrong area — so, for the shot only, the other patients' groups are
   hidden, the viewport is made tall, the group is clipped, then restored */
async function groupShot(p, path) {
  const vp = p.viewportSize()
  await p.setViewportSize({ width: vp.width, height: 2800 })
  await p.evaluate(id => {
    const g = document.getElementById(id).closest('.margroup')
    document.querySelectorAll('.margroup').forEach(x => { if (x !== g) x.style.display = 'none' })
    g.scrollIntoView({ block: 'start' })
  }, cardId(O.A, today))
  await p.waitForTimeout(300)
  const box = await (await p.$(`.margroup:has(#${cardId(O.A, today)})`)).boundingBox()
  await p.screenshot({ path, clip: { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: Math.min(box.width + 12, vp.width), height: Math.min(box.height + 12, 2800 - Math.max(0, box.y - 6)) } })
  await p.evaluate(() => document.querySelectorAll('.margroup').forEach(x => { x.style.display = '' }))
  await p.setViewportSize(vp)
}
;(async () => {
  const browser = await chromium.launch({ executablePath: EXE })
  console.log(`setup: ${pid} · hospital today ${today} (yesterday ${yesterday}, tomorrow ${tomorrow}) · hospital midnight = ${setup.midnightUtc} UTC · device zone UTC`)

  /* ---------------- 1. SIDEBAR ---------------- */
  console.log('\n[S1] stationary pointer across Orders -> Lab Entry -> Observations -> Orders (desktop 1440, dark)')
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', timezoneId: 'UTC' })
  let page = await ctx.newPage()
  await login(page, 'sara.rahman')
  await page.goto(BASE + `/orders/${pid}`); await settle(page)
  const yOrders = await itemY(page, 'Orders & Meds')
  await page.mouse.move(30, yOrders); await page.waitForTimeout(400)                 // into the icon rail: hover intent opens it
  const full = (await navState(page)).width
  check((await navState(page)).open && full > 150, `hover opens the rail (width ${full}px)`)
  const X = 150                                                                       // a LABEL position, beyond the 64px rail
  for (const [label, path] of [['Lab Entry', '/lab-entry'], ['Observations', '/observations'], ['Orders & Meds', '/orders']]) {
    const y = await itemY(page, label)
    await page.mouse.move(X, y); await page.mouse.down(); await page.mouse.up()       // click the label; the pointer then rests there
    await page.waitForURL(u => u.pathname.startsWith(path)); await settle(page)
    const st = await navState(page)
    check(st.open && st.width === full && st.current === label && await underPointer(page, X, y),
      `${label}: new page's sidebar open at full width ${st.width}px with the pointer resting on its label (x=${X}), no movement for 600 ms`)
  }
  await page.mouse.move(700, 450); await page.waitForTimeout(400)
  check(!(await navState(page)).open, `pointer leaves to the content -> collapses after the close delay (width ${(await navState(page)).width}px)`)
  await page.mouse.move(30, 300); await page.waitForTimeout(40); await page.mouse.move(700, 300); await page.waitForTimeout(300)
  check(!(await navState(page)).open, 'hover intent kept: a 40 ms crossing of the rail never opens it')
  await page.mouse.move(30, yOrders); await page.waitForTimeout(400); await page.mouse.move(700, 450)
  await page.keyboard.press('Escape')
  await page.evaluate(() => (document.activeElement)?.blur?.()); await page.waitForTimeout(400)
  for (let i = 0; i < 40 && !(await page.evaluate(() => !!document.querySelector('.nav-sidebar')?.contains(document.activeElement))); i++) await page.keyboard.press('Tab')
  check((await navState(page)).open, 'keyboard focus inside the sidebar opens it (pointer outside)')
  await page.evaluate(() => (document.querySelector('main button, main a, main input'))?.focus()); await page.waitForTimeout(300)
  check(!(await navState(page)).open, 'focus leaving the sidebar collapses it')

  /* the pointer rests on a LABEL (x=150): inside the open sidebar, but over
     the content once a sidebar mounts collapsed — so the new sidebar is open
     only if the old hover survived. (Resting on the 64 px icon rail would not
     discriminate: Chromium re-reports a pointer under new content, and the
     ordinary hover then opens the rail.) */
  console.log('\n[S2] sign-out clears the shared hover (pointer resting on a label through sign-out and sign-in)')
  await page.mouse.move(30, yOrders); await page.waitForTimeout(400); await page.mouse.move(150, yOrders); await page.waitForTimeout(300)
  check((await navState(page)).open && await underPointer(page, 150, yOrders), 'hover-open before sign-out, pointer on the Orders label')
  await page.focus('.hsignout'); await page.keyboard.press('Enter')                  // keyboard: the pointer never moves
  await page.waitForURL(u => u.pathname.startsWith('/login'))
  await page.fill('#lguser', 'sara.rahman'); await page.fill('#lgpass', 'Aurora2026!'); await page.press('#lgpass', 'Enter')
  await page.waitForURL(u => !u.pathname.startsWith('/login')); await settle(page)
  const afterLogin = await navState(page)
  check(afterLogin && !afterLogin.open && afterLogin.width < 100, `after sign-out + sign-in (keyboard only, pointer unmoved at x=150) the new sidebar is COLLAPSED (${afterLogin && afterLogin.width}px): the hover was cleared`)
  await page.mouse.move(32, yOrders + 2); await page.waitForTimeout(400)
  check((await navState(page)).open, 'ordinary hover still opens it afterwards')
  await page.mouse.move(700, 450)
  await ctx.close()

  console.log('\n[S3] narrow screen (700 px): hover opens the OVERLAY drawer; it survives a section change under the pointer')
  ctx = await browser.newContext({ viewport: { width: 700, height: 900 }, colorScheme: 'dark', timezoneId: 'UTC' })
  page = await ctx.newPage(); await login(page, 'sara.rahman')
  await page.goto(BASE + `/orders/${pid}`); await settle(page)
  const mainLeft = () => page.evaluate(() => Math.round(document.querySelector('.shell > main, .shell > :not(.nav-sidebar)')?.getBoundingClientRect().left ?? -1))
  const left0 = await mainLeft()
  await page.mouse.move(30, await itemY(page, 'Orders & Meds')); await page.waitForTimeout(400)
  let st = await navState(page)
  check(st.open && st.overlay && await mainLeft() === left0, `drawer overlays (width ${st.width}px, content stays at x=${left0})`)
  const yObs = await itemY(page, 'Observations')
  await page.mouse.move(150, yObs); await page.mouse.down(); await page.mouse.up()
  await page.waitForURL(u => u.pathname.startsWith('/observations')); await settle(page)
  st = await navState(page)
  check(st.open && st.overlay && st.current === 'Observations', 'after the section change the drawer is still open under the pointer')
  await page.mouse.move(600, 500); await page.waitForTimeout(400)
  check(!(await navState(page)).open, 'pointer out -> drawer closes')
  await ctx.close()

  console.log('\n[S4] touch (390x844, hasTouch/isMobile): the tap toggle only; hover state never applies')
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark', timezoneId: 'UTC' })
  page = await ctx.newPage(); await login(page, 'sara.rahman')
  await page.goto(BASE + `/orders/${pid}`); await settle(page)
  st = await navState(page)
  check(st.toggle === 'false' && !st.open, 'toggle present, collapsed')
  await page.tap('.nvtoggle'); await page.waitForTimeout(250)
  check((await navState(page)).open && (await navState(page)).toggle === 'true', 'tap toggle opens the drawer')
  await page.tap('.nav-sidebar .nv[aria-label="Observations"]')
  await page.waitForURL(u => u.pathname.startsWith('/observations')); await settle(page)
  st = await navState(page)
  check(!st.open && st.toggle === 'false' && st.current === 'Observations', 'tapping a section navigates and the new sidebar starts closed')
  await ctx.close()

  /* ---------------- 2. DAILY MAR CARDS ---------------- */
  console.log('\n[M1] grouping on the live MAR (nurse, desktop 1440, dark)')
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, colorScheme: 'dark', timezoneId: 'UTC' })
  page = await ctx.newPage(); await login(page, 'maya.chen')
  await page.goto(BASE + '/nurse'); await settle(page); await page.mouse.move(1400, 1300)
  let cards = await marCards(page)
  const card = (k, d) => cards.find(c => c.id === cardId(O[k], d))
  const A = card('A', today), A2 = card('A2', today)
  check(cards.filter(c => c.id.includes(`-${O.A}-`)).length === 1 && A && A.rows === 3 && A.pinned && A.date === `Today · ${today}`,
    `${O.A}: three rounds (UTC date ${setup.midnightUtc.slice(0, 10)}) in ONE card "${A && A.date}" — the hospital date, not the device/UTC date`)
  check(A && /Cards A/.test(A.head) && /1 mg/.test(A.head) && /IV · q1h/.test(A.head) && !(await page.$eval(`#${cardId(O.A, today)} .mdbody`, b => /Cards A/.test(b.textContent))),
    `header carries drug, dose, route · frequency once ("${A && A.head.trim()}"); the round rows do not repeat it`)
  check(!!A2 && A2.id !== A.id && /Cards A/.test(A2.head) && /q4h/.test(A2.head), `${O.A2}: same medication name, separate prescription -> its own card`)
  check(A && /held · documented/.test(A.text), 'held round labelled "held · documented <time>" (not an administration time)')
  const By = card('B', yesterday), Bt = card('B', today)
  check(By && By.pinned && By.acts === 1 && By.date === `Yesterday · ${yesterday}` && Bt && Bt.acts === 0 && Bt.rows === 0 && /earlier/.test(Bt.ref),
    `${O.B}: yesterday's outstanding round keeps its controls in the yesterday card; today's card only references it ("${Bt && Bt.refText.trim().slice(0, 90)}…")`)
  const Ct = card('C', today), Cm = card('C', tomorrow)
  check(Cm && Cm.pinned && Cm.acts === 1 && Cm.date === `Tomorrow · ${tomorrow}` && Ct && Ct.acts === 0 && Ct.rows === 1 && /later/.test(Ct.ref),
    `${O.C}: current round scheduled tomorrow -> open tomorrow card with the controls; today's card has today's dose + a "Next" reference`)
  const Dy = card('D', yesterday), Dt = card('D', today)
  check(Dy && !Dy.pinned && Dy.toggle === 'false' && /1 given/.test(Dy.text) && Dt && Dt.acts === 1,
    `${O.D}: the 23:00 round given 00:20 stays in the yesterday card (collapsed history, "1 given"); round 2 acts on today`)
  const Py = card('P', yesterday), Pt = card('P', today)
  check(Py && !Py.pinned && Pt && Pt.acts === 1 && Pt.rows === 2, `${O.P} PRN: yesterday's dose in a collapsed card; today's dose + availability (one control group) today`)
  const Ey = card('E', yesterday), Et = card('E', today)
  check(Ey && !Ey.pinned && Et && Et.acts === 1 && /ON DEMAND/.test(Et.text), `${O.E} on-demand: yesterday's dose collapsed; availability today`)
  const F = card('F', null)
  check(F && F.date === 'Date unavailable' && !F.pinned && cards[cards.length - 1].id === F.id, `${O.F}: undated legacy history -> "Date unavailable", collapsed, last`)
  const apiRows = setup.marRows
  const actionable = apiRows.filter(r => r.status === 'scheduled').length
  check(cards.reduce((n, c) => n + c.acts, 0) === actionable, `control groups on the page for this patient = actionable server rows = ${actionable} (none duplicated)`)
  /* collapsed history renders no rows — its header summary counts them */
  const summed = cards.reduce((n, c) => n + (c.toggle === 'false' ? (c.sum.match(/(\d+) (given|held|refused)/g) || []).reduce((k, m) => k + Number(m.split(' ')[0]), 0) : c.rows), 0)
  check(summed === apiRows.length, `rows in open cards + rows counted by collapsed cards = server rows = ${apiRows.length} (nothing generated, nothing lost)`)
  const counts = await page.evaluate(() => ({ aside: document.querySelector('.card .aside, [class*="aside"]')?.textContent ?? '', kpi: [...document.querySelectorAll('.kpi, [class*="kpi"]')].map(k => k.textContent).find(t => /Meds Due/.test(t)) ?? '' }))
  const expectDue = await page.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem('aurora.session') || 'null')
    const rows = await (await fetch('/api/icu/mar', { headers: { Authorization: 'Bearer ' + (s && s.token) } })).json()
    const now = Date.now()
    return rows.filter(r => r.status === 'scheduled' && !r.prn && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.scheduledTime)
      && (Date.parse(r.scheduledTime.replace(' ', 'T') + ':00Z') - now) / 60000 <= 30).length
  })
  const marAside = await page.evaluate(() => [...document.querySelectorAll('*')].map(e => e.childNodes.length === 1 && e.textContent).find(t => t && /due · administer & document only/.test(t)) || '')
  check(new RegExp(`^${expectDue} due`).test(marAside), `MAR due count "${marAside}" = the existing predicate over the server rows (${expectDue}) — not a card count`)
  /* the reference jump */
  await page.click(`#${cardId(O.B, today)} .mdjump`); await page.waitForTimeout(200)
  check(await page.evaluate(() => document.activeElement?.id) === cardId(O.B, yesterday), 'the reference button moves focus to the referenced yesterday card')

  console.log('\n[M2] historical expansion survives polling (stable card keys)')
  let marGets = 0
  page.on('response', r => { if (r.url().endsWith('/api/icu/mar') && r.request().method() === 'GET') marGets++ })
  await page.click(`#${cardId(O.D, yesterday)} .mdtoggle`); await page.waitForTimeout(200)
  const shownD = await page.$eval(`#${cardId(O.D, yesterday)}`, s => s.textContent)
  /* given 80 min after its scheduled time: no LATE marker (the marker's
     120 min rule is unchanged); the delay reason the server required at the
     documenting moment shows */
  check(/given at \d{4}-\d{2}-\d{2} 00:20/.test(shownD) && !/LATE/.test(shownD) && /CT/.test(shownD),
    `expanded: the round scheduled 23:00 shows its actual administration WITH its date ("${(shownD.match(/given at [^—]*/) || [''])[0].trim()}") and the delay reason`)
  await page.click(`#${cardId(O.F, null)} .mdtoggle`); await page.waitForTimeout(200)
  const shownF = await page.$eval(`#${cardId(O.F, null)}`, s => s.textContent)
  check(/08:00/.test(shownF) && /D-1 20:00/.test(shownF) && /refused · documented D-1 20:10/.test(shownF), 'Date unavailable rows show the legacy stamps exactly as stored')
  const t0 = Date.now()
  while (marGets < 1 && Date.now() - t0 < 30000) await page.waitForTimeout(500)
  await page.waitForTimeout(800)
  cards = await marCards(page)
  check(marGets >= 1 && card('D', yesterday).toggle === 'true' && card('F', null).toggle === 'true' && card('P', yesterday).toggle === 'false',
    `after ${marGets} poll refresh(es) of /api/icu/mar: both opened history cards stay open; untouched history stays collapsed`)

  console.log('\n[M3] screenshots + rendered contrast (dark)')
  fs.mkdirSync(SHOTS, { recursive: true })
  await groupShot(page, `${SHOTS}/dark-desktop-nurse-mar-daily-cards.png`)
  let cr = []
  for (const sel of ['.mardaycard .mddate', '.mardaycard .mdhead .mroute', '.mardaycard .mardoc', '.mardaycard .mdsum', '.mardaycard .markind', '.mdref', '.mdjump', '.mardaycard .marround'])
    cr = cr.concat(await renderedContrast(page, `#${cardId(O.A, today)} ${sel}, #${cardId(O.B, today)} ${sel}, #${cardId(O.C, today)} ${sel}, #${cardId(O.D, yesterday)} ${sel}, #${cardId(O.P, yesterday)} ${sel}, #${cardId(O.P, today)} ${sel}`.replace(/ \.mardaycard/g, '')))
  const minD = cr.reduce((m, x) => (x.cr < m.cr ? x : m), { cr: 99 })
  check(cr.length > 8 && minD.cr >= 4.5, `dark: ${cr.length} new text elements, lowest ${minD.cr.toFixed(2)}:1 ("${minD.t}" ${minD.sel})`)

  /* ---- midnight rollover (browser clock only; the same server rows) ---- */
  console.log('\n[M4] hospital midnight rollover on the page (browser clock moved to 23:59:30 hospital; shared useNow tick)')
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, colorScheme: 'dark', timezoneId: 'UTC' })
  const rp = await rctx.newPage()
  const nextMidnightUtc = Date.parse(setup.midnightUtc.replace(' ', 'T') + ':00Z') + 86_400_000
  await rp.clock.install({ time: nextMidnightUtc - 30_000 })
  await login(rp, 'maya.chen'); await rp.goto(BASE + '/nurse'); await rp.waitForLoadState('networkidle'); await rp.waitForTimeout(400)
  const before = await marCards(rp)
  const has = (cs, k, d) => cs.find(c => c.id === cardId(O[k], d))
  check(!!has(before, 'C', tomorrow) && has(before, 'C', tomorrow).date === `Tomorrow · ${tomorrow}` && !!has(before, 'P', today)?.acts,
    `23:59:30: ${O.C}'s current round is on "Tomorrow · ${tomorrow}"; PRN availability on ${today}`)
  await rp.clock.runFor(65_000); await rp.waitForTimeout(300)
  const after = await marCards(rp)
  const Cnow = has(after, 'C', tomorrow)
  check(Cnow && Cnow.date === `Today · ${tomorrow}` && Cnow.acts === 1 && !Cnow.ref, `00:00:35: the same card is now "Today · ${tomorrow}", controls inside, no reference`)
  check(has(after, 'P', tomorrow)?.acts === 1 && !has(after, 'P', today)?.acts && !has(after, 'P', today)?.pinned,
    `PRN availability moved to today's (${tomorrow}) card; ${today}'s PRN card became collapsed history`)
  check(has(after, 'B', yesterday)?.pinned && has(after, 'B', yesterday)?.acts === 1 && /earlier/.test(has(after, 'B', tomorrow)?.ref ?? ''),
    `${O.B}'s outstanding ${yesterday} round keeps its controls on its own (still open) card; a NEW today (${tomorrow}) card references it`)
  await groupShot(rp, `${SHOTS}/dark-desktop-nurse-mar-after-hospital-midnight.png`)
  await rctx.close()

  console.log('\n[M5] light theme + narrow layout')
  const lctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, colorScheme: 'light', timezoneId: 'UTC' })
  const lp = await lctx.newPage(); await login(lp, 'maya.chen'); await lp.goto(BASE + '/nurse'); await settle(lp); await lp.mouse.move(1400, 1300)
  check(await lp.evaluate(() => document.documentElement.dataset.theme) === 'light', 'light theme active')
  await lp.click(`#${cardId(O.D, yesterday)} .mdtoggle`); await lp.waitForTimeout(200)
  await groupShot(lp, `${SHOTS}/light-desktop-nurse-mar-daily-cards.png`)
  let crl = []
  for (const sel of ['.mddate', '.mdhead .mroute', '.mardoc', '.mdsum', '.markind', '.mdref', '.mdjump', '.marround'])
    crl = crl.concat(await renderedContrast(lp, `#${cardId(O.A, today)} ${sel}, #${cardId(O.B, today)} ${sel}, #${cardId(O.C, today)} ${sel}, #${cardId(O.D, yesterday)} ${sel}, #${cardId(O.P, yesterday)} ${sel}, #${cardId(O.P, today)} ${sel}`))
  const minL = crl.reduce((m, x) => (x.cr < m.cr ? x : m), { cr: 99 })
  check(crl.length > 8 && minL.cr >= 4.5, `light: ${crl.length} new text elements, lowest ${minL.cr.toFixed(2)}:1 ("${minL.t}" ${minL.sel})`)
  await lctx.close()
  const nctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark', timezoneId: 'UTC' })
  const np = await nctx.newPage(); await login(np, 'maya.chen'); await np.goto(BASE + '/nurse'); await settle(np)
  /* scoped to the MAR: the page itself overflows by the I&O card's totals
     row (.iototals) — pre-existing, not touched here, reported */
  const marOver = await np.evaluate(() => [...document.querySelectorAll('.margroup *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length)
  const pageOver = await np.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const acts = await np.$$eval(`#${cardId(O.B, yesterday)} .mab`, bs => bs.map(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right } }))
  check(marOver === 0 && acts.length === 3 && acts.every(a => a.h >= 36 && a.right <= 390), `390 px: no MAR element overflows (${marOver}); the three controls fit, ≥36 px tall (page overflow ${pageOver}px comes from the pre-existing I&O totals row, not the MAR)`)
  await groupShot(np, `${SHOTS}/dark-narrow390-nurse-mar-daily-cards.png`)
  await nctx.close()

  console.log('\n[M6] actions keep their original orderId + adminId; the MAR refreshes from the server')
  const posts = []
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/icu/mar/')) posts.push({ url: decodeURIComponent(new URL(r.url()).pathname), body: r.postDataJSON() }) })
  const curA = apiRows.find(r => r.orderId === O.A && r.status === 'scheduled')
  let gets0 = marGets
  await page.click(`#${cardId(O.A, today)} .mab.given`)
  await page.waitForResponse(r => r.url().includes(`/api/icu/mar/${O.A}/administrations/`) && r.request().method() === 'POST')
  while (marGets === gets0) await page.waitForTimeout(100)
  await page.waitForTimeout(400)
  cards = await marCards(page)
  check(posts[0] && posts[0].url === `/api/icu/mar/${O.A}/administrations/${curA.adminId}` && posts[0].body.action === 'given',
    `Given on ${O.A} posted to ${posts[0] && posts[0].url} (the server row's own adminId)`)
  const A3 = card('A', today)
  check(A3 && A3.rows === 4 && A3.acts === 1 && /round 4/.test(A3.text), `after the server refresh: the same today card holds rounds 1–3 + the new current round 4`)
  const curB = apiRows.find(r => r.orderId === O.B && r.status === 'scheduled')
  gets0 = marGets
  await page.click(`#${cardId(O.B, yesterday)} .mab.given`)
  await page.waitForSelector('#marReason')
  const dialogText = await page.$eval('.mardialog', d => d.textContent)
  await page.fill('#marReason', 'synthetic: given late (browser check)')
  await page.click('.mardialog .btn.primary')
  await page.waitForResponse(r => r.url().includes(`/api/icu/mar/${O.B}/administrations/`) && r.request().method() === 'POST')
  while (marGets === gets0) await page.waitForTimeout(100)
  await page.waitForTimeout(400)
  cards = await marCards(page)
  const pB = posts[1]
  check(/overdue/.test(dialogText) && pB && pB.url === `/api/icu/mar/${O.B}/administrations/${curB.adminId}` && pB.body.reason && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(pB.body.administeredAt),
    `yesterday's overdue round: the existing delay-reason dialog, posted to ${pB && pB.url} with reason + administeredAt ${pB && pB.body.administeredAt} (UTC wire)`)
  const By2 = card('B', yesterday), Bt2 = card('B', today)
  check(By2 && !By2.pinned && By2.toggle === 'false' && /1 given/.test(By2.text) && Bt2 && Bt2.acts === 1 && !Bt2.ref,
    `after the refresh: ${yesterday}'s card is completed history (collapsed, "1 given"); today's card now holds round 2 with the controls, no reference`)
  await page.close(); await ctx.close()
  await browser.close()
  console.log(`\nRESULT: ${passes} passed, ${fails} failed`)
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
