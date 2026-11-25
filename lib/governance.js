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

module.exports = {
  getTodos, getMessages, getSessionStatus, sendFeedback,
  checkTodoConvergence, checkCleanTree, verifySelfReport, runGovernanceGates,
  detectOpencodeVersion, checkCompatibility,
  BACKEND
};
