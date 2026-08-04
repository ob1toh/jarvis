import https from "node:https";
import { config } from "../config.js";
import { chat } from "../core/claude-driver.js";
import { onConfirmationRequested, resolveConfirmation } from "../core/permission-gate.js";
import { clearSession, usageSummary } from "../core/memory.js";

/**
 * Telegram front-end. Zero dependencies: long polling straight against the
 * Bot API. Lights up only if TELEGRAM_BOT_TOKEN is set, and only talks to
 * user IDs in TELEGRAM_ALLOWED_USERS. Everyone else gets silence, because a
 * personal assistant with shell access answering strangers is how you end
 * up in a "my homelab got owned" blog post.
 *
 * Destructive-action confirmations arrive as inline keyboard buttons, so you
 * can approve "send that email" from your phone.
 */

const API = () => `https://api.telegram.org/bot${config.telegramToken}`;

async function tg(method: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

/**
 * getUpdates specifically: long-polls (holds a connection open up to
 * `timeout` seconds waiting for a new message). Node's global fetch()/undici
 * pool serializes/queues quick calls (sendMessage etc.) behind that open
 * connection when they share a host, so a fast reply from tg() can end up
 * stuck until the long-poll resolves. node:https uses a completely separate
 * client/pool from fetch(), so this can never block sendMessage again.
 */
function getUpdatesLongPoll(payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${config.telegramToken}/getUpdates`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function send(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<any> {
  // Telegram hard-caps messages at 4096 chars.
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? ["(empty)"];
  return chunks.reduce<Promise<any>>(
    (p, chunk, i) => p.then(() => tg("sendMessage", { chat_id: chatId, text: chunk, ...(i === chunks.length - 1 ? extra : {}) })),
    Promise.resolve()
  );
}

/** chat ids that have talked to us; confirmations broadcast here. */
const activeChats = new Set<number>();

export function startTelegram(): void {
  if (!config.telegramToken) {
    console.log("[jarvis] telegram: no token, front-end disabled");
    return;
  }
  if (config.telegramAllowedUsers.length === 0) {
    console.warn("[jarvis] telegram: token set but TELEGRAM_ALLOWED_USERS empty. Refusing to start an open bot.");
    return;
  }

  onConfirmationRequested((c) => {
    const preview = JSON.stringify(c.input).slice(0, 500);
    for (const chatId of activeChats) {
      void send(chatId, `⚠️ JARVIS wants to run: ${c.toolName}\n${preview}`, {
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `ok:${c.id}` },
            { text: "❌ Deny", callback_data: `no:${c.id}` },
          ]],
        },
      });
    }
  });

  void pollLoop();
  console.log("[jarvis] telegram: polling started");
}

async function pollLoop(): Promise<void> {
  let offset = 0;
  for (;;) {
    try {
      const data = await getUpdatesLongPoll({ offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
      for (const update of data.result ?? []) {
        offset = update.update_id + 1;
        void handleUpdate(update);
      }
    } catch (err) {
      console.error("[jarvis] telegram poll error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function handleUpdate(update: any): Promise<void> {
  if (update.callback_query) {
    const cq = update.callback_query;
    if (!config.telegramAllowedUsers.includes(cq.from?.id)) return;
    const [verdict, id] = String(cq.data ?? "").split(":");
    const ok = resolveConfirmation(id, verdict === "ok");
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: ok ? (verdict === "ok" ? "Approved" : "Denied") : "Expired" });
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;
  const userId: number = msg.from?.id;
  const chatId: number = msg.chat?.id;
  if (!config.telegramAllowedUsers.includes(userId)) return; // silence for strangers

  activeChats.add(chatId);
  const channel = `telegram:${chatId}`;
  const text: string = msg.text.trim();
  const startedAt = Date.now();
  console.log(
    `[jarvis] telegram: RX update=${update.update_id} at=${new Date(startedAt).toISOString()} from=${userId}: ${JSON.stringify(text).slice(0, 120)}`
  );

  if (text === "/reset") {
    clearSession(channel);
    await send(chatId, "Session reset. Fresh brain, same memories.");
    return console.log(`[jarvis] telegram: TX update=${update.update_id} (/reset) after ${Date.now() - startedAt}ms`);
  }
  if (text === "/usage") {
    const u = usageSummary(24);
    await send(chatId, `Last 24h: ${u.requests} requests, ${u.input_tokens} in / ${u.output_tokens} out tokens, $${u.cost_usd.toFixed(4)} equiv.`);
    return console.log(`[jarvis] telegram: TX update=${update.update_id} (/usage) after ${Date.now() - startedAt}ms`);
  }
  if (text === "/start") {
    await send(chatId, "JARVIS online. Talk to me. /reset for a new session, /usage for token burn.");
    return console.log(`[jarvis] telegram: TX update=${update.update_id} (/start) after ${Date.now() - startedAt}ms`);
  }

  // Telegram's "typing" indicator expires after ~5s; refresh it for the
  // full duration of a slow tool-using turn so the chat doesn't look stalled.
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  const typingInterval = setInterval(() => {
    void tg("sendChatAction", { chat_id: chatId, action: "typing" });
  }, 4000);

  try {
    const result = await chat(channel, text);
    clearInterval(typingInterval);
    console.log(`[jarvis] telegram: TX update=${update.update_id} after ${Date.now() - startedAt}ms`);
    await send(chatId, result.text);
  } catch (err) {
    clearInterval(typingInterval);
    console.log(`[jarvis] telegram: TX(error) update=${update.update_id} after ${Date.now() - startedAt}ms`);
    await send(chatId, `Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
