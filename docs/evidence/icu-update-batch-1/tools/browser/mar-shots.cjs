const { chromium, BASE, login } = require('./lib.cjs')
const [SHOTS, PID] = process.argv.slice(2)
;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const page = await ctx.newPage()
  await login(page, 'maya.chen')
  await page.goto(BASE + '/nurse'); await page.waitForLoadState('networkidle'); await page.mouse.move(1400, 500)
  // scroll the synthetic patient's MAR group to the top of its scroll container, then a viewport screenshot
  const ok = await page.evaluate(() => {
    const g = [...document.querySelectorAll('.margroup')].find(x => x.textContent.includes('Retime'))
    if (!g) return false
    g.scrollIntoView({ block: 'start' }); return true
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/desktop1440x1100-nurse-mar-${PID}-retimed.png` })
  const rows = await page.evaluate(() => {
    const g = [...document.querySelectorAll('.margroup')].find(x => x.textContent.includes('Retime'))
    return [...g.querySelectorAll('.marrow')].map(r => r.innerText.replace(/\s+/g, ' ').trim())
  })
  console.log('MAR group found:', ok); rows.forEach(r => console.log('  ' + r))
  const kpi = await page.evaluate(() => document.body.innerText.match(/(\d+)\s*MEDS DUE/i)?.[1])
  const aside = await page.evaluate(() => document.body.innerText.match(/(\d+) due · administer/)?.[1])
  console.log(`Meds-Due KPI=${kpi} · MAR card aside=${aside} due`)
  await page.goto(BASE + `/print/mar/${PID}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/desktop1440x1100-nurse-print-mar-${PID}.png`, fullPage: true })
  const cells = await page.evaluate(() => [...document.querySelectorAll('.pd-mar-cell')].map(c => c.innerText.replace(/\s+/g, ' ').trim()))
  console.log('print cells:'); cells.forEach(c => console.log('  ' + c))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
