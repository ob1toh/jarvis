import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { permissionGate } from "./permission-gate.js";
import {
  allFacts,
  getSessionId,
  setSessionId,
  logMessage,
  recordUsage,
  rememberFact,
} from "./memory.js";

/**
 * The single choke point between front-ends and the model. Every channel
 * (cli, http, telegram:<chatid>) gets its own resumable Agent SDK session,
 * persisted in SQLite so continuity survives daemon restarts.
 */

const SYSTEM_APPEND = `
You are JARVIS, a personal assistant daemon running on the user's Arch Linux machine.
Be direct and concise. You have tool access gated by a permission layer: read-only
operations run silently, anything destructive requires the user to explicitly approve
a confirmation, which may take a while. Never try to work around a denied permission.

To store a durable memory, emit a line in your reply of the exact form:
  JARVIS_REMEMBER key=<short-key> value=<the fact>
Use it whenever the user tells you something worth keeping ("remember that...", 
preferences, recurring context). The line is stripped before display.
`;

function factsPreamble(): string {
  const facts = allFacts();
  if (facts.length === 0) return "";
  const lines = facts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
  return `Durable memory (facts stored across sessions):\n${lines}\n\n`;
}

const REMEMBER_RE = /^JARVIS_REMEMBER\s+key=(\S+)\s+value=(.+)$/gm;

function extractMemories(text: string): string {
  let out = text;
  for (const m of text.matchAll(REMEMBER_RE)) {
    rememberFact(m[1], m[2].trim());
    out = out.replace(m[0], "").trim();
  }
  return out;
}

export interface ChatResult {
  text: string;
  sessionId: string;
  costUsd: number;
}

export async function chat(channel: string, userText: string): Promise<ChatResult> {
  logMessage(channel, "user", userText);

  const previousSession = getSessionId(channel);
  // Facts ride in with the prompt on fresh sessions; resumed sessions already
  // saw them and the model gets updates as they happen in-conversation.
  const prompt = previousSession ? userText : factsPreamble() + userText;

  const q = query({
    prompt,
    options: {
      cwd: config.projectDir,
      resume: previousSession,
      maxTurns: config.maxTurns,
      canUseTool: permissionGate,
      systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
      // "project" alone gets JARVIS's own .claude/settings.json (permission
      // deny rules) with zero bleed into the interactive Claude Code config.
      // "user" is required too: claude.ai cloud connectors (Gmail/Calendar)
      // are fetched based on user-scope state, and are invisible to the SDK
      // session without it, even though `claude mcp list` (which loads all
      // sources by default) shows them connected. Verified safe: global
      // ~/.claude/settings.json has no permission rules to inherit.
      settingSources: ["user", "project"],
    },
  });

  let sessionId = previousSession ?? "";
  let finalText = "";
  let costUsd = 0;

  for await (const message of q) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") finalText += block.text;
      }
    } else if (message.type === "result") {
      sessionId = message.session_id ?? sessionId;
      if ("total_cost_usd" in message && typeof message.total_cost_usd === "number") {
        costUsd = message.total_cost_usd;
      }
      const usage = "usage" in message ? (message.usage as { input_tokens?: number; output_tokens?: number } | undefined) : undefined;
      recordUsage(sessionId, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, costUsd);
    }
  }

  if (sessionId) setSessionId(channel, sessionId);
  const cleaned = extractMemories(finalText) || "(no reply)";
  logMessage(channel, "assistant", cleaned);
  return { text: cleaned, sessionId, costUsd };
}
