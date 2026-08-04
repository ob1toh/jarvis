# jarvis-core

Personal AI assistant daemon on the Claude Agent SDK. Chat over CLI, local HTTP, or Telegram; tool execution gated by a confirm-before-destructive permission layer; durable memory in SQLite. Built for an Arch + Hyprland box where `claude` (Claude Code, Pro) is already logged in.

## Status vs the build plan

| Phase | State |
|---|---|
| 0 Foundation spike | `scripts/phase0.sh` — **run this first, on the box, twice (pre and post reboot)** |
| 1 Chat core | Done: driver, sessions, HTTP endpoint, CLI |
| 2 Permission layer | Done: allowlist + confirmation round trip + kill switch |
| 3 Smart home | Stub: `mcp/jarvis-mcp-config.json` awaits device scoping |
| 4 Gmail/Calendar | Gated on Phase 0 check 3 verdict |
| 5 Voice | Not started; plugs into `POST /chat` |
| 6 Hardening | Unit file ready: `systemd/jarvis-core.service` |
| extra: Memory | Done (not in the original plan, restored from the Python bot): facts, history, usage accounting |
| extra: Telegram | Done, optional, allowlisted users only |

## Setup

```bash
# 1. Drop this directory at ~/Projects/jarvis, then:
cd ~/Projects/jarvis
mise use node@26   # or whatever pin you're on; needs >= 22.5 for node:sqlite
npm install
cp .env.example .env   # edit

# 2. Phase 0. Not optional.
bash scripts/phase0.sh
# ... reboot ...
bash scripts/phase0.sh   # connector check must survive this

# 3. Smoke test (no API calls, tests memory + permission gate)
npx tsx scripts/smoke.test.ts

# 4. Talk to it
npm run cli        # local REPL
npm run dev        # daemon: HTTP on 127.0.0.1:8377 + Telegram if configured
```

## Architecture

```
frontends (cli / http / telegram, later voice)
        │  channel-tagged text
        ▼
core/claude-driver.ts ── query() ──> Claude Agent SDK ──> claude (Pro OAuth or API key)
        │                                   │
        │ session ids, facts, usage         │ canUseTool on every non-pre-approved call
        ▼                                   ▼
core/memory.ts (SQLite)          core/permission-gate.ts
                                    ├─ read-only: silent allow
                                    ├─ safe bash (no pipes, safe git subcmds): allow
                                    ├─ kill switch file: deny everything
                                    └─ else: park + push to front-ends, human taps ✅/❌
```

Every channel gets its own resumable Agent SDK session persisted in SQLite, so conversation continuity survives daemon restarts. Durable *knowledge* is separate: the model emits `JARVIS_REMEMBER key=... value=...` lines (stripped before display) that land in the facts table and ride into every fresh session.

## Safety model

Defense in depth, three layers that fail independently:

1. `.claude/settings.json` deny rules (rm -rf, sudo, dd, ssh keys, .env reads) — enforced by the harness before the gate even sees the call.
2. `permission-gate.ts` — anything not provably read-only waits for explicit human approval, timing out to deny.
3. Kill switch: `touch ~/.jarvis-killswitch` from any shell hard-disables ALL tool execution instantly, independent of the daemon's own state. `rm` it to restore.

The Telegram bot refuses to start with an empty user allowlist, and non-allowlisted senders get silence, not an error.

## HTTP API

`POST /chat {text, channel}` · `GET /health` · `GET /confirmations` · `POST /confirm {id, approved}` · `GET /memory/facts` · `GET /memory/search?q=` · `POST /session/reset {channel}`

## Known sharp edges

- **Subscription auth is a grey zone.** Watch `/usage` (or `GET /health`). The moment JARVIS contends with your actual Claude Code sessions, flip `.env` to an API key. One line.
- **Connector reuse will probably fail the reboot check.** The Phase 4 pivot (own Google Cloud OAuth app) means test-mode refresh tokens expiring every 7 days until you publish the app. Budget for that annoyance.
- **The safe-bash allowlist is first-token matching with a composition blacklist.** It's conservative by design; expect to approve things that feel safe. Loosen it in `permission-gate.ts`, not by disabling the gate.
- `node:sqlite` prints an experimental warning on some Node versions. Cosmetic.
