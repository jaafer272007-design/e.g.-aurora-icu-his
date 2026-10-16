// re-encode existing PNG screenshots to JPEG (no app interaction — pure image re-encode)
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const fs = require('fs'), path = require('path')
const [SRC, OUT, ...names] = process.argv.slice(2)
;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const p = await b.newPage()
  for (const n of names) {
    const png = fs.readFileSync(path.join(SRC, n + '.png'))
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20)
    await p.setViewportSize({ width: w, height: Math.min(h, 16000) })
    await p.setContent(`<html><body style="margin:0"><img id=i src="data:image/png;base64,${png.toString('base64')}" style="display:block"></body></html>`)
    await p.waitForFunction(() => document.getElementById('i').complete)
    await p.locator('#i').screenshot({ path: path.join(OUT, n + '.jpg'), type: 'jpeg', quality: 86 })
    console.log(n, w + 'x' + h)
  }
  await b.close()
})().catch(e => { console.error(e); process.exit(1) })
