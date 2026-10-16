const { chromium, BASE, login, geom } = require('./lib.cjs')
const plan = [
  ['sara.rahman', ['/workspace', '/beds', '/admissions', '/discharges', '/discharged', '/print', '/patients/P-1001/history', '/orders/P-1001', '/labs/P-1001', '/lab-entry/P-1001', '/timeline/P-1001', '/observations/P-1001', '/statistics', '/alerts', '/settings', '/config', '/lab-catalog', '/order-sets']],
  ['maya.chen', ['/nurse']], ['yusuf.karim', ['/admin']], ['alex.novak', ['/admin/users', '/backup']], ['samir.qassem', ['/formulary']],
]
let fails = 0
;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  for (const [user, paths] of plan) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage()
    await login(page, user)
    for (const p of paths) {
      await page.goto(BASE + p); await page.waitForLoadState('networkidle'); await page.mouse.move(1400, 450); await page.waitForTimeout(500)
      const c = await geom(page); await page.mouse.move(30, 330); await page.waitForTimeout(500); const e = await geom(page)
      const full = p === '/backup' ? 220 : 198
      const ok = c && e && !c.open && c.navWidth === 64 && e.open && e.navWidth === full && e.labelsVisible === e.items.length && e.cols.startsWith(full + 'px') && c.cols.startsWith('64px')
      if (!ok) fails++
      console.log(`${ok ? 'PASS' : 'FAIL'} ${user.padEnd(13)} ${p.padEnd(26)} collapsed[${c && c.cols}] expanded[${e && e.cols}] ${e ? e.labelsVisible + '/' + e.items.length + ' labels' : 'NO NAV'}`)
    }
    await ctx.close()
  }
  await browser.close(); console.log(fails ? `SWEEP FAILED (${fails})` : 'SWEEP PASSED'); process.exit(fails ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
