// Rolling-timer display + dark-theme regression (Chromium, real stack).
// The DEVICE clock is UTC on purpose: every time must render on the SERVER's
// zone (Asia/Baghdad, UTC+3) from the UTC wire — storage never shifts.
const { chromium, BASE, login, geom } = require('./lib.cjs')
const [SHOTS, SETUP] = process.argv.slice(2)
const setup = JSON.parse(require('fs').readFileSync(SETUP, 'utf8'))
let fails = 0, passes = 0
const check = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
const baghdad = utc => { const d = new Date(utc.replace(' ', 'T') + ':00Z'); d.setUTCHours(d.getUTCHours() + 3); return d.toISOString().slice(11, 16) }
const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

/* contrast against what is actually RENDERED: the control's own screenshot,
   decoded in-page on a canvas; the dominant pixel colour is its background
   (gradients, translucency and hover included), measured against the
   computed text colour */
async function renderedContrast(page, selector) {
  const els = await page.$$(selector)
  const out = []
  for (const el of els) {
    if (!(await el.isVisible())) continue
    const b64 = (await el.screenshot()).toString('base64')
    const r = await page.evaluate(async ([b64, fg]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const x = c.getContext('2d'); x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, c.width, c.height).data, hist = new Map()
      for (let i = 0; i < d.length; i += 4) { const k = `${d[i] >> 2},${d[i + 1] >> 2},${d[i + 2] >> 2}`; hist.set(k, (hist.get(k) || 0) + 1) }
      const [k] = [...hist.entries()].sort((a, b) => b[1] - a[1])[0]
      const bg = k.split(',').map(v => (Number(v) << 2) + 2)
      return { bg: `rgb(${bg.join(', ')})`, fg }
    }, [b64, await el.evaluate(e => getComputedStyle(e).color)])
    out.push({ t: (await el.textContent()).trim().slice(0, 22), on: await el.evaluate(e => e.classList.contains('on') || e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-selected') === 'true'), ...r, cr: contrast(r.fg, r.bg) })
  }
  return out
}
;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', timezoneId: 'UTC' })
  const page = await ctx.newPage()
  const G = setup.given, H = setup.held
  console.log(`setup: ${setup.pid} · given actual ${G.actualUtc} UTC (Baghdad ${baghdad(G.actualUtc)}) -> next ${G.nextUtc} UTC (Baghdad ${baghdad(G.nextUtc)}) · held slot ${H.slotUtc} -> next ${H.nextUtc}`)

  console.log('\n[1] dark theme + server zone')
  await login(page, 'maya.chen')
  const env = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, device: Intl.DateTimeFormat().resolvedOptions().timeZone }))
  check(env.theme === 'dark' && env.device === 'UTC', `theme=${env.theme}, device zone=${env.device} (display must follow the server zone, not the device)`)

  console.log('\n[2] nurse MAR: the current rounds, their timers and the actual time, on Asia/Baghdad')
  await page.goto(BASE + '/nurse'); await page.waitForLoadState('networkidle'); await page.mouse.move(1400, 500)
  await page.evaluate(n => [...document.querySelectorAll('.margroup')].find(x => x.textContent.includes(n))?.scrollIntoView({ block: 'start' }), setup.name)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/dark-desktop1440-nurse-mar-rolling-baghdad.png` })
  const rows = await page.evaluate(n => [...[...document.querySelectorAll('.margroup')].find(x => x.textContent.includes(n)).querySelectorAll('.marrow')].map(r => r.innerText.replace(/\s+/g, ' ').trim()), setup.name)
  rows.forEach(r => console.log('    ' + r))
  const gRows = rows.filter(r => r.includes('Display G')), hRows = rows.filter(r => r.includes('Display H')), wRows = rows.filter(r => r.includes('Display W'))
  check(gRows.length === 2 && gRows.some(r => r.startsWith(baghdad(G.nextUtc)) && /round 2/.test(r) && r.includes(`timed from the dose given ${baghdad(G.actualUtc)}`)),
    `given order: ONE current round 2 at ${baghdad(G.nextUtc)} (Baghdad), "timed from the dose given ${baghdad(G.actualUtc)}"`)
  check(gRows.some(r => /GIVEN/.test(r) && /round 1/.test(r) && r.includes(`documented ${baghdad(G.actualUtc)}`)), `the round-1 fact shows its actual time ${baghdad(G.actualUtc)} Baghdad (stored ${G.actualUtc} UTC)`)
  check(hRows.length === 2 && hRows.some(r => r.startsWith(baghdad(H.nextUtc)) && /round 2/.test(r) && r.includes(`timed from the skipped dose due ${baghdad(H.slotUtc)}`)),
    `held order: round 2 at ${baghdad(H.nextUtc)}, "timed from the skipped dose due ${baghdad(H.slotUtc)}"`)
  check(wRows.length === 1 && /round 1/.test(wRows[0]) && /LATER|DUE/.test(wRows[0]), 'an untouched order shows only its round 1')
  const kpi = await page.evaluate(() => document.body.innerText.match(/(\d+)\s*MEDS DUE/i)?.[1])
  const aside = await page.evaluate(() => document.body.innerText.match(/(\d+) due · administer/)?.[1])
  check(kpi !== undefined && kpi === aside, `due counts agree: Meds-Due KPI ${kpi} = MAR card ${aside}`)

  console.log('\n[3] Orders next-dose chip = the MAR current round (doctor)')
  const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', timezoneId: 'UTC' })).newPage()
  await login(p2, 'sara.rahman')
  await p2.goto(BASE + `/orders/${setup.pid}`); await p2.waitForLoadState('networkidle'); await p2.mouse.move(1400, 500)
  await p2.click('.oftype:has-text("Medication")'); await p2.waitForTimeout(250)
  const chips = await p2.$$eval('.oorow', rs => rs.map(r => ({ sum: r.querySelector('.oosum')?.textContent ?? '', next: r.querySelector('.oonext')?.textContent ?? null })))
  chips.forEach(c => console.log(`    ${c.sum.split(' · ')[0]} -> ${c.next}`))
  check(chips.some(c => c.sum.includes('Display G') && c.next && c.next.includes(baghdad(G.nextUtc))) && chips.some(c => c.sum.includes('Display H') && c.next && c.next.includes(baghdad(H.nextUtc))),
    'Orders chips show the same current rounds (Baghdad)')
  await p2.screenshot({ path: `${SHOTS}/dark-desktop1440-doctor-orders-medication-filter-collapsed.png` })

  console.log('\n[4] dark theme: the type-filter row and the sidebar stay readable')
  const filt = await renderedContrast(p2, '.oftypelbl, .oftype, .oftab')
  filt.forEach(f => console.log(`    ${f.on ? '[on] ' : '     '}${f.t.padEnd(18)} ${f.cr.toFixed(2)}:1  (text ${f.fg} on rendered ${f.bg})`))
  check(filt.length >= 9 && filt.every(f => f.cr >= 4.5), `every filter label/button >= 4.5:1 against its rendered background (${filt.length} controls; lowest ${Math.min(...filt.map(f => f.cr)).toFixed(2)}:1)`)
  await p2.mouse.move(30, 300); await p2.waitForTimeout(450)
  const g = await geom(p2)
  check(g && g.open && g.labelsVisible === g.items.length, `hover expands the rail: ${g && g.navWidth}px, ${g && g.labelsVisible}/${g && g.items.length} labels`)
  const nav = await renderedContrast(p2, '.nav-sidebar .nv')
  nav.forEach(n => console.log(`    ${n.on ? '[on] ' : '     '}${n.t.padEnd(22)} ${n.cr.toFixed(2)}:1`))
  check(nav.length >= 10 && nav.every(n => n.cr >= 4.5), `every expanded sidebar item >= 4.5:1 against its rendered background, incl. the active and the hovered item (${nav.length} items; lowest ${Math.min(...nav.map(n => n.cr)).toFixed(2)}:1)`)
  await p2.screenshot({ path: `${SHOTS}/dark-desktop1440-doctor-orders-sidebar-expanded.png` })

  console.log('\n[5] printed MAR: round per cell, next dose per active order (Baghdad)')
  await page.goto(BASE + `/print/mar/${setup.pid}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/dark-desktop1440-nurse-print-mar-rolling.png`, fullPage: true })
  const heads = await page.$$eval('.pd-mar-head', hs => hs.map(h => h.innerText.replace(/\s+/g, ' ').trim()))
  const cells = await page.$$eval('.pd-mar-cell', cs => cs.map(c => c.innerText.replace(/\s+/g, ' ').trim()))
  heads.forEach(h => console.log('    ' + h)); cells.forEach(c => console.log('      cell: ' + c))
  check(heads.some(h => h.includes('Display G') && h.includes('next dose due') && h.includes(baghdad(G.nextUtc))) && heads.some(h => h.includes('Display H') && h.includes(baghdad(H.nextUtc))),
    'print: each active repeating order states its next dose (the current round, Baghdad)')
  check(cells.some(c => /GIVEN/.test(c) && /round 1/.test(c) && c.includes(baghdad(G.actualUtc))) && cells.some(c => /HELD/.test(c) && /round 1/.test(c)), 'print: the resolved rounds print with their round and actual time')
  await browser.close()
  console.log(`\nRESULT: ${passes} passed, ${fails} failed`)
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
