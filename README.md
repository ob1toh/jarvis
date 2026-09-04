# Jarvis

[![CI](https://github.com/ob1toh/jarvis/actions/workflows/ci.yml/badge.svg)](https://github.com/ob1toh/jarvis/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

A local-first personal AI assistant for Linux with durable memory and a safety
gate between the model and your machine.

Talk to Jarvis from a terminal, local HTTP client, or Telegram. Conversations
survive restarts, useful facts persist in SQLite, and any tool action that is
not provably read-only waits for explicit approval.

> **Project status:** early and usable, but not yet a polished consumer app.
> Interfaces may change before 1.0. Start with the CLI and keep the permission
> gate enabled.

## Why Jarvis?

- **Local-first:** the daemon and memory database run on your machine.
- **Durable memory:** sessions, facts, message history, and usage survive restarts.
- **Human approval:** destructive or ambiguous tool calls pause for confirmation.
- **Multiple front ends:** CLI, local HTTP, and an allowlisted Telegram bot.
- **Emergency stop:** a kill-switch file immediately blocks all tool execution.

## Requirements

- Linux (developed on Arch Linux + Hyprland)
- Node.js 22.5 or newer
- npm
- Claude Code authentication or an Anthropic API key

## Quick start

```bash
git clone https://github.com/ob1toh/jarvis.git
cd jarvis
npm ci
cp .env.example .env
npm test
npm run cli
```

The default configuration uses an existing Claude Code login. To use an API
key instead, set `JARVIS_AUTH=api-key` and `ANTHROPIC_API_KEY` in `.env`.

Before running Jarvis as a persistent daemon, run the environment check:

```bash
bash scripts/phase0.sh
```

Run it again after a reboot before relying on inherited subscription
authentication or external connectors.

## Run modes

```bash
npm run cli   # interactive terminal chat
npm run dev   # HTTP daemon on 127.0.0.1:8377; Telegram when configured
npm run check # type-check, safety smoke test, and production build
```

Telegram remains disabled unless both `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_ALLOWED_USERS` are configured. Messages from users outside the
allowlist receive no response.

## How it works

```text
CLI / HTTP / Telegram
        │
        ▼
Claude Agent SDK ────────────────┐
        │                        │
        ▼                        ▼
SQLite memory             permission gate
sessions · facts          read-only → allow
history · usage           uncertain → confirm
                          kill switch → deny
```

Each channel has its own resumable Agent SDK session. Durable knowledge is
stored separately: memory instructions emitted by the model are stripped from
the visible reply, stored as facts, and provided to future sessions.

## Safety model

Jarvis uses independent layers rather than trusting the model to police itself:

1. Claude tool deny rules block known-dangerous patterns and sensitive files.
2. The permission gate silently allows narrow read-only operations and asks for
   approval for everything else.
3. Creating `~/.jarvis-killswitch` immediately denies every tool call.

```bash
touch ~/.jarvis-killswitch # stop all tool execution
rm ~/.jarvis-killswitch    # restore normal permission checks
```

The shell classifier is intentionally conservative. Do not disable the gate to
avoid approval prompts; improve the allowlist and add tests instead.

## HTTP API

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/chat` | Send `{text, channel}` |
| `GET` | `/health` | Health and usage information |
| `GET` | `/confirmations` | List pending tool confirmations |
| `POST` | `/confirm` | Submit `{id, approved}` |
| `GET` | `/memory/facts` | Inspect durable facts |
| `GET` | `/memory/search?q=` | Search memory |
| `POST` | `/session/reset` | Reset `{channel}` |

## Roadmap

- [x] CLI, HTTP, and Telegram conversations
- [x] Durable SQLite memory and resumable sessions
- [x] Permission gate and emergency kill switch
- [x] Systemd service definition
- [ ] Scoped smart-home tools
- [ ] Google Calendar and Gmail integrations
- [ ] Voice interface
- [ ] Packaged installation and first stable release

## Known limitations

- Reusing subscription authentication may contend with active Claude Code
  sessions. An API key is the predictable alternative.
- OAuth test-mode refresh tokens for future Google integrations may expire
  every seven days.
- Some Node versions display an experimental warning for `node:sqlite`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report
security issues privately as described in [SECURITY.md](SECURITY.md).
