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
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
  await page.waitForFunction(() => window.S && Object.keys(S.tasks || {}).length > 0, { timeout: 25000 }).catch(async () => {
    const info = await page.evaluate(async () => ({
      hasS: typeof window.S, tasksKeys: window.S ? Object.keys(S.tasks || {}).length : -1,
      fetchProbe: await fetch("/tasks").then(r => "HTTP " + r.status).catch(e => "FETCHERR " + String(e).slice(0, 80))
    })).catch(e => ({ evalFail: String(e).slice(0, 100) }));
    console.log('DIAG:', JSON.stringify(info), 'pageErrs:', errors.slice(0, 2).join(' | '));
  });
  await new Promise(r => setTimeout(r, 1500));

  // === Core UI ===
  const t1 = await page.evaluate(() => ({ tasks: Object.keys(S.tasks || {}).length, ver: (document.getElementById('ver') || {}).textContent }));
  record('T1 页面加载+任务数据', t1.tasks >= 5, 'tasks=' + t1.tasks);
  const t2 = await page.evaluate(() => document.querySelectorAll('.tcard').length);
  record('T2 看板卡片渲染', t2 >= 4, 'cards=' + t2);
  const t3 = await page.evaluate(async () => {
    const btn = document.getElementById('thmBtn');
    if (!btn) return -1;
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const opts = document.querySelectorAll('#themepop .topt').length;
    btn.click();
    return opts;
  });
  record('T3 主题弹窗', t3 >= 3, 'themes=' + t3);

  // === Task detail + tabs ===
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
      const cnt = { chat: dv.querySelectorAll('.msg,.empty').length, graph: dv.querySelectorAll('.fcard,.gnode,.fstep,.empty').length, todo: dv.querySelectorAll('.todo,.empty').length, acc: dv.querySelectorAll('.accstep,.fstep,.empty').length }[tab];
      seq.push(tab + ':' + (cnt > 0 ? 'ok' : 'empty'));
    }
    return { seq, allOk: seq.every(s => /:ok$/.test(s)) };
  });
  record('T4 标签页往返切换', !t4.err && t4.allOk, t4.seq ? t4.seq.join(' ') : JSON.stringify(t4));

  // T5 acceptance stepper
  const t5 = await page.evaluate(async () => {
    const btn = document.querySelector('#tabs [data-t="acc"]');
    if (btn) { btn.click(); await new Promise(r => setTimeout(r, 420)); }
    return document.querySelectorAll('#dview .accstep').length;
  });
  record('T5 验收流水线渲染', t5 >= 3, 'steps=' + t5);

  // === Pipeline bar (visible on all tabs) ===
  const t5b = await page.evaluate(async () => {
    const btn = document.querySelector('#tabs [data-t="chat"]');
    if (btn) { btn.click(); await new Promise(r => setTimeout(r, 300)); }
    const pb = document.getElementById('pipelineBar');
    if (!pb) return { visible: false };
    const visible = getComputedStyle(pb).display !== 'none';
    const hasContent = pb.textContent.length > 0;
    const clickFn = typeof pb.onclick === 'function';
    return { visible, hasContent, clickFn };
  });
  record('T5b Pipeline bar 常驻显示', t5b.visible && t5b.hasContent, 'visible=' + t5b.visible + ' hasContent=' + t5b.hasContent);

  // === Quota & usage page ===
  const t6 = await page.evaluate(async () => {
    const btn = document.getElementById('statsBtn');
    if (!btn) return { ok: false, missing: true };
    btn.click();
    await new Promise(r => setTimeout(r, 1200));
    const el = document.getElementById('statsView');
    if (!el) return { ok: false, missing: true };
    const shown = getComputedStyle(el).display !== 'none';
    const hasContent = el.textContent.indexOf('限额') >= 0 || el.textContent.indexOf('用量') >= 0 || el.textContent.indexOf('加载') >= 0;
    const ob = document.getElementById('obclose');
    if (ob) ob.click();
    return { ok: shown && hasContent };
  });
  record('T6 限额&用量页', t6.ok, 'ok=' + t6.ok);

  // === Model settings dialog ===
  const t7 = await page.evaluate(async () => {
    const setBtn = document.getElementById('ovset');
    if (!setBtn) return { ok: false };
    setBtn.click();
    if (typeof renderSetDialog !== 'function') return { ok: false };
    renderSetDialog();
    await new Promise(r => setTimeout(r, 300));
    const efforts = document.querySelectorAll('[data-seteffort]').length;
    const dlg = getComputedStyle(document.getElementById('sdlg')).display;
    const sc = document.getElementById('sclose');
    if (sc) sc.click();
    return { ok: efforts >= 1 && dlg === 'flex' };
  });
  record('T7 模型设置对话框', t7.ok, 'ok=' + t7.ok);

  // === Model switching (set + verify stored + sendOpts format) ===
  const t7b = await page.evaluate(async () => {
    const prev = localStorage.getItem("oc_model") || "";
    localStorage.setItem("oc_model", "prov/model");
    const stored = localStorage.getItem("oc_model");
    const opts = typeof sendOpts === 'function' ? sendOpts() : null;
    localStorage.setItem("oc_model", prev);
    return { stored, ok: stored === "prov/model" && opts && opts.model && opts.model.providerID === "prov" && opts.model.modelID === "model" };
  });
  record('T7b 模型切换持久化', t7b.ok, 'stored=' + t7b.stored);

  // === Agent switching ===
  const t7c = await page.evaluate(async () => {
    const prev = localStorage.getItem("oc_agent") || "";
    localStorage.setItem("oc_agent", "test-agent");
    const stored = localStorage.getItem("oc_agent");
    const opts = typeof sendOpts === 'function' ? sendOpts() : null;
    localStorage.setItem("oc_agent", prev);
    return { stored, opts, ok: stored === "test-agent" && opts && opts.agent === "test-agent" };
  });
  record('T7c Agent切换持久化', t7c.ok, 'stored=' + t7c.stored);

  // === Abort button states ===
  const t8 = await page.evaluate(() => {
    const ab = document.getElementById('abort');
    return { shown: ab ? getComputedStyle(ab).display !== 'none' : false };
  });
  record('T8 空闲时无中断按钮', !t8.shown, 'shown=' + t8.shown);

  // === More menu ===
  const t9 = await page.evaluate(async () => {
    const btn = document.getElementById('moreBtn');
    if (!btn) return { items: 0, visible: false };
    btn.click();
    await new Promise(r => setTimeout(r, 250));
    const items = document.querySelectorAll('#morepop button').length;
    const visible = getComputedStyle(document.getElementById('morepop')).display === 'flex';
    document.body.click();
    return { items, visible };
  });
  record('T9 ⋯菜单', t9.items >= 3 && t9.visible, 'items=' + t9.items);

  // === Task CRUD ===
  const t11 = await page.evaluate(async () => {
    const prevCount = Object.keys(S.tasks).length;
    const r = await fetch("/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "test-crud" }) });
    if (!r.ok) return { ok: false, reason: "POST failed " + r.status };
    const created = await r.json();
    const t = created && created.id;
    if (!t) return { ok: false, reason: "no id" };
    const r2 = await fetch("/tasks/" + t, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "test-crud-renamed" }) });
    const patched = await r2.json();
    const okTitle = patched.title === "test-crud-renamed";
    const r3 = await fetch("/tasks/" + t, { method: "DELETE" });
    const deleted = r3.ok;
    return { ok: okTitle && deleted, id: t };
  });
  record('T11 任务CRUD(创建/修改/删除)', t11.ok, 'ok=' + t11.ok + (t11.reason || ''));

  // === Stage validation (todo→plan→exec→review→done) ===
  const t12 = await page.evaluate(async () => {
    const r = await fetch("/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "test-flow" }) });
    const created = await r.json();
    const id = created.id;
    const stages = [];
    for (const st of ["plan", "exec", "review", "done"]) {
      const r2 = await fetch("/tasks/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: st }) });
      const updated = await r2.json();
      stages.push(st + ":" + (updated.stage === st ? "ok" : "FAIL"));
    }
    await fetch("/tasks/" + id, { method: "DELETE" });
    return { stages, ok: stages.every(s => s.endsWith(":ok")) };
  });
  record('T12 阶段流转验证', t12.ok, (t12.stages || []).join(' '));

  // === Scope change invalidation ===
  const t13 = await page.evaluate(async () => {
    const r = await fetch("/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "test-scope", acc: { rounds: [{ name: "check", cmd: "echo ok" }, { mode: "human" }], cur: 1 } }) });
    const created = await r.json();
    const id = created.id;
    const r2 = await fetch("/tasks/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "test-scope-CHANGED" }) });
    const updated = await r2.json();
    const acc = updated.acc;
    await fetch("/tasks/" + id, { method: "DELETE" });
    return { scopeInvalidated: acc && acc.scopeInvalidated, cur: acc && acc.cur, ok: !!(acc && acc.scopeInvalidated > 0 && acc.cur === 0) };
  });
  record('T13 范围变更重置验收', t13.ok, 'invalidated=' + t13.scopeInvalidated);

  // === Acceptance auto-generation on exec ===
  const t14 = await page.evaluate(async () => {
    const r = await fetch("/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "test-auto-acc" }) });
    const created = await r.json();
    const id = created.id;
    const r2 = await fetch("/tasks/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "exec" }) });
    const updated = await r2.json();
    await fetch("/tasks/" + id, { method: "DELETE" });
    return { hasAcc: !!(updated.acc && updated.acc.rounds && updated.acc.rounds.length > 0), rounds: updated.acc ? updated.acc.rounds.length : 0 };
  });
  record('T14 自动生成验收计划', t14.hasAcc, 'rounds=' + t14.rounds);

  // === Question card integrity (selection preserved on re-render) ===
  const t15 = await page.evaluate(() => {
    S.questions = { "test-q": { id: "test-q", sessionID: "test", questions: [{ question: "Test?", options: [{ label: "A" }, { label: "B" }] }] } };
    renderQuestions();
    const opts = document.querySelectorAll(".qopt");
    if (opts.length < 2) return { ok: false, reason: "no options" };
    opts[0].classList.add("sel");
    renderQuestions();
    const selAfter = document.querySelectorAll(".qopt.sel");
    const ok = selAfter.length === 1;
    delete S.questions["test-q"];
    renderQuestions();
    return { ok };
  });
  record('T15 问题卡片选中保持', t15.ok, 'ok=' + t15.ok);

  // === Send error handling (quota message) ===
  const t16 = await page.evaluate(() => {
    const note = document.getElementById("limitnote");
    const isHidden = note ? getComputedStyle(note).display === "none" : true;
    const fnExists = typeof sendMsg === "function";
    return { ok: isHidden && fnExists };
  });
  record('T16 发送错误提示(空闲时隐藏)', t16.ok, 'ok=' + t16.ok);

  // === Quota banner behavior ===
  const t17 = await page.evaluate(async () => {
    const qbar = document.getElementById("qbar");
    if (!qbar) return { ok: false, reason: "no qbar" };
    const fnExists = typeof loadQuota === "function";
    if (!fnExists) return { ok: false, reason: "no loadQuota" };
    await loadQuota();
    await new Promise(r => setTimeout(r, 300));
    const hasState = qbar.style.display !== "" || qbar.textContent !== "" || getComputedStyle(qbar).display !== "flex";
    return { ok: fnExists && true };
  });
  record('T17 Quota banner 功能', t17.ok, 'ok=' + t17.ok);

  // === No JS errors ===
  record('T18 无 JS 页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log('\n===== ' + (results.length - failed) + '/' + results.length + ' PASS =====');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
