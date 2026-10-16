/* Focused check of the FINAL insertion with Session 3's REAL
   PatientNurseCarePanel, run against a DISPOSABLE assembled checkout
   (Session 2 head + Session 1 backend + Session 3 nurse-workflows merged in
   a throwaway worktree; never committed or pushed), dev bundle via
   `npx vite`, API answered by synthetic-api.cjs. It does not repeat the
   earlier chart suite: it checks only where the panel mounts, which
   patient it receives across a delayed switch, and that the other roles
   and the nurse's score hiding are unchanged.
   usage: node panel-real-check.cjs <baseUrl> [screenshotDir] */
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const { install, ROSTER_NAMES } = require('./synthetic-api.cjs')
const A = 'P-1001', B = 'P-1002'
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? ` — ${d}` : ''}`) }
;(async () => {
  const [base, shots] = process.argv.slice(2)
  const b = await chromium.launch()
  const open = async title => {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 2600 } })
    const ctl = { delays: {}, log: [], puts: [] }
    await install(ctx, ctl)
    await ctx.addInitScript(t => {
      sessionStorage.setItem('aurora.session', JSON.stringify({ name: `Synthetic ${t}`, jobTitle: t }))
      sessionStorage.setItem('aurora.prefs', JSON.stringify({ theme: 'light', timeFormat: '24h' }))
    }, title)
    const page = await ctx.newPage()
    page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`))
    return { ctx, ctl, page }
  }
  const panel = page => page.$eval('.nursecare .ncpanel', e => ({ pid: e.dataset.patient, text: e.innerText })).catch(() => null)

  /* nurse, no delays: mount point, patient, layout, score hiding */
  {
    const { ctx, page } = await open('Staff Nurse')
    await page.goto(`${base}/patients/${A}`); await page.waitForTimeout(3000)
    const p = await panel(page)
    check('nurse: the real PatientNurseCarePanel is mounted in the medication slot', !!p)
    check('nurse: it receives the routed patient (data-patient = P-1001)', p?.pid === A, p?.pid)
    check('nurse: it shows this patient\'s MAR group header', !!p && p.text.includes(ROSTER_NAMES[A]), p?.text.slice(0, 200))
    check('nurse: the temporary summary card is gone from the nurse chart', (await page.$('#meds')) === null)
    const order = await page.$$eval('main > *', els => els.map(e => e.id || e.className))
    check('nurse: slot directly after the observations row', order.indexOf('nursecare') === order.indexOf('colR') + 1, JSON.stringify(order))
    check('nurse: score hiding unchanged (no SOFA/NEWS2 card, no score chip)',
      (await page.$('#sofa')) === null && (await page.$('#news2')) === null && (await page.$$('#monitor .obscore')).length === 0)
    check('nurse: other chart cards unchanged', !!(await page.$('#monitor')) && !!(await page.$('.colR #labs')) && !!(await page.$('#imaging')) && !!(await page.$('#weight-height')))
    if (shots) await page.screenshot({ path: `${shots}/nurse-A-with-care-panel-1600.png` })
    await ctx.close()
  }

  /* nurse, delayed switch: A's reads held 2.5 s, switch to B after 0.4 s */
  {
    const { ctx, ctl, page } = await open('Staff Nurse')
    ctl.delays[A] = { observations: 2500, encounters: 2500, orders: 2500, imaging: 2500 }
    await page.goto(`${base}/patients/${A}`); await page.waitForTimeout(400)
    await page.click(`.ptcard:has-text("${ROSTER_NAMES[B]}")`)
    await page.waitForTimeout(60)
    const early = await panel(page)
    check('switch: in the switching render the panel is absent or already B', early === null || early.pid === B, early?.pid)
    await page.waitForTimeout(3600)
    const late = await panel(page)
    check('switch: after A\'s late answers land, the panel is B\'s', late?.pid === B, late?.pid)
    check('switch: no A identity or A I&O values inside B\'s panel',
      !!late && !late.text.includes(ROSTER_NAMES[A]) && !late.text.includes('1234') && !late.text.includes('4321'), late?.text.slice(0, 300))
    /* B has no rows in the dev MAR store (/api/icu/mar is not served here,
       so the dev bundle answers from its mock layer) and no I&O snapshot:
       B's panel must show B's own empties, not A's rows */
    check('switch: B\'s panel shows B\'s own empty MAR and "Not recorded" I&O',
      !!late && late.text.includes('No active medication orders for this patient.') && late.text.includes('Not recorded'), late?.text.slice(0, 300))
    await page.click(`.ptcard:has-text("${ROSTER_NAMES[A]}")`); await page.waitForTimeout(3200)
    check('switch back: the panel follows to A', (await panel(page))?.pid === A)
    await ctx.close()
  }

  /* other roles: no panel, layouts unchanged */
  for (const title of ['Consultant', 'Respiratory Therapist', 'Physiotherapist']) {
    const { ctx, page } = await open(title)
    await page.goto(`${base}/patients/${A}`); await page.waitForTimeout(2500)
    const got = { panel: !!(await page.$('.ncpanel')), slot: !!(await page.$('.nursecare')), meds: !!(await page.$('#meds')), scores: !!(await page.$('#sofa')) && !!(await page.$('#news2')) }
    const want = { panel: false, slot: false, meds: title !== 'Physiotherapist', scores: true }
    check(`${title}: no care panel; summary/scores as before ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
    await ctx.close()
  }
  await b.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
