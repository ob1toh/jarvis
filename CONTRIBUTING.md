# Contributing to Jarvis

Thanks for helping improve Jarvis. Focused bug fixes, safety improvements,
documentation, tests, and small integrations are welcome.

## Development setup

```bash
git clone https://github.com/ob1toh/jarvis.git
cd jarvis
npm ci
npm run check
```

Node.js 22.5 or newer is required.

## Before opening a pull request

- Keep the change focused and explain the user-facing reason for it.
- Add or update a test when behavior changes.
- Run `npm run check` locally.
- Never commit API keys, Telegram tokens, personal data, or `.env` files.
- Treat changes to permissions and command execution as security-sensitive.

For larger features, open an issue first so the design can be discussed before
substantial work begins.
