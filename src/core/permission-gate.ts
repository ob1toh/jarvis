import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";

/**
 * Phase 2 safety layer. Headless mode means no interactive permission prompt,
 * so this file IS the prompt. Three tiers:
 *
 *  1. Kill switch file exists      -> deny everything, no exceptions.
 *  2. Provably read-only tool call -> allow silently.
 *  3. Anything else                -> park it as a pending confirmation and
 *     wait for a human to approve/deny through whatever front-end is attached
 *     (HTTP endpoint, Telegram inline button, CLI y/n). Timeout = deny.
 */

// Tools that never touch the world.
const READONLY_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite", "Task", "NotebookRead"]);

// Bash commands that are safe to run without asking. Matched against the
// first token only, deliberately conservative. Pipes/&&/; disqualify.
const SAFE_BASH = new Set([
  "ls", "cat", "head", "tail", "wc", "pwd", "whoami", "date", "uptime",
  "df", "du", "free", "uname", "hostname", "ps", "ip", "which", "file", "stat",
  "git", // narrowed further below: only read-only git subcommands
]);
const SAFE_GIT_SUB = new Set(["status", "log", "diff", "show", "branch", "remote", "config"]);

function isSafeBash(command: string): boolean {
  // Any shell composition or redirection means we can't reason about it. Ask.
  if (/[|;&><`$()]/.test(command)) return false;
  const parts = command.trim().split(/\s+/);
  const head = parts[0];
  if (!head || !SAFE_BASH.has(head)) return false;
  if (head === "git") {
    const sub = parts[1];
    if (!sub || !SAFE_GIT_SUB.has(sub)) return false;
  }
  return true;
}

export interface PendingConfirmation {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  createdAt: number;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingConfirmation>();

/** Front-ends subscribe here to surface confirmations to the human. */
type ConfirmListener = (c: PendingConfirmation) => void;
const listeners: ConfirmListener[] = [];
export function onConfirmationRequested(fn: ConfirmListener): void {
  listeners.push(fn);
}

export function listPending(): Array<Omit<PendingConfirmation, "resolve" | "timer">> {
  return [...pending.values()].map(({ resolve: _r, timer: _t, ...rest }) => rest);
}

/** Called by front-ends when the human decides. Returns false if id unknown/expired. */
export function resolveConfirmation(id: string, approved: boolean): boolean {
  const c = pending.get(id);
  if (!c) return false;
  pending.delete(id);
  clearTimeout(c.timer);
  c.resolve(approved);
  return true;
}

function requestConfirmation(toolName: string, input: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      if (pending.delete(id)) resolve(false); // timeout -> deny
    }, config.confirmTimeoutSec * 1000);
    const c: PendingConfirmation = { id, toolName, input, createdAt: Date.now(), resolve, timer };
    pending.set(c.id, c);
    for (const fn of listeners) fn(c);
  });
}

export function killSwitchActive(): boolean {
  return fs.existsSync(config.killSwitchPath);
}

/** The canUseTool callback wired into the Agent SDK query. */
export const permissionGate: CanUseTool = async (toolName, input) => {
  if (killSwitchActive()) {
    return deny(`Kill switch active (${config.killSwitchPath}). All tool execution disabled.`);
  }

  if (READONLY_TOOLS.has(toolName)) {
    return allow();
  }

  if (toolName === "Bash" && typeof input.command === "string" && isSafeBash(input.command)) {
    return allow();
  }

  // Everything else: writes, unrecognised bash, MCP tools (email send,
  // calendar create, future smart-home actuation) -> human in the loop.
  const approved = await requestConfirmation(toolName, input);
  return approved ? allow() : deny("Denied by user (or confirmation timed out).");
};

function allow(): PermissionResult {
  return { behavior: "allow" };
}
function deny(message: string): PermissionResult {
  return { behavior: "deny", message };
}
