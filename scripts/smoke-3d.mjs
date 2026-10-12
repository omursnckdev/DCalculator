// Elle çalıştırılan 3D duman testi (tarayıcıda gerçek WebGL): uygulama `npm run dev` ile açık olmalı.
// Kullanım: PLAYWRIGHT_NODE_MODULES=/opt/node-tools/ node scripts/smoke-3d.mjs
// Yazılım (GPU'suz) render için SwiftShader bayrakları kullanılır; ilk 3D açılışı birkaç saniye sürebilir.
import { createRequire } from 'node:module'

const require = createRequire(process.env.PLAYWRIGHT_NODE_MODULES ?? '/opt/node-tools/')
const { chromium } = require('playwright')
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const check = (name, ok) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) process.exitCode = 1
}

await page.goto(URL_)
await page.waitForTimeout(2500)
await page.getByRole('button', { name: /Şablon/ }).click()
await page.getByText(/jeneratörlü/i).first().click()
await page.waitForTimeout(1500)
const before2d = await page.locator('.react-flow__node').count()

await page.getByRole('button', { name: '3D', exact: true }).click()
await page.waitForSelector('canvas', { timeout: 120000 })
await page.waitForTimeout(5000)
check('3D sahne açıldı', (await page.locator('canvas').count()) === 1)

// Palet → sahne sürükle-bırak: 2D'de de görünür
await page.locator('aside').first().getByRole('button', { name: 'Pompa', exact: true }).dragTo(page.locator('canvas'), { targetPosition: { x: 600, y: 300 } })
await page.waitForTimeout(1000)
await page.getByRole('button', { name: 'Şema', exact: true }).click()
await page.waitForTimeout(1500)
check('3D\'de eklenen ekipman 2D şemada var', (await page.locator('.react-flow__node').count()) === before2d + 1)

// Arama + odaklan + sürükle + döndür
await page.getByRole('button', { name: '3D', exact: true }).click()
await page.waitForTimeout(3000)
await page.locator('#v3d-search').fill('MDB')
await page.locator('ul button').first().click()
await page.waitForTimeout(1500)
const pos = async () => {
  const det = page.locator('aside').last().locator('details').first()
  if (!(await det.getAttribute('open'))) await det.locator('summary').click()
  return det.locator('input').evaluateAll((els) => els.map((e) => e.value))
}
const p0 = await pos()
const box = await page.locator('canvas').boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2
await page.mouse.move(cx, cy)
await page.mouse.down()
await page.mouse.move(cx + 60, cy, { steps: 5 })
await page.mouse.move(cx + 120, cy, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(800)
const p1 = await pos()
check('sürükleme konumu değiştirdi', p0[0] !== p1[0] || p0[1] !== p1[1])
await page.keyboard.press('r')
await page.waitForTimeout(400)
check('R ile 90° döndü', (await pos())[3] === '90')

// Ekipmana düz tıklayınca özellikler paneli açık kalmalı (tıklama zemine ulaşıp seçimi temizlememeli)
await page.locator('#v3d-search').fill('MDB')
await page.locator('ul button').first().click()
await page.waitForTimeout(800)
await page.mouse.click(cx, cy)
await page.waitForTimeout(600)
check('tıklayınca özellikler paneli açık kalıyor', (await page.locator('aside').last().locator('input').count()) > 0)
// Senaryo ve bakım paneli (3D'de)
await page.getByRole('button', { name: /Arızalı işaretle/ }).click()
await page.waitForTimeout(600)
check('3D\'de senaryo arızası uygulandı', (await page.locator('text=/Aktif senaryo/').count()) === 1)
await page.getByRole('button', { name: /Bakım analizi/ }).click()
await page.waitForTimeout(4000)
check('bakım analizi sonucu geldi', (await page.locator('text=/Bakım sürerken/').count()) === 1)

// Hat tıklama (birleştirilmiş çizgilerden segment → hat eşlemesi; yalnız dev sunucuda __v3d vardır)
await page.getByRole('button', { name: 'Üst (plan)', exact: true }).click()
await page.waitForTimeout(1500)
const mid = await page.evaluate(() => window.__v3d?.cableMid?.('g>tx'))
if (mid) {
  await page.mouse.click(mid.x, mid.y)
  await page.waitForTimeout(1000)
  check('hat tıklayınca seçiliyor (3D güzergâh araçları)', (await page.locator('text=/Uzunluk kaynağı/').count()) > 0)
}

// Paneller kapatılabilir
const asides = () => page.locator('aside').count()
await page.getByRole('button', { name: /Palet/ }).first().click()
await page.getByRole('button', { name: /Özellikler/ }).first().click()
await page.waitForTimeout(400)
check('palet ve özellikler paneli kapandı', (await asides()) === 0)
await page.keyboard.press('[')
await page.keyboard.press(']')
await page.waitForTimeout(400)
check('[ ] kısayolu panelleri açtı', (await asides()) === 2)

// Yürüme modu (Y): göz yüksekliği 1,7 m, ↑ ile ilerler, Esc çıkar
await page.locator('#v3d-search').fill('MDB')
await page.locator('ul button').first().click()
await page.waitForTimeout(800)
await page.keyboard.press('y')
await page.waitForTimeout(1200)
const w0 = await page.evaluate(() => window.__v3d?.camPos?.())
if (w0) {
  check('yürüme modunda göz yüksekliği 1,7 m', Math.abs(w0.y - 1.7) < 0.01)
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(1200)
  await page.keyboard.up('ArrowUp')
  await page.waitForTimeout(400)
  const w1 = await page.evaluate(() => window.__v3d.camPos())
  check('yön tuşuyla ilerledi', Math.hypot(w1.x - w0.x, w1.z - w0.z) > 0.8)
}
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
check('Esc ile yürümeden çıkıldı', (await page.locator('text=/Yürüme modu:/').count()) === 0)

// Seçim kutusu (Shift+sürükle, zeminde; sol üst köşede senaryo paneli olduğundan sağ alttan başlanır)
await page.getByRole('button', { name: 'Üst (plan)', exact: true }).click()
await page.waitForTimeout(1200)
const cb = await page.locator('canvas').boundingBox()
await page.keyboard.down('Shift')
await page.mouse.move(cb.x + cb.width - 30, cb.y + cb.height - 40)
await page.mouse.down()
await page.mouse.move(cb.x + 120, cb.y + 40, { steps: 8 })
await page.mouse.up()
await page.keyboard.up('Shift')
await page.waitForTimeout(600)
await page.getByRole('button', { name: /Hizala/ }).first().click()
const txt = await page.locator('text=/ekipman seçili/').first().innerText()
check('seçim kutusu birden çok ekipman seçti', Number(/^(\d+)/.exec(txt)?.[1] ?? 0) > 3)

// Simülasyon şeridi: yükseklik sürükleyerek ayarlanır, "ayrı sayfa" sekmesi açılır
await page.locator('#v3d-search').fill('MDB')
await page.locator('ul button').first().click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: /Arıza listesine ekle/ }).click()
await page.getByRole('button', { name: 'Arızayı uygula' }).click()
await page.waitForTimeout(4500)
const olH = () => page.locator('section[aria-label] ol').first().evaluate((e) => e.getBoundingClientRect().height)
const sh0 = await olH()
const sep = await page.locator('[role=separator]').first().boundingBox()
await page.mouse.move(sep.x + 200, sep.y + 2)
await page.mouse.down()
await page.mouse.move(sep.x + 200, sep.y - 120, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(400)
check('simülasyon şeridi yüksekliği sürükleyerek büyüdü', (await olH()) > sh0 + 80)
await page.getByRole('button', { name: /ayrı sayfada/ }).click()
await page.waitForTimeout(1200)
check('simülasyon ayrı sayfada açıldı', (await page.locator('text=Arıza anı').count()) > 0)
await page.getByRole('button', { name: '3D', exact: true }).click()
await page.waitForTimeout(3000)

// Geri al
await page.keyboard.press('Control+z')
await page.waitForTimeout(500)

check('sayfa hatası yok', errors.length === 0)
if (errors.length) console.log(errors)
await browser.close()
