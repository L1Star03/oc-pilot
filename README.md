# oc-pilot

**Evidence-based acceptance for [opencode](https://opencode.ai).**

Turn opencode sessions into gated tasks. Build → verify → ship, with proof.

> ⚠️ Community project, not affiliated with opencode. Tested against opencode 1.19.5 only.

## What it does

Most AI coding tools let the agent declare "done". oc-pilot makes completion verifiable:

```
┌─────────────────────────────────────────────────────────┐
│  Task: "Add dark mode"                                   │
│                                                          │
│  ▶ EXEC    agent works, board shows live tool output    │
│  ◎ REVIEW  acceptance checks run automatically          │
│            ├─ build  ✓ (3s)                             │
│            ├─ tests  ✓ (12 passed)                      │
│            └─ lint   ✗ 2 warnings                       │
│               → sent back with output as evidence       │
│  ✓ DONE    only when all checks pass                    │
└─────────────────────────────────────────────────────────┘
```

When a check fails, the agent gets the exact output as feedback and tries again. When all checks pass, the task moves to human review. No silent failures, no "I think it's done."

## Key features

- **Acceptance as code**: Define build/test/lint checks per task. Failures are sent back with output as evidence.
- **Kanban board**: Todo → Plan → Exec → Review → Done, with live status and tool output streaming.
- **Multi-agent**: Spawn parallel workers for independent subtasks. Merge coordinator integrates results.
- **Mobile app**: Native Android (WebView shell) + HarmonyOS (Pura X). Access via Tailscale or LAN.
- **File transfer**: Browse, download, upload files on the PC from your phone.
- **Zombie recovery**: Detects and revives stuck agents (sleep/wake, hung tools).

## Quick start

### Option A: with opencode running

```bash
# 1. Start opencode
opencode web --port 4096

# 2. Clone and run
git clone https://github.com/L1Star03/oc-pilot
cd oc-pilot
PILOT_TOKEN=your-secret npm start

# 3. Open browser
# http://localhost:4097
```

### Option B: demo mode (no opencode required)

```bash
PILOT_DEMO=1 npm start
# Opens with sample tasks and acceptance checks
# Full UI, no backend needed
```

## How acceptance works

Define checks when creating a task:

```json
{
  "rounds": [
    { "name": "Build", "cmd": "npm run build", "intervalMin": 2, "maxRetry": 3 },
    { "name": "Tests", "cmd": "npm test", "intervalMin": 3, "maxRetry": 3 },
    { "name": "Lint", "cmd": "npm run lint", "intervalMin": 3, "maxRetry": 2 },
    { "name": "Human review", "mode": "human" }
  ]
}
```

When the agent finishes a turn:
1. Each check runs automatically
2. Pass → advance to next round
3. Fail → agent receives the output as feedback, retries after backoff
4. All pass → task moves to human review

## Architecture

```
Phone/PC Browser ──┐
                   ├──► oc-pilot (:4097, Node.js)
Terminal (attach) ─┘         ├── /tasks     task state
                             ├── /acc/run   acceptance checks
                             ├── /fs/*      file transfer
                             └── /api/*     → opencode proxy (:4096)
```

- **Zero dependencies**: Node.js only, no npm install for core
- **Single file frontend**: `public/index.html`, no build step
- **Server-side acceptance engine**: checks run even when browser is closed

## Compatibility

| oc-pilot | opencode | Status |
|----------|----------|--------|
| 1.x      | 1.19.5   | Tested |
| 1.x      | other    | Untested (may break) |

oc-pilot uses undocumented opencode APIs (reverse-engineered `QuestionV2` protocol, `prompt_async`, session management). Upgrades to opencode may break compatibility.

## Security

See [SECURITY.md](SECURITY.md) for the full threat model.

Key points:
- Default: loopback-only + auto-generated session token
- Non-loopback binding requires explicit `PILOT_TOKEN`
- Cross-origin request blocking (CSRF/DNS-rebinding)
- Filesystem access scoped to home directory

## Known limitations

- **Single user**: No multi-user auth, no HTTPS
- **Windows-first**: Process detection is Windows-only (macOS/Linux use manual port config)
- **Acceptance scripts are user-defined shell commands**: Not sandboxed. An agent with file access could theoretically modify the acceptance config.
- **opencode coupling**: Tightly coupled to opencode 1.19.5 internals. No adapter layer yet.
- **No git worktree isolation**: Parallel tasks on the same directory can conflict.

## Alternatives

If you need something different:
- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) — mature, multi-backend, Rust
- [Cline Kanban](https://github.com/cline/kanban) — git worktree isolation, Cline team
- [Worktree Kanban](https://github.com/kazuya83/worktree-kanban) — cross-platform, multi-agent

What oc-pilot does differently: **acceptance checks with evidence-based retry loops as a first-class mechanism**, not just a board.

## License

MIT

## 中文文档

[README.zh-CN.md](README.zh-CN.md)
