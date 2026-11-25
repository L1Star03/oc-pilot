const os = require("os");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UP_HOST = "127.0.0.1";
const UP_PORT = parseInt(process.env.OPENCODE_PORT || "4096", 10);
const PORT = parseInt(process.env.PORT || "4097", 10);
const HOST = process.env.PILOT_HOST || "127.0.0.1";
const IS_WIN = process.platform === "win32";
const IS_LOOPBACK = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";

// Security: refuse non-loopback binding without token
if (!IS_LOOPBACK && !process.env.PILOT_TOKEN) {
  console.error("[FATAL] Refusing to bind " + HOST + " without PILOT_TOKEN.");
  console.error("  This server can read/write files and execute commands.");
  console.error("  Set PILOT_TOKEN=<secret> to bind non-loopback addresses.");
  process.exit(1);
}

// Security: auto-generate token for loopback if not set
let TOKEN = process.env.PILOT_TOKEN || "";
if (!TOKEN && IS_LOOPBACK && !process.env.PILOT_DEMO) {
  TOKEN = crypto.randomBytes(8).toString("hex");
  console.log("[auto-token] generated " + TOKEN + " (set PILOT_TOKEN to override)");
}

const PUB = path.join(__dirname, "public");
const ROOTS = [process.env.PILOT_FS_ROOT || os.homedir()];
const TASKS_FILE = process.env.PILOT_TASKS_FILE || path.join(__dirname, "tasks.json");
const BACKENDS_FILE = path.join(__dirname, "backends.json");
const VAULT_FILE = path.join(__dirname, ".vault.json");
const IS_DEMO = !!process.env.PILOT_DEMO;

// ===== Acceptance Integrity Vault =====
// Scripts hashes stored OUTSIDE tasks.json so agents can't tamper via task PATCH
let vault = {};
try { vault = JSON.parse(fs.readFileSync(VAULT_FILE, "utf8")); } catch (e) { vault = {}; }
function saveVault() {
  try { fs.writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2)); } catch (e) {}
}
function hashCmd(cmd) {
  return crypto.createHash("sha256").update(String(cmd)).digest("hex").slice(0, 16);
}
function registerRoundHash(taskId, roundIdx, cmd) {
  if (!vault[taskId]) vault[taskId] = {};
  vault[taskId][roundIdx] = hashCmd(cmd);
  saveVault();
}
function verifyRoundHash(taskId, roundIdx, cmd) {
  const stored = vault[taskId] && vault[taskId][roundIdx];
  if (!stored) return true; // no hash stored = first run or legacy
  return stored === hashCmd(cmd);
}

// ===== Default L1 Acceptance Detection =====
const PROJECT_DETECTORS = [
  { file: "package.json", rounds: [
    { name: "build", cmd: "npm run build --if-present", intervalMin: 2, maxRetry: 3 },
    { name: "test", cmd: "npm test --if-present", intervalMin: 3, maxRetry: 3 },
    { name: "lint", cmd: "npm run lint --if-present", intervalMin: 3, maxRetry: 2 }
  ]},
  { file: "build.gradle", rounds: [
    { name: "build", cmd: "gradle build --offline -q", intervalMin: 3, maxRetry: 3 }
  ]},
  { file: "CMakeLists.txt", rounds: [
    { name: "build", cmd: "cmake --build build --target all -j4 2>&1 | tail -5", intervalMin: 3, maxRetry: 3 }
  ]},
  { file: "Makefile", rounds: [
    { name: "build", cmd: "make -j4 2>&1 | tail -5", intervalMin: 3, maxRetry: 3 },
    { name: "test", cmd: "make test 2>&1 | tail -10", intervalMin: 3, maxRetry: 3 }
  ]}
];
function detectDefaultAcceptance(dir) {
  for (const d of PROJECT_DETECTORS) {
    if (fs.existsSync(path.join(dir, d.file))) {
      return { rounds: d.rounds.concat([{ mode: "human", name: "human review" }]), auto: true };
    }
  }
  return null;
}

// ===== Git HEAD tracking for evidence-commit binding =====
function getGitHead(dir) {
  return new Promise((resolve) => {
    require("child_process").execFile("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 5000 }, (e, out) => {
      resolve(e ? null : out.trim());
    });
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".apk": "application/vnd.android.package-archive",
  ".zip": "application/zip",
  ".log": "text/plain; charset=utf-8"
};

let tasks = {};
try { tasks = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8")); } catch (e) { tasks = {}; }
function saveTasks() { try { fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2)); } catch (e) {} }

let backends = [];
try { backends = JSON.parse(fs.readFileSync(BACKENDS_FILE, "utf8")); } catch (e) { backends = []; }
if (!backends.find(function(b){ return b.port === 4096; })) backends.unshift({ name: "web", port: 4096 });
function pickBackend(req) {
  const p = parseInt(req.headers["x-pilot-backend"] || "", 10);
  const b = backends.find(function(x){ return x.port === p; });
  return b ? b.port : 4096;
}

function tokenOK(req, url) {
  if (!TOKEN) return true;
  const h = req.headers["x-pilot-token"] || url.searchParams.get("k") || "";
  const a = req.headers["authorization"] || "";
  return h === TOKEN || a === "Bearer " + TOKEN;
}
function deny(res) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "unauthorized" }));
}
function originOK(req) {
  const host = req.headers["host"] || "";
  const origin = req.headers["origin"] || "";
  const referer = req.headers["referer"] || "";
  if (host && !host.startsWith("127.0.0.1") && !host.startsWith("localhost") && !host.startsWith("::1") && host !== (req.socket.remoteAddress || "")) {
    return false;
  }
  if (origin && origin !== "null") {
    try {
      const o = new URL(origin);
      if (o.hostname !== "127.0.0.1" && o.hostname !== "localhost" && o.hostname !== "::1") return false;
    } catch (e) { return false; }
  }
  return true;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function underRoot(p) {
  const full = path.resolve(p || ROOTS[0]);
  for (const r of ROOTS) {
    const rr = path.resolve(r);
    const fl = full.toLowerCase();
    const rl = rr.toLowerCase();
    if (fl === rl || fl.startsWith(rl + path.sep.toLowerCase())) return full;
  }
  return null;
}

function readBody(req, cb) {
  let buf = "";
  req.on("data", function(c){ buf += c; });
  req.on("end", function(){ let o = null; try { o = buf ? JSON.parse(buf) : {}; } catch(e){ o = {}; } cb(o); });
}

function handleTasks(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && url.pathname === "/tasks") { json(res, 200, tasks); return; }
  if (req.method === "POST" && url.pathname === "/tasks") {
    readBody(req, function(o){
      const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      let acc = o.acc || null;
      // If no acceptance plan provided, auto-detect from project
      if (!acc && o.sessionID) {
        const sessDir = path.join(ROOTS[0], "project");
        acc = detectDefaultAcceptance(ROOTS[0]);
        if (acc) acc.auto = true;
      }
      tasks[id] = { id: id, title: String(o.title || "新任务").slice(0, 200), desc: String(o.desc || "").slice(0, 2000), stage: "todo", sessionID: null, mode: o.mode === "multi" ? "multi" : "single", workers: [], merged: false, wn: Math.max(2, Math.min(4, Math.round(o.wn) || 3)), acc: acc, created: Date.now(), updated: Date.now() };
      // Register acceptance script hashes in vault
      if (acc && acc.rounds) {
        for (let ri = 0; ri < acc.rounds.length; ri++) {
          if (acc.rounds[ri].cmd) registerRoundHash(id, ri, acc.rounds[ri].cmd);
        }
      }
      saveTasks();
      json(res, 200, tasks[id]);
    });
    return;
  }
  if (req.method === "PATCH" && parts.length === 2) {
    const t = tasks[parts[1]];
    if (!t) { json(res, 404, { error: "no task" }); return; }
    readBody(req, function(o){
      const STAGES = ["todo", "plan", "exec", "review", "done"];
      const scopeChanged = (typeof o.title === "string" && o.title !== t.title) || (typeof o.desc === "string" && o.desc !== t.desc);
      if (o.stage && STAGES.indexOf(o.stage) >= 0) t.stage = o.stage;
      if (typeof o.title === "string") t.title = o.title.slice(0, 200);
      if (typeof o.desc === "string") t.desc = o.desc.slice(0, 2000);
      if (typeof o.sessionID === "string") t.sessionID = o.sessionID;
      if (typeof o.mode === "string") t.mode = o.mode;
      if (Array.isArray(o.workers)) t.workers = o.workers.slice(0, 8);
      if (typeof o.merged === "boolean") t.merged = o.merged;
      if (typeof o.mergeSid === "string") t.mergeSid = o.mergeSid;
      if (typeof o.wn === "number") t.wn = Math.max(2, Math.min(4, Math.round(o.wn)));
      if (typeof o.gen === "number") t.gen = o.gen;
      if (o.acc && typeof o.acc === "object") {
        t.acc = o.acc;
        // Re-register hashes when acceptance plan is explicitly updated
        if (t.acc.rounds) {
          for (let ri = 0; ri < t.acc.rounds.length; ri++) {
            if (t.acc.rounds[ri].cmd) registerRoundHash(parts[1], ri, t.acc.rounds[ri].cmd);
          }
        }
      }
      // Scope change invalidates acceptance progress
      if (scopeChanged && t.acc && !t.acc.done) {
        t.acc.cur = 0;
        t.acc.attempts = 0;
        t.acc.history = (t.acc.history || []).concat([{ r: -1, pass: -1, out: "scope changed: acceptance reset", t: Date.now() }]);
        t.acc.status = "";
        t.acc.scopeInvalidated = (t.acc.scopeInvalidated || 0) + 1;
      }
      t.updated = Date.now();
      saveTasks();
      json(res, 200, t);
    });
    return;
  }
  if (req.method === "DELETE" && parts.length === 2) {
    if (tasks[parts[1]]) { delete tasks[parts[1]]; saveTasks(); json(res, 200, { ok: true }); }
    else json(res, 404, { error: "no task" });
    return;
  }
  json(res, 404, { error: "bad task route" });
}

function handleFs(req, res, url) {
  const op = url.pathname;

  if (op === "/fs/list") {
    const full = underRoot(url.searchParams.get("path"));
    if (!full) { json(res, 400, { error: "path not allowed" }); return; }
    fs.readdir(full, { withFileTypes: true }, (err, dirs) => {
      if (err) { json(res, 500, { error: String(err.message || err) }); return; }
      const entries = [];
      let pending = dirs.length;
      for (const d of dirs) {
        if (d.name.startsWith(".") && d.name !== ".gradle") { if (--pending <= 0) done(); continue; }
        const fp = path.join(full, d.name);
        fs.stat(fp, (e2, st) => {
          if (!e2) entries.push({ name: d.name, dir: d.isDirectory(), size: st.size, mtime: st.mtimeMs });
          if (--pending <= 0) done();
        });
      }
      if (pending <= 0) done();
      function done() {
        entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
        const parent = path.dirname(full);
        json(res, 200, { path: full, parent: underRoot(parent) ? parent : null, entries });
      }
    });
    return;
  }

  if (op === "/fs/file") {
    const full = underRoot(url.searchParams.get("path"));
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(full).toLowerCase();
    const ct = MIME[ext] || "application/octet-stream";
    const isImg = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext);
    const dl = url.searchParams.get("dl") === "1";
    const disp = (isImg && !dl) ? "inline" : "attachment";
    const st = fs.statSync(full);
    res.writeHead(200, {
      "Content-Type": ct,
      "Content-Length": st.size,
      "Content-Disposition": disp + "; filename*=UTF-8''" + encodeURIComponent(path.basename(full)),
      "Cache-Control": "no-store"
    });
    fs.createReadStream(full).pipe(res);
    return;
  }

  if (op === "/fs/upload" && req.method === "POST") {
    const dir = underRoot(url.searchParams.get("dir"));
    if (!dir) { json(res, 400, { error: "dir not allowed" }); return; }
    let name = decodeURIComponent(req.headers["x-filename"] || "upload.bin");
    name = path.basename(name).replace(/[\\/:*?"<>|]/g, "_");
    fs.mkdir(dir, { recursive: true }, () => {
      const dest = path.join(dir, name);
      const ws = fs.createWriteStream(dest);
      req.pipe(ws);
      ws.on("finish", () => json(res, 200, { ok: true, path: dest }));
      ws.on("error", (e) => json(res, 500, { error: String(e.message || e) }));
    });
    return;
  }

  if (op === "/fs/git") {
    const dir = underRoot(url.searchParams.get("dir"));
    if (!dir) { json(res, 400, { error: "dir not allowed" }); return; }
    const { execFile } = require("child_process");
    const git = (args, cb) => execFile("git", ["-C", dir].concat(args), { timeout: 8000, maxBuffer: 8*1024*1024, encoding: "utf8" }, (e, out) => cb(e ? null : out));
    git(["status", "--porcelain=v1", "-b"], (st) => {
      if (!st) { json(res, 200, { repo: false }); return; }
      git(["diff", "--numstat"], (df) => {
        git(["diff", "--cached", "--numstat"], (dc) => {
          const num = {};
          String(df || "").split("\n").concat(String(dc || "").split("\n")).forEach((l) => {
            const m = l.trim().split("\t");
            if (m.length >= 3) {
              const p = m[2];
              if (!num[p]) num[p] = { add: 0, del: 0 };
              num[p].add += parseInt(m[0], 10) || 0;
              num[p].del += parseInt(m[1], 10) || 0;
            }
          });
          const files = [];
          st.split("\n").forEach((l) => {
            if (!l || l.indexOf("##") === 0) return;
            const s = l.slice(0, 2).trim();
            const p = l.slice(3).trim().replace(/^"|"$/g, "");
            const n = num[p] || { add: null, del: null };
            files.push({ path: p, status: s, add: n.add, del: n.del });
          });
          const bm = st.match(/## (.*)/);
          json(res, 200, { repo: true, branch: bm ? bm[1] : "", files });
        });
      });
    });
    return;
  }

  res.writeHead(404); res.end("not found");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://local");

  // CSRF/DNS-rebinding protection: validate Host header
  if (!originOK(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "forbidden: cross-origin request blocked" }));
    return;
  }

  const needsAuth = url.pathname.startsWith("/fs/") || url.pathname.startsWith("/api/") || url.pathname.startsWith("/tasks") || url.pathname.startsWith("/acc/") || url.pathname === "/backends" || url.pathname === "/ocinstances" || url.pathname === "/quota";
  if (needsAuth && !tokenOK(req, url)) { deny(res); return; }

  if (url.pathname.startsWith("/fs/")) { handleFs(req, res, url); return; }

  if (url.pathname === "/backends") { json(res, 200, backends); return; }

  if (url.pathname === "/ocinstances") {
    if (!IS_WIN) { json(res, 200, { ports: [] }); return; }
    const { exec } = require("child_process");
    exec('tasklist /fi "IMAGENAME eq opencode.exe" /fo csv /nh', { timeout: 8000 }, (e, out) => {
      const pids = new Set();
      String(out || "").split("\n").forEach((l) => {
        const m = l.match(/"opencode\.exe","(\d+)"/i);
        if (m) pids.add(m[1]);
      });
      if (!pids.size) { json(res, 200, { ports: [] }); return; }
      exec("netstat -ano -p tcp", { timeout: 8000, maxBuffer: 8*1024*1024 }, (e2, ns) => {
        const ports = new Set();
        String(ns || "").split("\n").forEach((l) => {
          if (l.indexOf("LISTENING") < 0) return;
          const cols = l.trim().split(/\s+/);
          const local = cols[1] || "";
          const pid = cols[cols.length - 1];
          if (!pids.has(pid)) return;
          const pm = local.match(/:(\d+)$/);
          if (pm && parseInt(pm[1], 10) > 1024) ports.add(parseInt(pm[1], 10));
        });
        json(res, 200, { ports: Array.from(ports) });
      });
    });
    return;
  }

  if (url.pathname.startsWith("/tasks")) { handleTasks(req, res, url); return; }

  if (url.pathname === "/acc/run" && req.method === "POST") {
    readBody(req, function(o){
      const cmd = String(o.cmd || "");
      const cwd = underRoot(o.dir || ROOTS[0]) || ROOTS[0];
      if (!cmd || !cwd) { json(res, 400, { error: "bad acc run" }); return; }
      const { exec } = require("child_process");
      exec(cmd, { cwd, timeout: 150000, maxBuffer: 4*1024*1024, encoding: "utf8", shell: IS_WIN ? "powershell" : "/bin/bash" }, (e, out) => {
        json(res, 200, { pass: !e, code: e ? (e.code || 1) : 0, output: String(out || (e ? e.message : "")).slice(0, 4000) });
      });
    });
    return;
  }

  if (url.pathname === "/quota") {
    try {
      const logPath = process.env.OPENCODE_LOG || "C:\\Users\\ROG\\.local\\share\\opencode\\log\\opencode.log";
      const st = fs.statSync(logPath);
      const fd = fs.openSync(logPath, "r");
      const len = Math.min(400 * 1024, st.size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      fs.closeSync(fd);
      const tail = buf.toString("utf8");
      const errs = [];
      for (const l of tail.split("\n")) {
        if (l.indexOf("level=ERROR") < 0) continue;
        if (l.indexOf("AI_APICallError") < 0 && l.indexOf("stream error") < 0) continue;
        try {
          const ts = (l.match(/timestamp=([\dT:.+Z-]+)/) || [])[1] || "";
          const prov = (l.match(/providerID=([^\s]+)/) || [])[1] || "";
          const model = (l.match(/modelID=([^\s]+)/) || [])[1] || "";
          const sess = (l.match(/session\.id=([^\s]+)/) || [])[1] || "";
          let errm = (l.match(/error\.error="([^"]*)"/) || [])[1] || "";
          if (!errm) errm = (l.match(/error="([^"]*)"/) || [])[1] || "";
          if (!errm) continue;
          const reset = (errm.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*重置/) || [])[1] || "";
          let resetEpoch = 0;
          if (reset) resetEpoch = Date.parse(reset + "+08:00");
          const t = ts ? Date.parse(ts) : 0;
          if (t && Date.now() - t > 6 * 3600 * 1000) continue;
          if (resetEpoch && Date.now() > resetEpoch) continue;
          errs.push({ t, provider: prov, model: model, session: sess, message: errm.slice(0, 200), reset, resetEpoch });
        } catch (e2) {}
      }
      const seen = {};
      const uniq = errs.filter(function(x){ const key = x.provider + x.model + x.message.slice(0, 60); if (seen[key]) return false; seen[key] = 1; return true; }).slice(-5);
      json(res, 200, { errors: uniq });
    } catch (e) { json(res, 200, { errors: [] }); }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const upPath = url.pathname.slice(4) + url.search;
    const port = pickBackend(req);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (["host", "connection", "accept-encoding", "content-length", "transfer-encoding", "x-pilot-backend", "origin", "referer"].includes(lk)) continue;
      headers[k] = v;
    }
    const upReq = http.request({ host: UP_HOST, port, path: upPath, method: req.method, headers }, (upRes) => {
      const h = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        const lk = k.toLowerCase();
        if (["transfer-encoding", "connection", "content-length", "content-encoding"].includes(lk)) continue;
      h[k] = v;
    }
    res.writeHead(upRes.statusCode || 502, h);
      upRes.pipe(res);
    });
    upReq.on("error", (e) => {
      try { json(res, 502, { error: String(e && e.message || e) }); } catch (_) {}
    });
    req.pipe(upReq);
    res.on("close", () => upReq.destroy());
    return;
  }

  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(PUB, path.normalize(p).replace(/^([.][.][/\\])+/, ""));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log("oc-pilot on http://" + HOST + ":" + PORT);
  console.log("  auth: " + (TOKEN ? "token (" + TOKEN.slice(0, 4) + "...)" : "none (loopback only)"));
  console.log("  mode: " + (IS_DEMO ? "demo (no backend required)" : "live (opencode " + UP_HOST + ":" + UP_PORT + ")"));
  if (!IS_DEMO && !TOKEN) {
    console.log("  [WARN] no token set. Auto-generated for this session only.");
    console.log("         Set PILOT_TOKEN env var for stable access.");
  }
});

// ===== opencode adapter =====
const gov = require("./lib/governance");

// Check compatibility on startup
gov.checkCompatibility().then(comp => {
  if (!comp.ok) {
    console.warn("[compat] " + comp.message);
  } else {
    console.log("[compat] " + comp.message);
  }
}).catch(() => {});

const ACC_BACKEND = process.env.ACC_BACKEND || "http://127.0.0.1:4096";
setInterval(async () => {
  const { exec } = require("child_process");
  for (const id of Object.keys(tasks)) {
    const t = tasks[id];
    if (t.stage !== "exec" || !t.sessionID) continue;
    if (t.zombieAt && Date.now() - t.zombieAt < 5 * 60000) continue;
    try {
      const sess = await fetch(ACC_BACKEND + "/session/" + t.sessionID).then(r => r.json()).catch(() => null);
      const upd = sess && sess.time && sess.time.updated ? sess.time.updated : 0;
      if (!upd || Date.now() - upd < 5 * 60000) continue;
      const st = await fetch(ACC_BACKEND + "/session/status").then(r => r.json()).catch(() => ({}));
      if (st && st[t.sessionID] && st[t.sessionID].type === "busy") continue;
      const msgs = await fetch(ACC_BACKEND + "/session/" + t.sessionID + "/message?limit=1").then(r => r.json()).catch(() => null);
      if (!msgs || !msgs.length) continue;
      const m0 = msgs[0];
      const mtime = (m0.info && m0.info.time && m0.info.time.created) || 0;
      if (!mtime || Date.now() - mtime < 5 * 60000) continue;
      const running = (m0.parts || []).filter(p => p.type === "tool" && p.state && p.state.status === "running");
      const unanswered = (m0.info || {}).role === "user";
      if (running.length || unanswered) {
        t.zombieAt = Date.now();
        saveTasks();
        await fetch(ACC_BACKEND + "/session/" + t.sessionID + "/abort", { method: "POST" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2500));
        await fetch(ACC_BACKEND + "/session/" + t.sessionID + "/prompt_async", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts: [{ type: "text", text: "（系统监督）检测到你有一个卡死的工具运行或未处理的指令。已强制清理。请重建 todo 清单后从断点继续完成剩余工作，长命令请拆分避免再次卡死。" }] }) }).catch(() => {});
        console.log("[zombie] revived " + t.sessionID);
      }
    } catch (e) {}
  }
}, 45000).unref();

setInterval(async () => {
  const { exec } = require("child_process");
  for (const id of Object.keys(tasks)) {
    const t = tasks[id];
    const acc = t.acc;
    if (!acc || acc.done || acc.pause) continue;
    if (t.stage !== "exec" && t.stage !== "review") continue;
    if (acc.status === "waiting_human") continue;
    if (acc.tampered) continue; // blocked by tamper detection
    if (acc.nextAt && Date.now() < acc.nextAt) continue;

    const rounds = acc.rounds || [];
    const ri = acc.cur || 0;
    if (ri >= rounds.length) { acc.done = 1; saveTasks(); continue; }
    const r = rounds[ri];
    if (r.mode === "human") {
      // === Governance gates before human review ===
      const gates = await gov.runGovernanceGates(t, ROOTS[0]);
      if (!gates.pass) {
        const details = gates.failures.map(f => `[${f.gate}] ${f.detail}`).join("; ");
        acc.status = "governance_blocked";
        acc.governance = { failures: gates.failures, checked: Date.now() };
        saveTasks();
        console.log("[governance] task " + id + " blocked: " + details);
        // Send feedback to agent if it has pending todos
        const todoFail = gates.failures.find(f => f.gate === "todo_convergence");
        if (todoFail && t.sessionID) {
          await gov.sendFeedback(t.sessionID,
            "（治理门禁）你的 todo 清单还有 " + todoFail.detail + "。请先完成或显式取消未完成的步骤，然后才能进入验收。\n未完成项：\n" + todoFail.items.map(x => "- " + x).join("\n"));
        }
        const treeFail = gates.failures.find(f => f.gate === "clean_tree");
        if (treeFail && t.sessionID) {
          await gov.sendFeedback(t.sessionID,
            "（治理门禁）工作区有 " + treeFail.detail + " 未提交。请 git commit 后再宣告完成。\n变更文件：\n" + treeFail.items.join("\n"));
        }
        continue;
      }
      acc.status = "waiting_human";
      saveTasks();
      continue;
    }
    if (!r.cmd) { acc.cur = ri + 1; saveTasks(); continue; }

    // === Anti-tamper: verify script hash ===
    if (!verifyRoundHash(id, ri, r.cmd)) {
      acc.tampered = { round: ri, detected: Date.now(), expected: vault[id][ri], actual: hashCmd(r.cmd) };
      acc.status = "tampered";
      saveTasks();
      console.log("[tamper] task " + id + " round " + ri + " script hash mismatch");
      continue;
    }

    try {
      const st = await fetch(ACC_BACKEND + "/session/status").then(r => r.json());
      const busy = st && st[t.sessionID] && st[t.sessionID].type === "busy";
      if (busy) continue;
    } catch (e) { continue; }

    exec(String(r.cmd), { cwd: ROOTS[0], timeout: 150000, maxBuffer: 4*1024*1024, encoding: "utf8", shell: IS_WIN ? "powershell" : "/bin/bash" }, async (e, out) => {
      acc.history = acc.history || [];
      const pass = !e;
      if (pass) {
        // === Evidence-commit binding: record git HEAD ===
        const gitHead = await getGitHead(ROOTS[0]);
        acc.history.push({ r: ri, pass: 1, out: String(out||"").slice(0,200), t: Date.now(), commit: gitHead });
        acc.cur = ri + 1;
        acc.attempts = 0;
        acc.lastPassCommit = gitHead;
        if (acc.cur >= rounds.length) {
          // Final governance check before done
          const gates = await gov.runGovernanceGates(t, ROOTS[0]);
          if (!gates.pass) {
            acc.done = 0;
            acc.cur = Math.max(0, ri);
            acc.governance = { failures: gates.failures, checked: Date.now() };
            const todoFail = gates.failures.find(f => f.gate === "todo_convergence");
            if (todoFail && t.sessionID) {
              await gov.sendFeedback(t.sessionID,
                "（治理门禁·最终检查）todo 有 " + todoFail.detail + " 未完成，不能标记为完成。\n未完成项：\n" + todoFail.items.map(x => "- " + x).join("\n"));
            }
            const treeFail = gates.failures.find(f => f.gate === "clean_tree");
            if (treeFail && t.sessionID) {
              await gov.sendFeedback(t.sessionID,
                "（治理门禁·最终检查）工作区不干净： " + treeFail.detail + "。请先 commit。\n变更文件：\n" + treeFail.items.join("\n"));
            }
            acc.nextAt = Date.now() + 60000; // retry in 1 minute
          } else {
            acc.done = 1;
          }
        }
      } else {
        acc.attempts = (acc.attempts||0) + 1;
        acc.history.push({ r: ri, pass: 0, out: String(out || (e && e.message) || "").slice(0,300), t: Date.now() });
        const rname = r.name || ("check" + (ri+1));
        const maxR = r.maxRetry || 3;
        let fb;
        if (acc.attempts >= maxR) {
          fb = "（验收升级·第" + (ri+1) + "轮「" + rname + "」已连续 " + acc.attempts + " 次未过）\n最近检查输出：\n" + String(out || (e && e.message) || "无输出") + "\n停止表面修补：请重新分析失败根因，必要时更换方案。未达验收标准不得宣告完成。";
          acc.attempts = 0;
          acc.escalated = (acc.escalated || 0) + 1;
          acc.nextAt = Date.now() + (r.intervalMin || 3) * 2 * 60000;
        } else {
          fb = "（验收打回·第" + (ri+1) + "轮「" + rname + "」第" + acc.attempts + "/" + maxR + "次未过）\n检查输出：\n" + String(out || (e && e.message) || "无输出") + "\n请针对性修复后等待复检。";
          acc.nextAt = Date.now() + (r.intervalMin || 3) * 60000;
        }
        try {
          await fetch(ACC_BACKEND + "/session/" + t.sessionID + "/prompt_async", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts: [{ type: "text", text: fb }] }) });
        } catch (e2) {}
      }
      saveTasks();
    });
  }

  // === Evidence-commit invalidation: if HEAD changed after pass, reset progress ===
  for (const id of Object.keys(tasks)) {
    const t = tasks[id];
    const acc = t.acc;
    if (!acc || acc.done || !acc.lastPassCommit) continue;
    if (t.stage !== "review") continue; // only check in review stage
    const currentHead = await getGitHead(ROOTS[0]);
    if (currentHead && currentHead !== acc.lastPassCommit) {
      // Code changed after acceptance passed — invalidate
      acc.cur = 0;
      acc.history = (acc.history || []).concat([{ r: -1, pass: -1, out: "code changed after acceptance (commit " + acc.lastPassCommit.slice(0,7) + " → " + currentHead.slice(0,7) + "): evidence invalidated", t: Date.now() }]);
      acc.lastPassCommit = null;
      t.stage = "exec";
      saveTasks();
      console.log("[evidence] task " + id + " code changed after pass, resetting acceptance");
    }
  }
}, 30000).unref();
