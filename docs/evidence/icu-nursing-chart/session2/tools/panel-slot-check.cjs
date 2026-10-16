/* TEST-ONLY interface check for the §6 slot, run against a throwaway
   worktree of the Session 2 head with pending-insertion.patch applied and a
   STUB src/features/nurse-care/PatientNurseCarePanel.tsx (never committed).
   It proves only: the nurse chart mounts the panel in the medication slot
   with the routed patientId, it follows a switch at once, no other role
   gets it, and the nurse's chart no longer shows the summary card.
   usage: node panel-slot-check.cjs <baseUrl> */
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const { install, ROSTER_NAMES } = require('./synthetic-api.cjs')
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? ` — ${d}` : ''}`) }
;(async () => {
  const base = process.argv[2]
  const b = await chromium.launch()
  for (const title of ['Staff Nurse', 'Consultant']) {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 2400 } })
    const ctl = { delays: {}, log: [], puts: [] }
    await install(ctx, ctl)
    await ctx.addInitScript(t => sessionStorage.setItem('aurora.session', JSON.stringify({ name: `Synthetic ${t}`, jobTitle: t })), title)
    const p = await ctx.newPage()
    ctl.delays['P-1001'] = { observations: 2000, orders: 2000, imaging: 2000 }
    await p.goto(`${base}/patients/P-1001`)
    await p.waitForTimeout(2600)
    const stub = async () => p.$eval('.nursecare #nurse-care-stub', e => e.dataset.patient).catch(() => null)
    if (title === 'Staff Nurse') {
      check('nurse: panel mounted in the medication slot with the routed patient', (await stub()) === 'P-1001')
      check('nurse: the read-only summary card is gone from the nurse chart', (await p.$('#meds')) === null)
      ctl.delays['P-1001'] = {}
      await p.click(`.ptcard:has-text("${ROSTER_NAMES['P-1002']}")`)
      await p.waitForTimeout(80)
      const early = await stub()
      check('nurse: the panel never receives the previous patient after a switch', early === null || early === 'P-1002', String(early))
      await p.waitForTimeout(1500)
      check('nurse: panel follows the switch (P-1002)', (await stub()) === 'P-1002')
      const order = await p.$$eval('main > *', els => els.map(e => e.id || e.className))
      check('nurse: slot sits directly after the observations row', order.indexOf('nursecare') === order.indexOf('colR') + 1, JSON.stringify(order))
    } else {
      check('doctor: no nurse care panel', (await p.$('#nurse-care-stub')) === null)
      check('doctor: medication summary still shown', (await p.$('#meds')) !== null)
    }
    await ctx.close()
  }
  await b.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
