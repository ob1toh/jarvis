import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Memory layer. This is what the Agent SDK's session continuity is NOT:
 * durable knowledge across sessions, restarts and reboots.
 *
 * Three concerns, one file:
 *  - facts:    key/value things JARVIS should know long-term ("remember that...")
 *  - messages: append-only conversation log (searchable history)
 *  - sessions: maps front-end channels -> last Agent SDK session id (resume)
 *  - usage:    per-request token/cost accounting (subscription contention watch)
 */

export interface Fact {
  key: string;
  value: string;
  updated_at: string;
}

export interface UsageRow {
  ts: string;
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

let db: DatabaseSync;

export function initMemory(): void {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS facts (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      channel TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      channel TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      session_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
  `);
}

// ---- facts -----------------------------------------------------------------

export function rememberFact(key: string, value: string): void {
  db.prepare(
    `INSERT INTO facts (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}

export function forgetFact(key: string): boolean {
  const res = db.prepare(`DELETE FROM facts WHERE key = ?`).run(key);
  return res.changes > 0;
}

export function allFacts(): Fact[] {
  return db.prepare(`SELECT key, value, updated_at FROM facts ORDER BY key`).all() as unknown as Fact[];
}

export function searchFacts(term: string): Fact[] {
  return db
    .prepare(`SELECT key, value, updated_at FROM facts WHERE key LIKE ? OR value LIKE ?`)
    .all(`%${term}%`, `%${term}%`) as unknown as Fact[];
}

// ---- conversation log ------------------------------------------------------

export function logMessage(channel: string, role: "user" | "assistant", content: string): void {
  db.prepare(`INSERT INTO messages (channel, role, content) VALUES (?, ?, ?)`).run(channel, role, content);
}

export function searchMessages(term: string, limit = 20): Array<{ ts: string; channel: string; role: string; content: string }> {
  return db
    .prepare(`SELECT ts, channel, role, content FROM messages WHERE content LIKE ? ORDER BY id DESC LIMIT ?`)
    .all(`%${term}%`, limit) as unknown as Array<{ ts: string; channel: string; role: string; content: string }>;
}

// ---- session continuity ----------------------------------------------------

export function getSessionId(channel: string): string | undefined {
  const row = db.prepare(`SELECT session_id FROM sessions WHERE channel = ?`).get(channel) as
    | { session_id: string }
    | undefined;
  return row?.session_id;
}

export function setSessionId(channel: string, sessionId: string): void {
  db.prepare(
    `INSERT INTO sessions (channel, session_id, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(channel) DO UPDATE SET session_id = excluded.session_id, updated_at = datetime('now')`
  ).run(channel, sessionId);
}

export function clearSession(channel: string): void {
  db.prepare(`DELETE FROM sessions WHERE channel = ?`).run(channel);
}

// ---- usage accounting ------------------------------------------------------

export function recordUsage(sessionId: string, inputTokens: number, outputTokens: number, costUsd: number): void {
  db.prepare(`INSERT INTO usage (session_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?)`).run(
    sessionId,
    inputTokens,
    outputTokens,
    costUsd
  );
}

export function usageSummary(hours = 24): { requests: number; input_tokens: number; output_tokens: number; cost_usd: number } {
  return db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM usage WHERE ts >= datetime('now', ?)`
    )
    .get(`-${hours} hours`) as unknown as { requests: number; input_tokens: number; output_tokens: number; cost_usd: number };
}
