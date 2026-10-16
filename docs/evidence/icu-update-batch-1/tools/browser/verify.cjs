// Browser verification of the batch against the LOCAL real stack (server +
// PostgreSQL, synthetic data). Screenshots: <viewport>-<role>-<page>-<state>.png
const { chromium, BASE, login, geom } = require('./lib.cjs')
const SHOTS = process.argv[2]
const KEEP_PID = process.argv[3]            // the kept-open synthetic patient with re-timed orders
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
let fails = 0
const check = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++ }
const FORBIDDEN = ['Reception', 'Awaiting Bed', 'AI Assistant']
async function shot(page, name) { await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
async function hoverOpen(page) { await page.mouse.move(30, 320); await page.waitForTimeout(450) }
async function pointerAway(page) { const v = page.viewportSize(); await page.mouse.move(v.width - 40, 320); await page.waitForTimeout(600) }

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE })

  /* ============ 1. DESKTOP 1440×900 — doctor (Consultant) ============ */
  console.log('\n[1] desktop 1440×900 · doctor sara.rahman (Consultant)')
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  let page = await ctx.newPage()
  await login(page, 'sara.rahman')
  for (const [path, label, next] of [['/beds', 'beds', 'MAIN'], ['/orders/P-1001', 'orders', 'ptrail'], ['/labs/P-1001', 'labs', 'ptrail'], ['/lab-entry/P-1001', 'labentry', 'ptrail'], ['/doctor', 'doctor-workspace', 'MAIN']]) {
    await page.goto(BASE + path); await page.waitForLoadState('networkidle'); await pointerAway(page)
    const c = await geom(page)
    await shot(page, `desktop1440-doctor-${label}-collapsed`)
    await hoverOpen(page)
    const e = await geom(page)
    await shot(page, `desktop1440-doctor-${label}-expanded`)
    check(c && !c.open && c.navWidth === 64 && c.labelsVisible === 0 && c.cols.startsWith('64px'), `${path}: collapsed rail 64px, icons only (cols ${c && c.cols})`)
    check(e && e.open && e.navWidth === 198 && e.labelsVisible === e.items.length && e.footVisible && e.cols.startsWith('198px'), `${path}: hover → labeled 198px + footer (cols ${e && e.cols})`)
    check(c && e && c.nextLeft === 64 && e.nextLeft === 198, `${path}: next column (${c && c.nextClass}) starts at the rail edge — content uses the freed space (${c && c.nextLeft} → ${e && e.nextLeft})`)
    if (label === 'beds') check(/278px$/.test(c.cols) && /278px$/.test(e.cols), '/beds: bed-detail panel column (278px) preserved in both states')
    if (['orders', 'labs', 'labentry'].includes(label)) check(/ 240px /.test(c.cols) && / 240px /.test(e.cols), `${path}: patient rail column (240px) preserved in both states`)
    await pointerAway(page)
  }

  console.log('\n[1b] pointer behaviour on /orders/P-1001')
  await page.goto(BASE + '/orders/P-1001'); await page.waitForLoadState('networkidle'); await pointerAway(page)
  // a pointer merely crossing the rail does not expand it (hover intent)
  await page.mouse.move(30, 300); await page.waitForTimeout(40); await page.mouse.move(700, 300); await page.waitForTimeout(400)
  check(!(await geom(page)).open, 'fast crossing (40 ms inside) → stays collapsed')
  await page.mouse.move(40, 300); await page.waitForTimeout(450)
  check((await geom(page)).open, 'resting inside → expands')
  await page.mouse.move(120, 300, { steps: 5 }); await page.mouse.move(185, 520, { steps: 5 }); await page.waitForTimeout(400)
  check((await geom(page)).open, 'moving into the expanded (label) area → stays open')
  // the edge-race: leave just past the edge and come back before the close delay → no flicker
  await page.mouse.move(205, 520); await page.waitForTimeout(80); await page.mouse.move(190, 520); await page.waitForTimeout(400)
  check((await geom(page)).open, 'brief exit past the edge and back within the close delay → no collapse/flicker')
  await page.mouse.move(900, 520); await page.waitForTimeout(600)
  check(!(await geom(page)).open, 'leaving → collapses')

  console.log('\n[1c] keyboard focus keeps it open; mouse-click focus does not pin it')
  await page.focus('.nav-sidebar .nv.on'); await page.keyboard.press('Tab'); await page.waitForTimeout(250)
  check((await geom(page)).open, 'Tab onto a nav item (focus-visible) → expanded while the pointer is away')
  await page.keyboard.press('Tab'); await page.waitForTimeout(250)
  check((await geom(page)).open, 'Tab to the next item → still expanded')
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow)
  check(ring && ring !== 'none', `focused item shows a visible focus ring (${ring && ring.slice(0, 40)}…)`)
  await page.evaluate(() => { const m = document.querySelector('main'); m.setAttribute('tabindex', '-1'); m.focus() })
  await page.waitForTimeout(300)
  check(!(await geom(page)).open, 'focus leaves the sidebar with the pointer away → collapses')
  await page.mouse.move(40, 200); await page.waitForTimeout(450)
  await page.mouse.click(40, 250)   // the active-ish row under the pointer; a click navigates
  await page.waitForLoadState('networkidle'); await page.mouse.move(900, 400); await page.waitForTimeout(600)
  check(!(await geom(page)).open, `after a mouse click + pointer away → collapsed (click focus never pins it); at ${new URL(page.url()).pathname}`)

  console.log('\n[1d] expanding never remounts the page, loses drafts/scroll, or sends clinical requests')
  await page.goto(BASE + '/orders/P-1001'); await page.waitForLoadState('networkidle'); await pointerAway(page)
  const search = page.locator('.omsearch input').first()
  await search.fill('mero'); await page.waitForTimeout(300)
  await page.evaluate(() => { document.querySelector('main').__probe = 'same-node'; document.querySelector('main').scrollTop = 260 })
  const before = await page.evaluate(() => document.querySelector('main').scrollTop)
  const reqs = []; const onReq = r => { if (r.url().includes('/api/')) reqs.push(r.method() + ' ' + new URL(r.url()).pathname) }
  page.on('request', onReq)
  for (let i = 0; i < 3; i++) { await hoverOpen(page); await pointerAway(page) }
  await page.focus('.nav-sidebar .nv'); await page.keyboard.press('Tab'); await page.waitForTimeout(200)
  await page.evaluate(() => document.querySelector('main').focus()); await page.waitForTimeout(300)
  page.off('request', onReq)
  const after = await page.evaluate(() => ({ probe: document.querySelector('main').__probe, top: document.querySelector('main').scrollTop, draft: document.querySelector('.omsearch input').value }))
  check(after.probe === 'same-node', 'main element is the same DOM node after 3 hover cycles + a focus cycle (no remount)')
  check(after.draft === 'mero', `new-order search draft preserved ("${after.draft}")`)
  check(Math.abs(after.top - before) <= 1, `main scrollTop preserved (${before} → ${after.top})`)
  check(!reqs.some(r => /^(POST|PUT|DELETE)/.test(r)), `no clinical writes during hover/focus (requests: ${reqs.length ? reqs.join(', ') : 'none'})`)

  console.log('\n[1e] patient context: the sidebar carries the viewed patient across sections')
  await page.goto(BASE + '/orders/P-1003'); await page.waitForLoadState('networkidle')
  await hoverOpen(page); await page.click('.nav-sidebar .nv[aria-label="Labs & Imaging"]'); await page.waitForLoadState('networkidle')
  check(new URL(page.url()).pathname === '/labs/P-1003', `Orders P-1003 → Labs & Imaging lands on ${new URL(page.url()).pathname}`)
  const activeName = await page.getAttribute('.nav-sidebar .nv[aria-current="page"]', 'aria-label')
  check(activeName === 'Labs & Imaging', `active section indicated (aria-current) = ${activeName}`)

  console.log('\n[1f] reduced motion: no transition')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const tr = await page.evaluate(() => getComputedStyle(document.querySelector('.shell')).transitionDuration)
  check(tr === '0s', `prefers-reduced-motion → .shell transition-duration ${tr}`)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const tr2 = await page.evaluate(() => getComputedStyle(document.querySelector('.shell')).transitionDuration)
  check(tr2 === '0.16s', `default motion → ${tr2}`)
  await ctx.close()

  /* ============ 2. ORDERS type filters (doctor) ============ */
  console.log('\n[2] Orders — type × status filters (doctor, desktop 1440×900)')
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await ctx.newPage()
  await login(page, 'sara.rahman')
  await page.goto(BASE + '/orders/P-1001'); await page.waitForLoadState('networkidle'); await pointerAway(page)
  const state = () => page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.oftab')].map(t => ({ label: t.childNodes[0].textContent, n: +t.querySelector('.n').textContent, sel: t.getAttribute('aria-selected') }))
    const types = [...document.querySelectorAll('.oftype')].map(t => ({ label: t.textContent, pressed: t.getAttribute('aria-pressed') }))
    const rows = [...document.querySelectorAll('.oorow')].map(r => ({ cat: r.querySelector('.oor1 .badge, .oor1 span')?.textContent, status: r.querySelector('.oostatus').textContent }))
    const empty = document.querySelector('.orderlist .omempty')?.textContent ?? null
    const acts = [...document.querySelectorAll('.ooacts button')].map(b => b.textContent.trim().split(' ')[1] || b.textContent.trim())
    return { tabs, types, rows, empty, acts, groupLabel: document.querySelector('.oftypes')?.getAttribute('aria-labelledby') && document.getElementById(document.querySelector('.oftypes').getAttribute('aria-labelledby'))?.textContent }
  })
  let s0 = await state()
  check(s0.types.map(t => t.label).join('|') === 'All types|Medication|Laboratory|Imaging' && s0.types[0].pressed === 'true', `type row: ${s0.types.map(t => t.label + (t.pressed === 'true' ? '*' : '')).join(' · ')} (labelled "${s0.groupLabel}")`)
  check(s0.tabs.map(t => t.label).join('|') === 'All|Pending|Active|Completed|Discontinued', `status tabs preserved: ${s0.tabs.map(t => `${t.label} ${t.n}`).join(' · ')}`)
  const all = s0.rows
  await shot(page, 'desktop1440-doctor-orders-filters-default')
  for (const [type, cat] of [['Medication', 'MEDICATION'], ['Laboratory', 'LAB'], ['Imaging', 'IMAGING']]) {
    await page.click(`.oftype:has-text("${type}")`); await page.waitForTimeout(150)
    const s = await state()
    const byStatus = st => all.filter(r => r.cat === cat && (st === 'All' || r.status.startsWith(st.toUpperCase().replace('PENDING', 'PENDING')))).length
    check(s.rows.every(r => r.cat === cat) && s.rows.length === all.filter(r => r.cat === cat).length, `${type}: ${s.rows.length} rows, all ${cat}`)
    check(s.tabs.every(t => t.n === byStatus(t.label)), `${type}: status counts describe the type → ${s.tabs.map(t => `${t.label} ${t.n}`).join(' · ')}`)
  }
  // AND: Active + Laboratory ; Completed + Imaging
  await page.click('.oftype:has-text("Laboratory")'); await page.click('.oftab:has-text("Active")'); await page.waitForTimeout(150)
  let s = await state()
  check(s.rows.every(r => r.cat === 'LAB' && r.status === 'ACTIVE'), `Active + Laboratory → ${s.rows.length} rows, all active lab${s.empty ? ` · empty: "${s.empty}"` : ''}`)
  await shot(page, 'desktop1440-doctor-orders-active-laboratory')
  await page.click('.oftype:has-text("Imaging")'); await page.click('.oftab:has-text("Completed")'); await page.waitForTimeout(150)
  s = await state()
  check(s.rows.every(r => r.cat === 'IMAGING' && r.status === 'COMPLETED'), `Completed + Imaging → ${s.rows.length} rows`)
  if (!s.rows.length) check(s.empty === 'No completed imaging orders for this patient.', `combined empty state: "${s.empty}"`)
  await shot(page, 'desktop1440-doctor-orders-completed-imaging')
  // keyboard: Tab to the type row and toggle with Space
  await page.focus('.oftype:has-text("All types")'); await page.keyboard.press('Space'); await page.waitForTimeout(100)
  s = await state()
  check(s.types[0].pressed === 'true' && s.tabs.find(t => t.sel === 'true').label === 'Completed', 'keyboard Space on "All types" → pressed; status selection (Completed) kept')
  await page.click('.oftab:has-text("All")'); await page.waitForTimeout(100)
  s = await state()
  check(s.rows.length === all.length, `All + All types → all ${all.length} orders (Nursing and every category included: ${[...new Set(all.map(r => r.cat))].join(', ')})`)
  // IN-APP patient change (the patient rail — no reload): the selection
  // stays and applies to the new patient's orders; counts follow
  await page.click('.oftype:has-text("Medication")'); await page.click('.oftab:has-text("Active")'); await page.waitForTimeout(150)
  const ptBtns = await page.$$eval('.ptrail button', bs => bs.map(b => b.textContent.trim().slice(0, 40)))
  await page.click('.ptrail button:has-text("Susan Wright")'); await page.waitForURL(u => u.pathname === '/orders/P-1004'); await page.waitForTimeout(800)
  s = await state()
  const pressed = s.types.find(t => t.pressed === 'true').label, selTab = s.tabs.find(t => t.sel === 'true').label
  check(pressed === 'Medication' && selTab === 'Active' && s.rows.every(r => r.cat === 'MEDICATION' && r.status === 'ACTIVE'),
    `rail → P-1004 (in-app, ${ptBtns.length} rail patients): selection kept (${pressed} + ${selTab}), ${s.rows.length} rows all active medication; counts ${s.tabs.map(t => `${t.label} ${t.n}`).join(' · ')}`)
  const listEmpty = await page.evaluate(() => document.querySelector('.orderlist .omempty')?.textContent ?? null)
  if (!s.rows.length) check(listEmpty === 'No active medication orders for this patient.', `empty: "${listEmpty}"`)
  await shot(page, 'desktop1440-doctor-orders-P1004-active-medication')
  await page.click('.oftab:has-text("All")'); await page.click('.oftype:has-text("All types")'); await page.waitForTimeout(100)
  check(s0.acts.includes('Sign') || s0.acts.includes('Modify') || s0.acts.includes('Discontinue'), `doctor actions present on unfiltered list: ${[...new Set(s0.acts)].join(', ')}`)
  // narrow wrap
  await page.setViewportSize({ width: 900, height: 900 }); await page.waitForTimeout(200)
  const wrap = await page.evaluate(() => { const r = document.querySelector('.oftypes').getBoundingClientRect(); return { w: Math.round(r.width), overflow: document.querySelector('.oftypes').scrollWidth > document.querySelector('.oftypes').clientWidth + 1 } })
  check(!wrap.overflow, `900px: type row fits/wraps without horizontal overflow (${wrap.w}px)`)
  await shot(page, 'narrow900-doctor-orders-filters')
  await ctx.close()

  /* ============ 3. the 1180 breakpoint + labels below it ============ */
  console.log('\n[3] 1180×820 and 1000×800 — below the old icon-only breakpoint')
  for (const [w, h] of [[1180, 820], [1000, 800]]) {
    ctx = await browser.newContext({ viewport: { width: w, height: h } }); page = await ctx.newPage()
    await login(page, 'sara.rahman')
    for (const path of ['/orders/P-1001', '/beds', '/lab-entry/P-1001']) {
      await page.goto(BASE + path); await page.waitForLoadState('networkidle'); await pointerAway(page)
      const c = await geom(page); await hoverOpen(page); const e = await geom(page)
      const tag = path.split('/')[1]
      await shot(page, `w${w}-doctor-${tag}-expanded`); await pointerAway(page); await shot(page, `w${w}-doctor-${tag}-collapsed`)
      check(c.navWidth === 64 && e.navWidth === 198 && e.labelsVisible === e.items.length && !e.overlay, `${w}px ${path}: 64 → 198 with labels (push, cols ${c.cols} → ${e.cols})`)
      check(c.nextLeft === 64 && e.nextLeft === 198, `${w}px ${path}: content follows the rail (${c.nextLeft} → ${e.nextLeft})`)
    }
    await ctx.close()
  }

  /* ============ 4. SHORT viewport: every section reachable ============ */
  console.log('\n[4] short viewport 1280×480 — the nav scrolls, every permitted section reachable')
  ctx = await browser.newContext({ viewport: { width: 1280, height: 480 } }); page = await ctx.newPage()
  await login(page, 'sara.rahman')
  await page.goto(BASE + '/orders/P-1001'); await page.waitForLoadState('networkidle'); await pointerAway(page)
  for (const st of ['collapsed', 'expanded']) {
    if (st === 'expanded') await hoverOpen(page)
    const g = await geom(page)
    await page.evaluate(() => { const n = document.querySelector('.nav-sidebar'); n.scrollTop = n.scrollHeight })
    const last = await page.evaluate(() => { const n = document.querySelector('.nav-sidebar'); const b = [...n.querySelectorAll('.nv')].pop(); const r = b.getBoundingClientRect(), nr = n.getBoundingClientRect(); return { name: b.getAttribute('aria-label'), inView: r.top >= nr.top - 1 && r.bottom <= nr.bottom + 1 } })
    check(g.scroll.h > g.scroll.ch && last.inView, `${st}: nav scrolls (${g.scroll.h} > ${g.scroll.ch}) and the last item "${last.name}" scrolls into view`)
    await shot(page, `short1280x480-doctor-orders-${st}-scrolled`)
    await page.evaluate(() => { document.querySelector('.nav-sidebar').scrollTop = 0 })
  }
  await ctx.close()

  /* ============ 5. TOUCH: phone 390×844 (overlay drawer) + tablet 1024×768 (push) ============ */
  console.log('\n[5] touch — iPhone-size 390×844 (hasTouch, isMobile) and tablet 1024×768')
  for (const [w, h, label] of [[390, 844, 'phone390'], [1024, 768, 'tablet1024']]) {
    ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true }); page = await ctx.newPage()
    await login(page, 'maya.chen')
    await page.goto(BASE + '/orders/P-1001'); await page.waitForLoadState('networkidle')
    let g = await geom(page)
    check(g.toggle === 'false' && !g.open, `${label}: tap toggle present, aria-expanded=false, collapsed`)
    const tname = await page.getAttribute('.nvtoggle', 'aria-label')
    check(tname === 'Section menu', `${label}: toggle accessible name "${tname}"`)
    await shot(page, `${label}-nurse-orders-collapsed`)
    // a tap on a section navigates and does NOT open the sidebar first
    await page.tap('.nav-sidebar .nv[aria-label="Labs & Imaging"]'); await page.waitForLoadState('networkidle')
    g = await geom(page)
    check(new URL(page.url()).pathname.startsWith('/labs') && !g.open, `${label}: tapping a section icon navigates (${new URL(page.url()).pathname}), sidebar stays collapsed`)
    await page.tap('.nvtoggle'); await page.waitForTimeout(350)
    g = await geom(page)
    check(g.open && g.toggle === 'true' && new URL(page.url()).pathname.startsWith('/labs'), `${label}: toggle → expanded, aria-expanded=true, no navigation`)
    if (w <= 760) check(g.overlay && g.navWidth === 198 && g.cols.startsWith('64px') && g.nextLeft === 64, `${label}: narrow → overlay drawer (column stays ${g.cols.split(' ')[0]}, content does not move)`)
    else check(!g.overlay && g.cols.startsWith('198px') && g.nextLeft === 198, `${label}: room to push → column 198px, content follows`)
    await shot(page, `${label}-nurse-labs-expanded`)
    await page.tap('.nvtoggle'); await page.waitForTimeout(350)
    check(!(await geom(page)).open, `${label}: toggle again → collapsed`)
    if (w <= 760) {
      await page.tap('.nvtoggle'); await page.waitForTimeout(300)
      await page.tap('main', { position: { x: 200, y: 300 } }).catch(async () => { await page.touchscreen.tap(300, 400) })
      await page.waitForTimeout(300)
      check(!(await geom(page)).open, `${label}: tap outside the drawer closes it`)
    }
    await page.tap('.nvtoggle'); await page.waitForTimeout(300)
    await page.tap('.nav-sidebar .nv[aria-label="Timeline"]'); await page.waitForLoadState('networkidle')
    check(new URL(page.url()).pathname.startsWith('/timeline') && !(await geom(page)).open, `${label}: open drawer → tap a section → navigates to ${new URL(page.url()).pathname}, closed`)
    // keyboard focus on the toggle is visible
    await page.focus('.nvtoggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
    const k = await page.evaluate(() => ({ exp: document.querySelector('.nvtoggle').getAttribute('aria-expanded'), ring: getComputedStyle(document.querySelector('.nvtoggle')).boxShadow }))
    check(k.exp === 'true', `${label}: keyboard Enter on the toggle → aria-expanded=${k.exp}`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    check((await page.getAttribute('.nvtoggle', 'aria-expanded')) === 'false', `${label}: Escape closes, focus returns to the toggle`)
    await ctx.close()
  }

  /* ============ 6. ROLE variants (desktop, expanded) ============ */
  console.log('\n[6] navigation variants per role (desktop 1440×900, expanded)')
  const roles = [['sara.rahman', 'doctor', '/beds'], ['maya.chen', 'nurse', '/nurse'], ['yusuf.karim', 'hospital-administrator', null], ['alex.novak', 'it-administrator', null], ['samir.qassem', 'pharmacist', null], ['noor.al-amin', 'lab-technician', null]]
  for (const [user, role] of roles) {
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await ctx.newPage()
    await login(page, user); await page.waitForTimeout(400)
    await pointerAway(page)
    const c = await geom(page)
    if (!c) { check(false, `${role}: no NavSidebar on landing ${page.url()}`); await ctx.close(); continue }
    await shot(page, `desktop1440-${role}-landing-collapsed`)
    await hoverOpen(page); const e = await geom(page)
    await shot(page, `desktop1440-${role}-landing-expanded`)
    check(c.navWidth === 64 && e.navWidth >= 198 && e.labelsVisible === e.items.length, `${role} (${new URL(page.url()).pathname}): 64 → ${e.navWidth}, ${e.items.length} items: ${e.items.join(', ')}`)
    check(!e.items.some(i => FORBIDDEN.includes(i)), `${role}: no Reception / Awaiting Bed / AI Assistant`)
    await ctx.close()
  }

  /* ============ 7. MAR re-timing in the browser (nurse) + Orders chip + print ============ */
  if (KEEP_PID) {
    console.log(`\n[7] re-timed MAR in the browser — synthetic ${KEEP_PID}`)
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await ctx.newPage()
    await login(page, 'maya.chen')
    await page.goto(BASE + '/nurse'); await page.waitForLoadState('networkidle'); await pointerAway(page)
    const grp = page.locator('.margroup', { hasText: 'Retime' })
    const n = await grp.count()
    check(n === 1, `nurse MAR shows the synthetic patient group (${n})`)
    if (n) {
      await grp.scrollIntoViewIfNeeded()
      const marks = await grp.locator('.marretimed').count()
      check(marks >= 5, `MAR marks re-timed doses (${marks} "↻ next dose re-timed")`)
      await grp.screenshot({ path: `${SHOTS}/desktop1440-nurse-mar-retimed.png` })
    }
    await page.goto(BASE + `/orders/${KEEP_PID}`); await page.waitForLoadState('networkidle'); await pointerAway(page)
    await page.click('.oftype:has-text("Medication")'); await page.click('.oftab:has-text("Active")'); await page.waitForTimeout(200)
    const chips = await page.$$eval('.oorow', rs => rs.map(r => ({ sum: r.querySelector('.oosum').textContent, next: r.querySelector('.oonext')?.textContent ?? null })))
    console.log('    orders next-dose chips: ' + chips.map(c => `${c.sum.split(' · ')[0]} → ${c.next}`).join(' | '))
    check(chips.length >= 4 && chips.every(c => c.next === null || c.next.startsWith('next dose')), 'Orders (Active + Medication) renders next-dose chips for the re-timed orders')
    await shot(page, `desktop1440-nurse-orders-${KEEP_PID}-active-medication`)
    await ctx.close()
  }
  await browser.close()
  console.log(`\nBROWSER VERIFY ${fails ? `FAILED (${fails})` : 'PASSED'}`)
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
