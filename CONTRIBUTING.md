# Contributing

Thanks for your interest!

## Development

```bash
git clone https://github.com/L1Star03/oc-pilot.git
cd oc-pilot
# node >= 18, no dependencies to install
PILOT_TOKEN=devtoken node server.js     # http://127.0.0.1:4097
```

- Frontend: single file `public/index.html` (no build step).
- Server: `server.js` (static + proxy + tasks + fs + git + acceptance engine).
- Demo data for screenshots: `demo/tasks.json`, `npm run demo:win` (Windows) / `npm run demo`.

## Ground rules

- Keep the frontend build-free (single HTML file).
- Do not introduce runtime dependencies without discussion.
- Never commit personal data: `tasks.json` is gitignored; use `demo/tasks.json` for fixtures.
- Test on a real board before opening a PR: board rendering, task flow (drag + buttons), acceptance engine round, detail tabs.

## Compat

Targets opencode V1 API (verified 1.19.5). Internal endpoints used: `/session*`, `/session/:id/prompt_async`, `/session/:id/permissions/:id`, `/question*`, `/config/providers`, `/provider`, `/agent`. If opencode changes these, adapt with graceful degradation.
