const puppeteer = require('puppeteer-core');
const BASE = 'http://127.0.0.1:4098/';
const OUT = 'C:\\Users\\ROG\\opencode-pilot\\screenshots\\';
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new', args: ['--disable-gpu', '--force-device-scale-factor=1.25']
  });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const page = await browser.newPage();
  await page.setViewport({ width: 1520, height: 860 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 }).catch(()=>{});
  await page.waitForFunction(() => window.S && S.tasks && S.tasks.demo_flow, { timeout: 20000 }).catch(()=>{});
  await wait(1000);

  // board re-shot (with the complex task visible)
  await page.screenshot({ path: OUT + 'board.png' });
  console.log('board ok');

  // open flow task -> graph tab
  await page.evaluate(() => { openDetail('demo_flow'); });
  await wait(800);
  await page.evaluate(() => {
    // simulate sessions with todos
    const mk = (id, title, todo) => { S.sessions[id] = { id: id, title: title, time: { updated: Date.now() }, _todo: todo }; };
    const td = (cur, done, pend) => [].concat(
      done.map(c => ({ content: c, status: "completed" })),
      [{ content: cur, status: "in_progress" }],
      pend.map(c => ({ content: c, status: "pending" }))
    );
    mk('ses_demo_main', '示例：电商重构 #主线', td('迁移订单表到独立库', ['梳理服务边界', '拆分领域模型'], ['灰度切流 5%']));
    mk('ses_demo_f1', '#W1 架构设计', td('输出服务拆分决策记录', ['梳理服务边界'], ['评审修订']));
    mk('ses_demo_f2', '#W2 订单服务', td('实现订单状态机', ['订单表迁移'], ['对外 API 收口']));
    mk('ses_demo_f3', '#W3 支付网关', td('支付回调幂等改造', ['渠道抽象层'], ['对账任务']));
    mk('ses_demo_f4', '#W4 全链路压测', td('压测脚本 5k QPS 调通', ['环境搭建'], ['瓶颈分析报告']));
    // active: main + f2 + f3 + f4 running, f1 done
    ['ses_demo_main', 'ses_demo_f2', 'ses_demo_f3', 'ses_demo_f4'].forEach(id => S.liveUntil[id] = Date.now() + 600000);
    document.querySelector('#tabs [data-t="graph"]').click();
    renderGraphView._sig = '';
    renderGraphView();
  });
  await wait(700);
  await page.evaluate(() => { document.getElementById('ovbody').scrollTop = 0; });
  await wait(300);
  await page.screenshot({ path: OUT + 'flow-graph.png' });
  console.log('flow-graph ok');
  await browser.close();
})();
