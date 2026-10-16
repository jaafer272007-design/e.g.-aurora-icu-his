/* Session 2 — focused browser verification of the patient chart
   (MissionControl) against the synthetic API in synthetic-api.cjs.

   usage: node chart-verify.cjs <baseUrl> <screenshotDir>
   (the dev bundle served by `npx vite`; Playwright's bundled Chromium) */
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const { install, ROSTER_NAMES } = require('./synthetic-api.cjs')

const BASE = process.argv[2] || 'http://localhost:5173'
const SHOTS = process.argv[3] || '.'
const A = 'P-1001', B = 'P-1002', C = 'P-1003', D = 'P-1004', E = 'P-1005'
const NAME = ROSTER_NAMES
/* MODE=production: the production-mode bundle (no mock layer) — only the
   checks whose outcome differs by mode are restricted to it */
const PROD = process.env.MODE === 'production'
const A_MARKERS = ['Alphamycin', 'Alphanorepine', 'Alpha chest film', 'Alphacetamol']
const B_MARKERS = ['Betamycin', 'Beta chest film']

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function open(browser, jobTitle, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1600, height: 2400 }, colorScheme: opts.theme ?? 'light' })
  const ctl = { delays: {}, log: [], puts: [], putDelay: 0, prod: PROD }
  await install(ctx, ctl)
  await ctx.addInitScript(([title, theme]) => {
    sessionStorage.setItem('aurora.session', JSON.stringify({ name: `Synthetic ${title}`, jobTitle: title }))
    sessionStorage.setItem('aurora.prefs', JSON.stringify({ theme, timeFormat: '24h' }))
  }, [jobTitle, opts.theme ?? 'light'])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`))
  return { ctx, ctl, page }
}

const mainText = page => page.$eval('main', m => m.innerText)
const has = async (page, sel) => (await page.$(sel)) !== null
async function settle(page, ms = 1500) { await page.waitForTimeout(ms) }
async function goto(page, pid) { await page.goto(`${BASE}/patients/${pid}`); await settle(page) }

;(async () => {
  const browser = await chromium.launch()

  /* ---------------- 1. doctor (Consultant) on A ---------------- */
  {
    const { ctx, ctl, page } = await open(browser, 'Consultant')
    await goto(page, A)
    const t = await mainText(page)
    const mon = await page.$eval('#monitor', m => m.innerText)
    check('doctor: combined card has Bedside / Ventilator / Hemodynamics groups',
      ['Bedside', 'Ventilator', 'Hemodynamics'].every(g => mon.toUpperCase().includes(g.toUpperCase())))
    const labels = await page.$$eval('#monitor .obcell .lbl', ls => ls.map(l => l.textContent))
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i)
    check('doctor: every reading label appears once (no duplicate CVP etc.)', dupes.length === 0, `dupes=${dupes}`)
    check('doctor: CVP shown exactly once', labels.filter(l => l === 'CVP').length === 1)
    check('doctor: 10 bedside + 12 ventilator + 5 hemodynamic readings', labels.length === 27, `got ${labels.length}`)
    check('doctor: retired cards absent (#vent, #hemo, twin, alerts, goals)',
      !(await has(page, '#vent')) && !(await has(page, '#hemo')) && !(await has(page, '#alerts')) && !(await has(page, '#goals')))
    check('doctor: no retired titles in the chart',
      !['Patient Digital Twin', 'Smart Alerts', 'Daily Goals', 'Active Infusions', 'Laboratory Trends'].some(x => t.includes(x)))
    const cell = async label => page.$$eval('#monitor .obcell', (cs, l) => {
      const c = cs.find(x => x.querySelector('.lbl')?.textContent === l)
      return c ? { val: c.querySelector('.obval')?.innerText ?? '', meta: c.querySelector('.obmeta')?.innerText ?? '' } : null
    }, label)
    const hr = await cell('Heart Rate')
    check('doctor: HR latest real value 101 with time · source', hr && hr.val.startsWith('101') && /manual/.test(hr.meta), JSON.stringify(hr))
    const temp = await cell('Temp')
    check('doctor: amended Temp shows the effective value 38.1', temp && temp.val.startsWith('38.1'), JSON.stringify(temp))
    const fio2 = await cell('FiO₂'), ttl = await cell('TV Set'), tve = await cell('TV Exhaled')
    check('doctor: ventilator values carry time + source', fio2 && fio2.val.startsWith('45') && /manual/.test(fio2.meta), JSON.stringify(fio2))
    check('doctor: set vs measured kept separate (TV Set 450 / TV Exhaled 430)', ttl?.val.startsWith('450') && tve?.val.startsWith('430'))
    const dp = await cell('Driving Pressure')
    check('doctor: driving pressure derived at the shared timepoint (24 − 8 = 16)', dp && dp.val.startsWith('16') && /derived/.test(dp.meta), JSON.stringify(dp))
    const uo = await cell('Urine Output'), co = await cell('Cardiac Output')
    check('doctor: unique hemodynamics kept (CO 5.1, latest Urine Output 60)', co?.val.startsWith('5.1') && uo?.val.startsWith('60'))
    check('doctor: I&O manual snapshots never on the observations card', !mon.includes('1234') && !mon.includes('4321'))
    check('doctor: 24 h fluid-balance strip kept (500 in − 160 out = +340 mL)', /\+340 mL/.test(mon), mon.match(/Fluid balance[^\n]*\n?[^\n]*/)?.[0])
    const hrTime = await page.$$eval('#monitor .obcell', cs => cs.find(x => x.querySelector('.lbl')?.textContent === 'Heart Rate')?.querySelector('.obmeta')?.innerText)
    check('doctor: observation time is shown on the hospital clock (Asia/Baghdad), not raw UTC', (() => {
      const d = new Date(Date.now() - 20 * 60000)
      const utc = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
      const b = new Date(d.getTime() + 180 * 60000)
      const bag = `${String(b.getUTCHours()).padStart(2, '0')}:${String(b.getUTCMinutes()).padStart(2, '0')}`
      return hrTime.includes(bag) && !hrTime.startsWith(utc)
    })(), hrTime)
    check('doctor: NEWS2 score chips present', (await page.$$('#monitor .obscore')).length > 0)
    check('doctor: NEWS2 legend present', mon.includes('NEWS2 parameter score'))
    check('doctor: SOFA and NEWS2 cards present', (await has(page, '#sofa')) && (await has(page, '#news2')))
    // medications
    const meds = await page.$eval('#meds', m => m.innerText)
    const medIds = await page.$$eval('#meds .amrow', rs => rs.map(r => r.innerText.match(/ORD-[A-Z0-9]+/)?.[0]))
    check('doctor: Active Medication Orders = the 5 active prescriptions', JSON.stringify([...medIds].sort()) === JSON.stringify(['ORD-A1', 'ORD-A2', 'ORD-A3', 'ORD-A4', 'ORD-A9']), JSON.stringify(medIds))
    check('doctor: two Alphamycin orders stay two rows', (meds.match(/Alphamycin/g) || []).length === 2)
    check('doctor: pending / discontinued / completed / nursing / other-patient rows excluded',
      !['Pendomycin', 'Stoppazone', 'Donosemide', 'Nursoturn', 'Leakomycin'].some(x => meds.includes(x)))
    check('doctor: continuous, scheduled and PRN groups with dose · route · frequency',
      /CONTINUOUS\s*1/i.test(meds) && /SCHEDULED\s*3/i.test(meds) && /PRN\s*1/i.test(meds)
      && meds.includes('1 g · IV · q8h') && meds.includes('2 g · IV · q12h') && meds.includes('PRN — temp ≥ 38.5 °C')
      && meds.includes('0.1 µg/kg/min · IV infusion (central) · continuous'), meds)
    check('doctor: no pump rate / trend fabricated on medication rows', !(await has(page, '#meds canvas, #meds svg.spark, #meds .mwarn')))
    // results
    check('doctor: Laboratory Results title', (await page.$eval('#labs .chead .t', e => e.textContent)) === 'Laboratory Results')
    const img = await page.$eval('#imaging', m => m.innerText)
    const imgOrder = await page.$$eval('#imaging .imdesc', d => d.map(x => x.textContent))
    /* newest first by each study's latest stamp (reported → performed →
       ordered): CT reported 30 min ago, US ordered 70 min ago, CXR
       reported 90 min ago, Echo ~1 day, MRI oldest (hidden until Show all) */
    check('doctor: imaging newest first, 4 shown of 5', JSON.stringify(imgOrder) === JSON.stringify(['Alpha CT abdomen', 'Alpha renal ultrasound', 'Alpha chest film', 'Alpha echo']), JSON.stringify(imgOrder))
    check('doctor: imaging status, flag, impression, acknowledgement shown',
      /final/i.test(img) && /preliminary/i.test(img) && /ordered/i.test(img) && /CRITICAL/.test(img) && img.includes('Alpha impression: pneumonia, RLL.') && /acknowledged by Dr Synthetic/.test(img), img)
    await page.click('#imaging .imall')
    check('doctor: "Show all" reveals the 5th study', (await page.$$('#imaging .imrow')).length === 5)
    const findBtn = await page.$('#imaging .imtoggle')
    await findBtn.focus(); await page.keyboard.press('Enter')
    check('doctor: findings open by keyboard (Enter) with aria-expanded', (await findBtn.getAttribute('aria-expanded')) === 'true' && (await page.$eval('#imaging', m => m.innerText)).includes('findings:'))
    await page.click('#imaging .cardfoot .obclink')
    await page.waitForURL(u => u.pathname === `/labs/${A}`)
    check('doctor: imaging link opens the existing results screen for this patient', new URL(page.url()).pathname === `/labs/${A}`)
    await goto(page, A)
    // weight & height
    const wh = await page.$eval('#weight-height', m => m.innerText)
    check('doctor: compact Weight & Height keeps values + derived + scope', /81\s*kg/.test(wh) && /177\s*cm/.test(wh) && /BMI/.test(wh) && /ENC-A1/.test(wh))
    const whBox = await page.$eval('#weight-height', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height } })
    /* the preparation commit's card measured 1272 × 185 px with this data
       (235,059 px²) — compact = under half that area */
    check('doctor: Weight & Height is compact (< 50% of the prep card area)', whBox.w * whBox.h < 235059 / 2, JSON.stringify(whBox))
    check('doctor: Weight & Height correction control kept', (await page.$eval('#weight-height .whedit', e => e.textContent)).includes('Correct'))
    await page.click('#weight-height .whhistbtn')
    check('doctor: Weight & Height history kept (2 events)', (await page.$$('#weight-height .whev')).length === 2)
    check('doctor: header unit stat "Critical Alerts" kept', (await page.$eval('.unitstats', e => e.innerText)).includes('Critical Alerts'))
    const obsReq = ctl.log.filter(l => l.startsWith('GET /api/icu/observations'))
    check('doctor: scores still read the encounter-scoped chart (SOFA input unchanged)', obsReq.some(l => l.includes('encounterId=')), JSON.stringify(obsReq))
    await page.screenshot({ path: `${SHOTS}/doctor-A-light-1600.png`, fullPage: false })
    await ctx.close()
  }

  /* ---------------- 2. nurse (Staff Nurse) on A ---------------- */
  {
    const { ctx, ctl, page } = await open(browser, 'Staff Nurse')
    await goto(page, A)
    const t = await mainText(page)
    check('nurse: no SOFA / NEWS2 cards', !(await has(page, '#sofa')) && !(await has(page, '#news2')))
    check('nurse: no score chips on observations', (await page.$$('#monitor .obscore')).length === 0)
    check('nurse: no SOFA / NEWS2 wording anywhere in the chart', !/SOFA|NEWS2/.test(t))
    const hr = await page.$$eval('#monitor .obcell', cs => cs.find(x => x.querySelector('.lbl')?.textContent === 'Heart Rate')?.querySelector('.obval')?.innerText)
    check('nurse: observations still visible (HR 101)', hr?.startsWith('101'))
    check('nurse: same 27 readings as the doctor', (await page.$$('#monitor .obcell')).length === 27)
    const obsReq = ctl.log.filter(l => l.startsWith('GET /api/icu/observations'))
    check('nurse: no score fan-out (no encounter-scoped observation read)', !obsReq.some(l => l.includes('encounterId=')), JSON.stringify(obsReq))
    check('nurse: Laboratory Results in the right column', await has(page, '.colR #labs'))
    check('nurse: medication slot holds the read-only summary until the care panel is handed off',
      (await has(page, '.nursecare #meds')) && !/\b(Given|Held|Refused)\b/.test(await page.$eval('.nursecare', e => e.innerText)))
    check('nurse: imaging + weight/height present', (await has(page, '#imaging')) && (await has(page, '#weight-height')))
    await page.screenshot({ path: `${SHOTS}/nurse-A-light-1600.png` })
    await ctx.close()
  }

  /* ---------------- 3. other entitled profiles ---------------- */
  for (const [title, expect] of [
    ['Respiratory Therapist', { scores: true, meds: true, labs: true, imaging: true }],
    ['Physiotherapist', { scores: true, meds: false, labs: true, imaging: true }],
    ['Clinical Pharmacist', { scores: true, meds: true, labs: true, imaging: true }],
    ['Receptionist', { scores: true, meds: false, labs: false, imaging: false }],
  ]) {
    const { ctx, page } = await open(browser, title)
    await goto(page, A)
    const got = {
      scores: (await has(page, '#sofa')) && (await has(page, '#news2')),
      meds: await has(page, '#meds'), labs: await has(page, '#labs'), imaging: await has(page, '#imaging'),
    }
    check(`${title}: cards follow existing permissions ${JSON.stringify(expect)}`, JSON.stringify(got) === JSON.stringify(expect), JSON.stringify(got))
    await ctx.close()
  }

  /* ---------------- 4. patient switching with delayed responses ---------------- */
  for (const title of ['Consultant', 'Staff Nurse']) {
    const { ctx, ctl, page } = await open(browser, title)
    ctl.delays[A] = { observations: 2500, orders: 2500, imaging: 2500, encounters: 2500 }
    await page.goto(`${BASE}/patients/${A}`)
    await page.waitForTimeout(400)       // A's chart reads are in flight
    await page.click(`.ptcard:has-text("${NAME[B]}")`)
    await page.waitForTimeout(60)
    const early = await page.$eval('main', m => m.innerText)
    check(`${title}: right after switching, none of A's rows are on screen`, !A_MARKERS.some(x => early.includes(x)))
    await page.waitForTimeout(3600)      // A's late answers have now landed
    const late = await mainText(page)
    check(`${title}: after A's late answers land, B's chart shows only B's data`,
      !A_MARKERS.some(x => late.includes(x)) && B_MARKERS.every(x => late.includes(x)),
      `A=${A_MARKERS.filter(x => late.includes(x))} B=${B_MARKERS.filter(x => late.includes(x))}`)
    const hrB = await page.$$eval('#monitor .obcell', cs => cs.find(x => x.querySelector('.lbl')?.textContent === 'Heart Rate')?.querySelector('.obval')?.innerText)
    check(`${title}: B's observations (HR 66), not A's`, hrB?.startsWith('66'), hrB)
    const dpB = await page.$$eval('#monitor .obcell', cs => cs.find(x => x.querySelector('.lbl')?.textContent === 'Driving Pressure')?.innerText)
    check(`${title}: B's driving pressure not derived (Pplat/PEEP at different times)`, /not derived/.test(dpB) && !/\b14\b/.test(dpB), dpB)
    check(`${title}: header shows B`, (await page.$eval('.pt-id h1', e => e.textContent)).includes(B))
    await ctx.close()
  }

  /* ---------------- 5. weight & height editor + late save across a switch ---------------- */
  {
    const { ctx, ctl, page } = await open(browser, 'Staff Nurse')
    await goto(page, A)
    await page.click('#weight-height .whedit')
    await page.fill('#weight-height input[aria-label="Weight in kilograms"]', '99')
    await page.click(`.ptcard:has-text("${NAME[B]}")`); await settle(page)
    check('W&H: switching closes the previous patient\'s editor', !(await has(page, '#weight-height .wheditor')))
    check('W&H: B shows B\'s own values (64 kg)', /64\s*kg/.test(await page.$eval('#weight-height', e => e.innerText)))
    await page.click(`.ptcard:has-text("${NAME[A]}")`); await settle(page)
    check('W&H: returning to A does not restore the typed value', !(await has(page, '#weight-height .wheditor')))
    ctl.putDelay = 2000
    await page.click('#weight-height .whedit')
    await page.fill('#weight-height input[aria-label="Weight in kilograms"]', '90')
    await page.click('#weight-height .whsave')
    await page.waitForTimeout(200)
    await page.click(`.ptcard:has-text("${NAME[B]}")`)
    await page.waitForTimeout(2600)
    const whB = await page.$eval('#weight-height', e => e.innerText)
    check('W&H: a save answering after the switch never paints A onto B', /64\s*kg/.test(whB) && !/90\s*kg/.test(whB) && !whB.includes('ENC-A1'), whB)
    check('W&H: the write itself targeted A\'s encounter', ctl.puts.length === 1 && ctl.puts[0].encId === 'ENC-A1' && ctl.puts[0].body.weightKg === 90, JSON.stringify(ctl.puts))
    await ctx.close()
  }

  /* ---------------- 6. error, empty and discharged states ---------------- */
  {
    const { ctx, page } = await open(browser, 'Consultant')
    await goto(page, C)
    if (!PROD) {
      /* DEV bundle: a failed observations read is null (no mock behind
         that domain) → the card says so; failed orders/imaging reads are
         answered from the dev mock layer by design */
      check('errors (dev bundle): observations card says the record could not be read', (await page.$eval('#monitor', e => e.innerText)).includes('could not be read'))
    } else {
      /* PRODUCTION bundle: an unavailable clinical read latches the
         existing full-screen refusal (no demo fallback, by design) — the
         chart must never have claimed "none" for the failed sources */
      const body = await page.$eval('body', e => e.innerText)
      check('errors (production bundle): the existing full-screen API refusal is shown', /AURORA API UNAVAILABLE/i.test(body), body.slice(0, 200))
      check('errors (production bundle): no false "none active" / "none recorded" claim anywhere',
        !body.includes('No active medication orders') && !body.includes('No imaging studies recorded'))
    }
    await page.screenshot({ path: `${SHOTS}/doctor-C-errors-${PROD ? 'prod' : 'dev'}-1600.png` })
    if (PROD) { await ctx.close(); await (async () => {
      /* a fresh context: the refusal is latched for the tab */
      const { ctx: c2, page: p2 } = await open(browser, 'Consultant')
      await goto(p2, D)
      check('empty (production bundle): real empty medication list', (await p2.$eval('#meds', e => e.innerText)).includes('No active medication orders for this patient.'))
      check('empty (production bundle): real empty imaging list', (await p2.$eval('#imaging', e => e.innerText)).includes('No imaging studies recorded for this patient.'))
      check('empty (production bundle): no observations → "not charted", nothing invented', (await p2.$$('#monitor .obcell:not(.blank)')).length === 0)
      await p2.screenshot({ path: `${SHOTS}/doctor-D-empty-prod-1600.png` })
      await c2.close()
    })() } else {
    await goto(page, D)
    check('empty: real empty medication list', (await page.$eval('#meds', e => e.innerText)).includes('No active medication orders for this patient.'))
    check('empty: real empty imaging list', (await page.$eval('#imaging', e => e.innerText)).includes('No imaging studies recorded for this patient.'))
    const toggles = await page.$$('#monitor .obgtoggle')
    check('empty: groups with no value fold to one line with a toggle', toggles.length >= 2, `toggles=${toggles.length}`)
    // keyboard: Tab reaches the toggle; Enter opens; Space closes
    let reached = false
    await page.focus('.searchbox input')
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab')
      reached = await page.evaluate(() => document.activeElement?.classList.contains('obgtoggle') ?? false)
    }
    check('keyboard: Tab reaches a "Show readings" toggle', reached)
    await page.keyboard.press('Enter')
    const expanded = await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))
    check('keyboard: Enter expands the folded group (aria-expanded=true)', expanded === 'true')
    await page.keyboard.press('Space')
    check('keyboard: Space folds it again', (await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))) === 'false')
    /* the app's focus indicator is the global :focus-visible ring
       (tokens.css: outline none + box-shadow var(--focus)) */
    const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow)
    check('keyboard: focused toggle shows the focus ring', !!focusRing && focusRing !== 'none', focusRing)
    await page.screenshot({ path: `${SHOTS}/doctor-D-empty-1600.png` })
    await page.goto(`${BASE}/patients/${E}`); await settle(page)
    check('discharged: chart still redirects to the history record', new URL(page.url()).pathname === `/patients/${E}/history`)
    await ctx.close()
    }
  }

  /* ---------------- 7. themes and narrow layouts ---------------- */
  for (const [title, who] of [['Consultant', 'doctor'], ['Staff Nurse', 'nurse']]) {
    for (const theme of ['dark', 'light']) {
      for (const vp of [{ width: 1600, height: 2400 }, { width: 1024, height: 2600 }, { width: 390, height: 3800 }]) {
        const { ctx, page } = await open(browser, title, { theme, viewport: vp })
        await goto(page, A)
        const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme)
        const overflow = await page.evaluate(() => {
          const doc = document.scrollingElement
          const cards = [...document.querySelectorAll('main .card')]
          const wide = cards.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.id || c.className)
          return { page: doc.scrollWidth > window.innerWidth + 1, cards: wide }
        })
        check(`${who} ${theme} ${vp.width}px: theme applied, no horizontal overflow`, dataTheme === theme && !overflow.page && overflow.cards.length === 0, JSON.stringify({ dataTheme, overflow }))
        if (vp.width !== 1600 || theme === 'dark') await page.screenshot({ path: `${SHOTS}/${who}-A-${theme}-${vp.width}.png` })
        await ctx.close()
      }
    }
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
