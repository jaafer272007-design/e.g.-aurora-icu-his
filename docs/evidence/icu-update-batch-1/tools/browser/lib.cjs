const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const BASE = 'http://localhost:8080'
async function login(page, user) {
  await page.goto(BASE + '/login')
  await page.fill('#lguser', user)
  await page.fill('#lgpass', 'Aurora2026!')
  await page.click('button.lgsubmit')
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 })
  await page.waitForLoadState('networkidle')
}
/** geometry of the nav + its shell column + the next column */
async function geom(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.nav-sidebar')
    if (!nav) return null
    const shell = nav.parentElement
    const next = nav.nextElementSibling && [...shell.children].find((c, i) => i > 0 && getComputedStyle(c).display !== 'none')
    const r = nav.getBoundingClientRect()
    const labels = [...nav.querySelectorAll('.nv')].map(b => ({ name: b.getAttribute('aria-label'), labelVisible: !!b.querySelector('span') && getComputedStyle(b.querySelector('span')).display !== 'none' }))
    return {
      open: nav.classList.contains('nav-open'), overlay: nav.classList.contains('nav-overlay'),
      navWidth: Math.round(r.width), cols: getComputedStyle(shell).gridTemplateColumns,
      nextLeft: next ? Math.round(next.getBoundingClientRect().left) : null, nextClass: next ? next.className || next.tagName : null,
      items: labels.map(l => l.name), labelsVisible: labels.filter(l => l.labelVisible).length,
      footVisible: !!nav.querySelector('.navfoot') && getComputedStyle(nav.querySelector('.navfoot')).display !== 'none',
      toggle: nav.querySelector('.nvtoggle') ? nav.querySelector('.nvtoggle').getAttribute('aria-expanded') : null,
      scroll: { h: nav.scrollHeight, ch: nav.clientHeight },
    }
  })
}
module.exports = { chromium, BASE, login, geom }
