// Attribution probe for ui-check's info line (page-level horizontal overflow at 390 px): measures the
// page's overflow on the doctor's Orders page, then again with this branch's UI removed from the DOM
// (the New Nursing Order card and every nursing line / nursing control). Same server and data as
// ui-check (prod-state.json); read-only.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'
const BASE = process.env.NURSING_UI ?? 'http://localhost:8080'
const st = JSON.parse(fs.readFileSync(path.join(process.env.SCRATCH, 'prod-state.json'), 'utf8'))
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [who, acct] of [['doctor', st.doctor], ['nurse', st.nurse]]) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
  await p.goto(`${BASE}/login`); await p.fill('#lguser', acct.username); await p.fill('#lgpass', acct.password); await p.click('button.lgsubmit')
  await p.waitForURL(u => !u.pathname.startsWith('/login'))
  await p.goto(`${BASE}/orders/${st.pid}`); await p.locator('.oorow').first().waitFor(); await p.waitForTimeout(500)
  const over = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const before = await over()
  await p.evaluate(() => {
    document.querySelectorAll('.card').forEach(c => { if (c.textContent.includes('New Nursing Order')) c.remove() })
    document.querySelectorAll('.oonurse, .oonursenote').forEach(e => e.remove())
    document.querySelectorAll('button[aria-label^="Done: round"], button[aria-label*=" opens at "], button[aria-label^="Completing round"], button[aria-label^="Retry saving"]').forEach(e => e.remove())
  })
  const after = await over()
  const widest = await p.evaluate(() => [...document.querySelectorAll('body *')].map(e => [e.scrollWidth, `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`])
    .filter(([w]) => w > document.documentElement.clientWidth).sort((a, b) => b[0] - a[0]).slice(0, 4).map(([w, n]) => `${n} (${w}px)`))
  console.log(`${who} Orders page at 390 px: overflow ${before} px with this branch's UI, ${after} px with it removed; widest content: ${widest.join(', ')}`)
}
await b.close()
