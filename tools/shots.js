const puppeteer = require('puppeteer-core');
const BASE = 'http://127.0.0.1:4098/';
const OUT = 'C:\\Users\\ROG\\opencode-pilot\\screenshots\\';
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new', args: ['--disable-gpu', '--force-device-scale-factor=1']
  });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 }).catch(()=>{});
  await page.waitForFunction(() => window.S && Object.keys(S.tasks||{}).length >= 7, { timeout: 20000 }).catch(()=>{});
  await wait(1200);
  await page.screenshot({ path: OUT + 'board.png' });
  console.log('board ok');

  await page.evaluate(() => { document.getElementById('newBtn').blur(); const t = S.tasks['demo1']; openDetail('demo1'); });
  await page.waitForFunction(() => document.querySelectorAll('#dview .msg').length >= 2, { timeout: 20000 }).catch(()=>{});
  await wait(1500);
  await page.screenshot({ path: OUT + 'detail.png' });
  console.log('detail ok');

  await page.evaluate(() => { S.curTab = 'acc'; document.querySelectorAll('#tabs button').forEach(b => b.className = b.getAttribute('data-t') === 'acc' ? 'on' : ''); refreshDetail(true); });
  await wait(600);
  await page.evaluate(() => { closeDetail(); openDetail('demo2'); });
  await wait(900);
  await page.evaluate(() => { const b = document.querySelector('#tabs [data-t="acc"]'); if (b) b.click(); });
  await wait(700);
  await page.screenshot({ path: OUT + 'acceptance.png' });
  console.log('acceptance ok');

  await page.evaluate(() => { closeDetail(); });
  await wait(500);
  await page.evaluate(() => { renderSetDialog(); document.getElementById('sdlg').style.display = 'flex'; });
  await wait(500);
  await page.screenshot({ path: OUT + 'settings.png' });
  console.log('settings ok');

  const p2 = await browser.newPage();
  await p2.setViewport({ width: 900, height: 420, isMobile: true, hasTouch: true });
  await p2.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 }).catch(()=>{});
  await p2.waitForFunction(() => window.S && Object.keys(S.tasks||{}).length >= 7, { timeout: 20000 }).catch(()=>{});
  await wait(1200);
  await p2.screenshot({ path: OUT + 'mobile-landscape.png' });
  console.log('mobile ok');
  await browser.close();
})();
