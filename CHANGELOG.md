# Changelog

## v2.0.0 (upcoming)

### Security
- Non-loopback binding without `PILOT_TOKEN` now refuses to start (was: warning only)
- Auto-generates session token for loopback if not set
- Cross-origin request blocking (Host/Origin validation, CSRF/DNS-rebinding)
- Removed wildcard CORS headers
- Added [SECURITY.md](SECURITY.md) with threat model

### Documentation
- English README as primary, Chinese moved to README.zh-CN.md
- Repositioned as "evidence-based acceptance for opencode"
- Added compatibility matrix and known limitations
- Declared community project, not affiliated with opencode
- Removed marketing language ("7×24", "never gives up")

### Infrastructure
- CHANGELOG.md extracted from README
- npm package support (`npx oc-pilot`)
- Demo mode without opencode backend (`PILOT_DEMO=1`)
- GitHub Actions CI: 10 E2E tests, Windows runner, headless Edge

### Cross-platform
- Acceptance engine shell: `powershell` (Windows) / `/bin/bash` (Linux/macOS)
- Process detection still Windows-only (Linux/macOS: manual backend config)

## v1.3.x (2026-11-25)

- Tailscale Funnel public access + HTTPS
- Quota limit detection from opencode logs (provider/model/reset-time)
- HarmonyOS app (ArkTS WebView shell, Pura X)
- Android WebView app
- Acceptance pipeline visualization (stepper, history, human review console)
- Multi-agent: non-destructive branch spawning, merge coordinator agent
- Wake/resume system for sleep-interrupted agents
- Theme system: VSCode Dark+ / Black / Orange

## v1.0.0 (2026-11-22)

- Theme system, adjustable poll speed, wake/resume, semantic color vars

## v0.9.x (2026-11-21)

- Model/Agent switching, orchestrator merge, question cards, agent lifecycle, stability

## v0.7 (2026-11-20)

- Initial GitHub release: kanban, multi-agent, file transfer, Android app
