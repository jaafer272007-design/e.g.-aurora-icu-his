/* the preparation commit's chart (05e92e2, served from a separate
   worktree) with the SAME synthetic data, for the before/after record.
   usage: node before-shots.cjs <baseUrl> <dir> */
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const { install } = require('./synthetic-api.cjs')
;(async () => {
  const [base, dir] = process.argv.slice(2)
  const b = await chromium.launch()
  for (const [who, title] of [['doctor', 'Consultant'], ['nurse', 'Staff Nurse']]) {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 2400 }, colorScheme: 'light' })
    await install(ctx, { delays: {}, log: [], puts: [] })
    await ctx.addInitScript(t => {
      sessionStorage.setItem('aurora.session', JSON.stringify({ name: `Synthetic ${t}`, jobTitle: t }))
      sessionStorage.setItem('aurora.prefs', JSON.stringify({ theme: 'light', timeFormat: '24h' }))
    }, title)
    const p = await ctx.newPage()
    await p.goto(`${base}/patients/P-1001`)
    await p.waitForTimeout(2500)
    await p.screenshot({ path: `${dir}/${who}-A-light-1600.png` })
    console.log(who, JSON.stringify(await p.$$eval('main > *', els => els.map(e => e.querySelector('.chead .t')?.textContent ?? e.className))))
    await ctx.close()
  }
  await b.close()
})()
