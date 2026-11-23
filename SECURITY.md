# Security

oc-pilot is designed for **trusted networks only** (e.g. a Tailscale tailnet or localhost).

It exposes, by design:

- file system read/write under `PILOT_FS_ROOT`
- git status
- a command runner used by the acceptance engine (`/acc/run`)
- a proxy to your local opencode servers

Anyone who can reach the HTTP port can therefore read/write files and run commands as your user.

## Hardening checklist

1. **Set `PILOT_TOKEN`.** Without it, every endpoint is unauthenticated.
2. **Keep the default bind `127.0.0.1`.** Only use `PILOT_HOST=0.0.0.0` behind a private network (Tailscale/WireGuard/VPN), never on a public interface.
3. Keep acceptance check commands (`cmd` in acceptance plans) to scripts you authored.
4. Prefer a dedicated low-privilege account when running on shared machines.

Report security issues by opening a GitHub security advisory rather than a public issue.
