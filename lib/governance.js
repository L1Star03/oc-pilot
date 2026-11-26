const { execFile, exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const BACKEND = process.env.ACC_BACKEND || "http://127.0.0.1:4096";
const ROOTS = process.env.PILOT_FS_ROOT || require("os").homedir();
const IS_WIN = process.platform === "win32";

// ===== opencode adapter =====
async function ocGet(pathname) {
  try {
    const r = await fetch(BACKEND + pathname);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

async function ocPost(pathname, body) {
  try {
    const r = await fetch(BACKEND + pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return r.ok;
  } catch (e) { return false; }
}

async function getTodos(sessionID) {
  return ocGet("/session/" + sessionID + "/todo");
}

async function getMessages(sessionID, limit) {
  const msgs = await ocGet("/session/" + sessionID + "/message?limit=" + (limit || 5));
  return Array.isArray(msgs) ? msgs : [];
}

async function getSessionStatus() {
  return ocGet("/session/status") || {};
}

async function sendFeedback(sessionID, text) {
  return ocPost("/session/" + sessionID + "/prompt_async", { parts: [{ type: "text", text }] });
}

// ===== E1: Todo convergence gate =====
// Returns { converged, pending, total, pendingItems }
async function checkTodoConvergence(sessionID) {
  const todos = await getTodos(sessionID);
  if (!todos || !todos.length) return { converged: true, pending: 0, total: 0, pendingItems: [] };
  const pendingItems = todos.filter(t => t.status === "pending" || t.status === "in_progress");
  return {
    converged: pendingItems.length === 0,
    pending: pendingItems.length,
    total: todos.length,
    pendingItems: pendingItems.map(t => t.content.slice(0, 80))
  };
}

// ===== E2: Clean working tree gate =====
// Returns { clean, changedFiles }
async function checkCleanTree(dir) {
  return new Promise((resolve) => {
    execFile("git", ["-C", dir, "status", "--porcelain"], { timeout: 8000 }, (e, out) => {
      if (e) { resolve({ clean: true, changedFiles: [] }); return; }
      const files = String(out || "").split("\n").filter(l => l.trim()).map(l => l.slice(3).trim());
      resolve({ clean: files.length === 0, changedFiles: files.slice(0, 10) });
    });
  });
}

// ===== E3: Self-report verification =====
// Detect if agent claims "done" while todos are incomplete
const COMPLETION_CLAIMS = [
  /全部完成/, /所有步骤完成/, /已完成/, /任务完成/, /已实现/, /已修复/,
  /all (steps|tasks) (are )?(done|complete)/i, /everything.*done/i,
  /已完成所有/, /已处理/, /已解决/
];

async function verifySelfReport(sessionID) {
  const todos = await getTodos(sessionID);
  if (!todos || !todos.length) return { verified: true, claims: [], mismatches: [] };

  const pendingItems = todos.filter(t => t.status === "pending" || t.status === "in_progress");
  if (pendingItems.length === 0) return { verified: true, claims: [], mismatches: [] };

  // Get last assistant message
  const msgs = await getMessages(sessionID, 3);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if ((m.info || {}).role !== "assistant") continue;
    const texts = (m.parts || []).filter(p => p.type === "text" && p.text).map(p => p.text);
    const fullText = texts.join("\n");
    const claims = COMPLETION_CLAIMS.filter(rx => rx.test(fullText));
    if (claims.length > 0 && pendingItems.length > 0) {
      return {
        verified: false,
        claims: claims.map(rx => String(rx)),
        mismatches: pendingItems.map(t => t.content.slice(0, 80)),
        message: fullText.slice(0, 300)
      };
    }
    break; // only check last assistant message
  }
  return { verified: true, claims: [], mismatches: [] };
}

// ===== Governance gates =====
// Run all three gates for a task. Returns { pass, failures: [{gate, detail}] }
async function runGovernanceGates(task, dir) {
  const failures = [];

  // E1: Todo convergence
  if (task.sessionID) {
    const todoCheck = await checkTodoConvergence(task.sessionID);
    if (!todoCheck.converged) {
      failures.push({
        gate: "todo_convergence",
        detail: `${todoCheck.pending}/${todoCheck.total} todos incomplete`,
        items: todoCheck.pendingItems
      });
    }
  }

  // E2: Clean working tree
  const treeCheck = await checkCleanTree(dir || ROOTS);
  if (!treeCheck.clean) {
    failures.push({
      gate: "clean_tree",
      detail: `${treeCheck.changedFiles.length} uncommitted files`,
      items: treeCheck.changedFiles
    });
  }

  // E3: Self-report verification
  if (task.sessionID) {
    const reportCheck = await verifySelfReport(task.sessionID);
    if (!reportCheck.verified) {
      failures.push({
        gate: "self_report",
        detail: `agent claims done but ${reportCheck.mismatches.length} todos pending`,
        claims: reportCheck.claims,
        items: reportCheck.mismatches
      });
    }
  }

  return { pass: failures.length === 0, failures };
}

// ===== Version detection =====
async function detectOpencodeVersion() {
  try {
    const info = await ocGet("/global/health");
    if (info && info.version) return info.version;
  } catch (e) {}
  return null;
}

const COMPATIBLE_VERSIONS = ["1.19.5"];

async function checkCompatibility() {
  const version = await detectOpencodeVersion();
  if (!version) return { ok: false, version: null, message: "Cannot reach opencode server" };
  const compatible = COMPATIBLE_VERSIONS.some(v => version.startsWith(v));
  return {
    ok: compatible,
    version,
    message: compatible ? `opencode ${version} (compatible)` : `opencode ${version} (UNTESTED, may break. Compatible: ${COMPATIBLE_VERSIONS.join(", ")})`
  };
}

// ===== Independent review agent =====
async function gitRoot(dir) {
  return new Promise((resolve) => {
    execFile("git", ["-C", dir, "rev-parse", "--show-toplevel"], { timeout: 8000 }, (e, out) => {
      resolve(e ? null : (String(out || "").trim() || null));
    });
  });
}

// Resolve the project directory a task actually lives in:
// explicit task.dir > opencode session directory > pilot fs root.
async function resolveProjectDir(task) {
  if (task && task.dir && fs.existsSync(task.dir)) {
    return (await gitRoot(task.dir)) || task.dir;
  }
  if (task && task.sessionID) {
    const sess = await ocGet("/session/" + task.sessionID);
    if (sess && sess.directory && fs.existsSync(sess.directory)) {
      return (await gitRoot(sess.directory)) || sess.directory;
    }
  }
  return (await gitRoot(ROOTS)) || ROOTS;
}

function indent(text, prefix) {
  return String(text || "").split("\n").map(l => prefix + l).join("\n");
}

// Spawns a fresh session that reviews code changes against acceptance criteria
async function spawnReviewAgent(task, acceptanceResults) {
  const projectDir = await resolveProjectDir(task);
  const reviewPaths = (task && Array.isArray(task.reviewPaths) && task.reviewPaths.length) ? task.reviewPaths : null;
  const diff = await getGitDiff(projectDir, reviewPaths);
  const resultsText = (acceptanceResults && acceptanceResults.length)
    ? acceptanceResults.map(r => "- " + (r.name || "check") + ": " + (r.pass ? "PASS" : "FAIL") +
        (r.out ? "\n" + indent(String(r.out).slice(0, 4000), "    ") : "")).join("\n")
    : "(no acceptance results)";
  const prompt = `You are an independent code reviewer. You have NO context from the implementation — evaluate ONLY the evidence.

TASK: ${task.title}
DESCRIPTION: ${task.desc || "(none)"}
PROJECT: ${projectDir}
DIFF SCOPE: ${reviewPaths ? reviewPaths.join(", ") : "(entire repository)"}

ACCEPTANCE RESULTS:
${resultsText}

CODE CHANGES (git diff HEAD, untracked files included):
\`\`\`diff
${diff ? diff.slice(0, 24000) : "(no diff available)"}
\`\`\`

REVIEW CHECKLIST:
1. Does the code actually implement what the task description asks for?
2. Are there obvious bugs, edge cases, or error handling gaps?
3. Is the code quality acceptable (naming, structure, no dead code)?
4. Do the test/build results genuinely validate the changes?

RESPOND WITH EXACTLY ONE OF:
- APPROVE — if the implementation is correct and complete
- REJECT: [specific issues] — if there are problems that must be fixed

Be strict. If you're not confident it's correct, REJECT.`;

  // Create review session
  const reviewSession = await fetch(BACKEND + "/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "review: " + task.title.slice(0, 50) })
  }).then(r => r.json()).catch(() => null);

  if (!reviewSession || !reviewSession.id) return null;

  // Send review prompt (synchronous - wait for response)
  const response = await fetch(BACKEND + "/session/" + reviewSession.id + "/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [{ type: "text", text: prompt }] })
  }).then(r => r.json()).catch(() => null);

  if (!response || !response.parts) return null;

  // Parse verdict
  const texts = response.parts.filter(p => p.type === "text" && p.text).map(p => p.text);
  const fullText = texts.join("\n").trim();
  // The verdict may be preceded by review notes, so look for the marker on its
  // own line anywhere in the response instead of only at position 0.
  const approveMatch = fullText.match(/(?:^|\n)[ \t>*_`-]*APPROVE\b/i);
  const rejectMatch = fullText.match(/(?:^|\n)[ \t>*_`-]*REJECT\b:?\s*([\s\S]*)/i);
  const approved = !!approveMatch && !rejectMatch;

  // Cleanup review session
  await fetch(BACKEND + "/session/" + reviewSession.id, { method: "DELETE" }).catch(() => {});

  return {
    approved,
    reason: approved ? "approved by review agent" : (rejectMatch ? rejectMatch[1].trim() : fullText.slice(0, 300)),
    detail: approved ? "" : fullText.slice(0, 3000),
    sessionId: reviewSession.id
  };
}

async function getGitDiff(dir, scope) {
  const root = dir || ROOTS;
  const paths = (Array.isArray(scope) && scope.length) ? scope : null;
  const tracked = await new Promise((resolve) => {
    const args = ["-C", root, "diff", "HEAD"].concat(paths ? ["--"].concat(paths) : []);
    execFile("git", args, { timeout: 15000, maxBuffer: 16*1024*1024 }, (e, out) => {
      resolve(e ? "" : String(out || ""));
    });
  });
  const untracked = await new Promise((resolve) => {
    const args = ["-C", root, "ls-files", "--others", "--exclude-standard"].concat(paths ? ["--"].concat(paths) : []);
    execFile("git", args, { timeout: 10000, maxBuffer: 4*1024*1024 }, (e, out) => {
      resolve(e ? [] : String(out || "").split("\n").filter(Boolean));
    });
  });
  let extra = "";
  for (const rel of untracked.slice(0, 20)) {
    try {
      const full = path.join(root, rel);
      if (fs.statSync(full).size > 200 * 1024) continue;
      const txt = fs.readFileSync(full, "utf8");
      extra += "\ndiff --git a/" + rel + " b/" + rel + "\nnew file mode 100644\n--- /dev/null\n+++ b/" + rel + "\n" + indent(txt, "+") + "\n";
      if (extra.length > 20000) break;
    } catch (e) {}
  }
  let result = tracked + extra;
  if (!result.trim()) {
    // The deliverable may already be committed. Fall back to the recent commit
    // history for the reviewed paths so the reviewer still sees the actual code.
    result = await new Promise((resolve) => {
      const args = ["-C", root, "log", "-n", "3", "-p", "--format=commit %h %s"].concat(paths ? ["--"].concat(paths) : []);
      execFile("git", args, { timeout: 15000, maxBuffer: 16*1024*1024 }, (e, out) => {
        resolve(e ? "" : String(out || ""));
      });
    });
  }
  return result.slice(0, 24000);
}

module.exports = {
  getTodos, getMessages, getSessionStatus, sendFeedback,
  checkTodoConvergence, checkCleanTree, verifySelfReport, runGovernanceGates,
  detectOpencodeVersion, checkCompatibility, spawnReviewAgent, getGitDiff,
  resolveProjectDir, BACKEND
};
