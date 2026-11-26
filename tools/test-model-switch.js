// End-to-end test: model switching through the real oc-pilot UI.
//
// Spawns a mock opencode backend + a real oc-pilot server, drives the real
// settings dialog in a headless browser, then sends prompts through the real
// client send path and asserts the selected model reached the backend.
//
// Usage: node tools/test-model-switch.js
const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_DIR = path.resolve(__dirname, "..");
const results = [];
function record(name, ok, extra) {
  results.push({ name, ok });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function startMock(port) {
  const state = { sessions: {}, status: {}, messages: [], posts: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://local");
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const send = (obj) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const sidMatch = u.pathname.match(/^\/session\/([^/]+)(\/message|\/todo)?$/);
      if (u.pathname === "/__state") return send(state);
      if (u.pathname === "/global/health") return send({ version: "1.19.5" });
      if (u.pathname === "/session/status") return send(state.status);
      if (u.pathname === "/config/providers") {
        return send({ providers: [{ id: "demo", models: {
          alpha: { limit: { context: 128000, output: 8192 } },
          beta: { limit: { context: 64000, output: 4096 } }
        } }] });
      }
      if (u.pathname === "/provider") return send({ connected: ["demo"], all: [{ id: "demo" }] });
      if (u.pathname === "/agent") return send([{ name: "build" }, { name: "plan" }]);
      if (u.pathname === "/session" && req.method === "GET") return send(Object.values(state.sessions));
      if (u.pathname === "/session" && req.method === "POST") {
        const o = JSON.parse(body || "{}");
        const s = { id: "ses_e2e", title: o.title || "e2e", directory: PROJECT_DIR, time: { created: Date.now(), updated: Date.now() } };
        state.sessions[s.id] = s;
        return send(s);
      }
      if (sidMatch) {
        const sid = sidMatch[1];
        if (sidMatch[2] === "/todo") return send([]);
        if (sidMatch[2] === "/message" && req.method === "POST") {
          const o = JSON.parse(body || "{}");
          const model = o.model || { providerID: "", modelID: "" };
          const ts = Date.now();
          state.posts.push({ sid, model });
          state.messages.push({ info: { id: "u" + ts, role: "user", model, time: { created: ts } }, parts: o.parts || [] });
          const asst = { info: { id: "a" + ts, role: "assistant", model, time: { created: ts + 1 } }, parts: [{ type: "text", text: "pong from " + model.modelID }] };
          state.messages.push(asst);
          return send(asst);
        }
        if (sidMatch[2] === "/message" && req.method === "GET") {
          const limit = Number(u.searchParams.get("limit") || 10);
          return send(state.messages.slice(-limit));
        }
        if (!sidMatch[2] && req.method === "GET") {
          return send(state.sessions[sid] || { id: sid, directory: PROJECT_DIR });
        }
      }
      return send({});
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, state })));
}

function waitPilot(base, timeoutMs) {
  const until = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < until) {
      try {
        const r = await fetch(base + "/backends");
        if (r.ok) return true;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  })();
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-pilot-modelswitch-"));
  fs.writeFileSync(path.join(tmp, "tasks.json"), "{}");
  const pilotPort = await freePort();
  const mockPort = await freePort();
  fs.writeFileSync(path.join(tmp, "backends.json"), JSON.stringify([{ name: "mock", port: mockPort }]));

  const { server: mock, state } = await startMock(mockPort);
  const base = "http://127.0.0.1:" + pilotPort;
  const logPath = path.join(tmp, "pilot.log");
  const logFd = fs.openSync(logPath, "w");
  const pilot = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_DIR,
    env: Object.assign({}, process.env, {
      PORT: String(pilotPort),
      PILOT_HOST: "127.0.0.1",
      PILOT_DEMO: "1",
      OPENCODE_PORT: String(mockPort),
      PILOT_BACKENDS_FILE: path.join(tmp, "backends.json"),
      PILOT_TASKS_FILE: path.join(tmp, "tasks.json"),
      PILOT_FS_ROOT: PROJECT_DIR
    }),
    stdio: ["ignore", logFd, logFd]
  });

  let browser = null;
  const cleanup = (code) => {
    try { if (browser) browser.close(); } catch (e) {}
    try { pilot.kill(); } catch (e) {}
    try { mock.close(); } catch (e) {}
    try { fs.closeSync(logFd); } catch (e) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    process.exit(code);
  };

  try {
    const ready = await waitPilot(base, 20000);
    if (!ready) throw new Error("pilot did not start (see " + logPath + ")");

    const edgeCandidates = [
      process.env.EDGE_PATH,
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    ].filter(Boolean);
    const edge = edgeCandidates.find((p) => fs.existsSync(p));
    if (!edge) throw new Error("Microsoft Edge not found; set EDGE_PATH");

    const puppeteer = require("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath: edge,
      headless: "new",
      args: ["--disable-gpu", "--no-first-run", "--no-proxy-server", "--proxy-bypass-list=<-loopback>"]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForFunction(() => Array.isArray(window.modelList) && window.modelList.length >= 2, { timeout: 25000 });
    const models = await page.evaluate(() => window.modelList.map((m) => m.id));
    record("model list loaded through pilot proxy", models.indexOf("demo/alpha") >= 0 && models.indexOf("demo/beta") >= 0, models.join(","));

    // Switch to beta via the real settings dialog handler.
    const selBeta = await page.evaluate(() => {
      renderSetDialog();
      const el = document.querySelector('[data-setmodel="demo/beta"]');
      if (!el) return { ok: false, reason: "beta option missing" };
      el.click();
      return { ok: true, stored: localStorage.getItem("oc_model"), opts: sendOpts() };
    });
    record("settings dialog switches model to beta", selBeta.ok && selBeta.stored === "demo/beta" && selBeta.opts.model && selBeta.opts.model.modelID === "beta", JSON.stringify(selBeta.opts || selBeta));

    const r1 = await page.evaluate(async () => {
      const s = await api("/session", { method: "POST", body: JSON.stringify({ title: "model-switch-e2e" }) });
      await sendMsg(s.id, "ping beta", sendOpts());
      return { sid: s.id };
    });
    let st = await fetch("http://127.0.0.1:" + mockPort + "/__state").then((r) => r.json());
    record("prompt #1 reaches backend with model beta", st.posts.length === 1 && st.posts[0].model.providerID === "demo" && st.posts[0].model.modelID === "beta", JSON.stringify(st.posts[0] && st.posts[0].model));

    // Switch to alpha and send again through the same real code path.
    const selAlpha = await page.evaluate(() => {
      renderSetDialog();
      const el = document.querySelector('[data-setmodel="demo/alpha"]');
      if (!el) return { ok: false };
      el.click();
      return { ok: true, stored: localStorage.getItem("oc_model"), opts: sendOpts() };
    });
    record("settings dialog switches model to alpha", selAlpha.ok && selAlpha.stored === "demo/alpha" && selAlpha.opts.model && selAlpha.opts.model.modelID === "alpha", JSON.stringify(selAlpha.opts || selAlpha));

    await page.evaluate(async (sid) => {
      await sendMsg(sid, "ping alpha", sendOpts());
    }, r1.sid);
    st = await fetch("http://127.0.0.1:" + mockPort + "/__state").then((r) => r.json());
    record("prompt #2 reaches backend with model alpha", st.posts.length === 2 && st.posts[1].model.modelID === "alpha", JSON.stringify(st.posts[1] && st.posts[1].model));
    record("the two prompts used different models", st.posts.length === 2 && st.posts[0].model.modelID !== st.posts[1].model.modelID, st.posts.map((p) => p.model.modelID).join(" -> "));

    const stored = await page.evaluate(async (sid) => {
      const msgs = await api("/session/" + sid + "/message?limit=10");
      return { models: msgs.map((m) => (m.info.role || "") + ":" + ((m.info.model || {}).modelID || "")) };
    }, r1.sid);
    record("assistant replies persisted with switched models", stored.models.indexOf("assistant:beta") >= 0 && stored.models.indexOf("assistant:alpha") >= 0, stored.models.join(" "));
  } catch (e) {
    record("test run", false, String(e && e.message || e));
    try {
      const log = fs.readFileSync(logPath, "utf8").split("\n").slice(-15).join("\n");
      console.log("--- pilot log tail ---\n" + log);
    } catch (e2) {}
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log("\n===== " + (results.length - failed) + "/" + results.length + " PASS =====");
  console.log("MODEL-SWITCH E2E: " + (failed ? "FAIL" : "PASS"));
  cleanup(failed ? 1 : 0);
})();
