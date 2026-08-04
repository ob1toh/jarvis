import os from "node:os";
import path from "node:path";

/**
 * All knobs live here. Everything is env-overridable so the systemd unit
 * can configure without code changes.
 */
export const config = {
  /** Where JARVIS lives and scopes its .claude settings. */
  projectDir: process.env.JARVIS_HOME ?? path.join(os.homedir(), "Projects", "jarvis"),

  /** Local HTTP API. Loopback only by default. Do not expose this. */
  host: process.env.JARVIS_HOST ?? "127.0.0.1",
  port: Number(process.env.JARVIS_PORT ?? 8377),

  /** SQLite path for memory + usage accounting. */
  dbPath: process.env.JARVIS_DB ?? path.join(os.homedir(), ".local", "share", "jarvis", "jarvis.db"),

  /**
   * Auth strategy. "subscription" = inherited Claude Code OAuth (Phase 0
   * spike must pass first). "api-key" = ANTHROPIC_API_KEY in env.
   * The driver doesn't branch on this much: the SDK picks up whichever
   * is present. This flag exists so the health endpoint can report it
   * and so a future swap is a one-line .env change.
   */
  authMode: (process.env.JARVIS_AUTH ?? "subscription") as "subscription" | "api-key",

  /** Telegram front-end. Off unless a token is present. */
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  /** Comma-separated Telegram user IDs allowed to talk to JARVIS. Empty = deny all. */
  telegramAllowedUsers: (process.env.TELEGRAM_ALLOWED_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),

  /** Seconds a pending destructive-action confirmation stays alive before auto-deny. */
  confirmTimeoutSec: Number(process.env.JARVIS_CONFIRM_TIMEOUT ?? 120),

  /** Hard cap per request so a runaway agent can't burn the subscription window. */
  maxTurns: Number(process.env.JARVIS_MAX_TURNS ?? 25),

  /**
   * Kill switch file. If this exists, the permission gate denies ALL tool
   * execution regardless of allowlist. `touch ~/.jarvis-killswitch` from any
   * shell and JARVIS goes read-only-brain, no hands.
   */
  killSwitchPath: process.env.JARVIS_KILLSWITCH ?? path.join(os.homedir(), ".jarvis-killswitch"),
};
