# Security Policy

## Threat Model

oc-pilot is a local-first tool designed to run on your own machine. It:

- Reads and writes files under your home directory (`/fs/*` endpoints)
- Executes shell commands (`/acc/run` endpoint, acceptance checks)
- Proxies requests to a local opencode server (`/api/*` endpoints)
- Stores task state in `tasks.json`

If someone gains access to the web interface, they effectively have code execution on your machine.

## Protections

### Default: loopback only + auto-generated token

- Binds to `127.0.0.1` by default
- If no `PILOT_TOKEN` is set, generates a random one-session token
- If you try to bind non-loopback without a token, the server **refuses to start**

### Cross-origin protection

- Validates `Host` header against expected loopback addresses
- Blocks requests with mismatched `Origin` headers (CSRF/DNS-rebinding)
- No wildcard CORS headers

### Filesystem scoping

- `/fs/*` endpoints restrict access to paths under `PILOT_FS_ROOT` (default: home directory)
- Path traversal attempts are rejected

### Command execution

- `/acc/run` executes commands from `tasks.json` acceptance rounds
- Acceptance scripts are user-defined at task creation; they are not sandboxed
- **Risk**: an agent with file-write access could modify `tasks.json` to change acceptance commands. This is a known limitation of the current design.

## Known Limitations

1. **Acceptance script integrity**: Commands in `tasks.json` can be modified by any process with file access. A future version should store acceptance scripts outside the agent's workspace or use checksums.

2. **Single token auth**: No rate limiting, no session management, no HTTPS. Adequate for loopback use, insufficient for public exposure.

3. **opencode proxy**: `/api/*` proxies to the local opencode server without additional validation beyond the token check.

4. **Upload path**: `/fs/upload` writes to any directory under the fs root without content inspection.

## Responsible Disclosure

If you find a security vulnerability, please open a GitHub issue with the `security` label, or contact the maintainer directly.

Do not publicly disclose vulnerabilities until a fix is released.
