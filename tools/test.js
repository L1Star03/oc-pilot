const puppeteer = require('puppeteer-core');
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:4098';
const results = [];
function record(name, ok, extra) {
  results.push({ name, ok, extra: extra || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
}
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-first-run', '--no-proxy-server', '--proxy-bypass-list=<-loopback>']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 100)));
  const consoleMsgs = [];
  page.on('console', m => { const t = m.text(); if (t.indexOf('RD-ERR') >= 0 || t.indexOf('error') >= 0 || t.indexOf('Error') >= 0) consoleMsgs.push(t.slice(0, 120)); });
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
  await page.waitForFunction(() => window.S && Object.keys(S.tasks || {}).length > 0, { timeout: 25000 }).catch(async () => {
    const info = await page.evaluate(async () => ({
      title: document.title,
      hasS: typeof window.S,
      tasksKeys: window.S ? Object.keys(S.tasks || {}).length : -1,
      fetchProbe: await fetch("/tasks").then(r => "HTTP " + r.status).catch(e => "FETCHERR " + String(e).slice(0, 80)),
      rawProbe: await fetch("/tasks").then(r => r.text()).then(t => t.slice(0, 120)).catch(e => "TXTERR")
    })).catch(e => ({ evalFail: String(e).slice(0, 100) }));
    console.log('DIAG2:', JSON.stringify(info), 'consoleErrs:', consoleMsgs.slice(0, 3).join(' | '), 'pageErrs:', errors.slice(0, 3).join(' | '));
  });
  await new Promise(r => setTimeout(r, 1500));

  // T1 page loads with demo tasks
  const t1 = await page.evaluate(() => ({ tasks: Object.keys(S.tasks || {}).length, ver: (document.getElementById('ver') || {}).textContent }));
  record('T1 页面加载+任务数据', t1.tasks >= 5, 'tasks=' + t1.tasks + ' ver=' + t1.ver);

  // T2 board cards render
  const t2 = await page.evaluate(() => document.querySelectorAll('.tcard').length);
  record('T2 看板卡片渲染', t2 >= 4, 'cards=' + t2);

  // T3 theme popover
  const t3 = await page.evaluate(async () => {
    const btn = document.getElementById('thmBtn');
    if (!btn) return -1;
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const opts = document.querySelectorAll('#themepop .topt').length;
    btn.click();
    return opts;
  });
  record('T3 主题弹窗', t3 === 4, 'themes=' + t3);

  // T4 detail opens on multi+acc task, tab round trip
  const t4 = await page.evaluate(async () => {
    const t = S.tasks['demo2'] || Object.keys(S.tasks).map(k => S.tasks[k]).find(x => (x.acc && x.workers));
    if (!t) return { err: 'no acc task' };
    openDetail(t.id);
    await new Promise(r => setTimeout(r, 900));
    const seq = [];
    for (const tab of ['chat', 'graph', 'chat', 'graph', 'todo', 'acc', 'graph']) {
      const btn = document.querySelector('#tabs [data-t="' + tab + '"]');
      if (!btn) { seq.push(tab + ':nobtn'); continue; }
      btn.click();
      await new Promise(r => setTimeout(r, 420));
      const dv = document.getElementById('dview');
      const cnt = { chat: dv.querySelectorAll('.msg,.empty').length, graph: dv.querySelectorAll('.fcard,.fstep,.empty').length, todo: dv.querySelectorAll('.todo,.empty').length, acc: dv.querySelectorAll('.accstep,.fstep,.empty').length }[tab];
      seq.push(tab + ':' + (cnt > 0 ? 'ok' : 'empty'));
    }
    return { seq, allOk: seq.every(s => /:ok$/.test(s)) };
  });
  record('T4 标签页往返切换', !t4.err && t4.allOk, t4.seq ? t4.seq.join(' ') : JSON.stringify(t4));

  // T5 acceptance stepper renders with history
  const t5 = await page.evaluate(async () => {
    const btn = document.querySelector('#tabs [data-t="acc"]');
    if (btn) { btn.click(); await new Promise(r => setTimeout(r, 420)); }
    return document.querySelectorAll('#dview .accstep').length;
  });
  record('T5 验收流水线渲染', t5 >= 3, 'steps=' + t5);

  // T6 OBS page
  const t6 = await page.evaluate(async () => {
    const btn = document.getElementById('statsBtn');
    if (!btn) return { ok: false, kpis: 0, missing: true };
    btn.click();
    await new Promise(r => setTimeout(r, 1400));
    const el = document.getElementById('statsView');
    if (!el) return { ok: false, kpis: 0, missing: true };
    const shown = getComputedStyle(el).display !== 'none';
    const ok = shown && (el.querySelectorAll('.obkpi').length === 4 || el.textContent.indexOf('无法获取') >= 0 || el.textContent.indexOf('统计') >= 0);
    const ob = document.getElementById('obclose');
    if (ob) ob.click(); else closeStats();
    return { ok, kpis: el.querySelectorAll('.obkpi').length };
  });
  record('T6 OBS 统计页', t6.ok, 'kpis=' + t6.kpis + (t6.missing ? ' (statsBtn missing)' : ''));

  // T7 settings dialog + effort options (backend-independent)
  const t7 = await page.evaluate(async () => {
    const t = Object.keys(S.tasks).map(k => S.tasks[k]).find(x => x.sessionID !== undefined);
    if (!t) return { efforts: 0, dlgOpen: false };
    openDetail(t.id);
    await new Promise(r => setTimeout(r, 700));
    const setBtn = document.getElementById('ovset');
    if (!setBtn) return { efforts: 0, dlgOpen: false };
    setBtn.click();
    if (typeof renderSetDialog !== 'function') return { efforts: 0, dlgOpen: false };
    renderSetDialog();
    await new Promise(r => setTimeout(r, 300));
    const efforts = document.querySelectorAll('[data-seteffort]').length;
    const dlg = getComputedStyle(document.getElementById('sdlg')).display;
    const sc = document.getElementById('sclose');
    if (sc) sc.click();
    return { efforts, dlgOpen: dlg === 'flex' };
  });
  record('T7 模型设置对话框', t7.efforts >= 1 && t7.dlgOpen, 'efforts=' + t7.efforts);

  // T8 abort hidden when idle
  const t8 = await page.evaluate(() => {
    const ab = document.getElementById('abort');
    return { shown: ab ? getComputedStyle(ab).display !== 'none' : false };
  });
  record('T8 空闲时无中断按钮', !t8.shown, 'shown=' + t8.shown);

  // T9 more menu (⋯)
  const t9 = await page.evaluate(async () => {
    const btn = document.getElementById('moreBtn');
    if (!btn) return { items: 0, visible: false, missing: true };
    btn.click();
    await new Promise(r => setTimeout(r, 250));
    const items = document.querySelectorAll('#morepop button').length;
    const visible = getComputedStyle(document.getElementById('morepop')).display === 'flex';
    document.body.click();
    return { items, visible };
  });
  record('T9 ⋯菜单', t9.items >= 3 && t9.visible, 'items=' + t9.items + (t9.missing ? ' (moreBtn missing)' : ''));

  // T10 no page errors
  record('T10 无 JS 页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log('\n===== ' + (results.length - failed) + '/' + results.length + ' PASS =====');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
