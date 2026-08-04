import readline from "node:readline/promises";
import { initMemory, clearSession, usageSummary } from "./core/memory.js";
import { chat } from "./core/claude-driver.js";
import { onConfirmationRequested, resolveConfirmation } from "./core/permission-gate.js";

/**
 * Bare stdin/stdout chat loop for local testing. Run with:  npm run cli
 * This is deliberately dumb; the daemon (index.ts) is the real entry point.
 */

async function main(): Promise<void> {
  initMemory();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  onConfirmationRequested((c) => {
    // Reuse the same readline; answer approves/denies the parked tool call.
    void rl
      .question(`\n⚠️  JARVIS wants to run ${c.toolName}: ${JSON.stringify(c.input).slice(0, 300)}\nApprove? [y/N] `)
      .then((answer) => resolveConfirmation(c.id, answer.trim().toLowerCase() === "y"));
  });

  console.log("JARVIS CLI. /reset new session, /usage token burn, /quit to exit.\n");

  for (;;) {
    const line = (await rl.question("you> ")).trim();
    if (!line) continue;
    if (line === "/quit") break;
    if (line === "/reset") {
      clearSession("cli");
      console.log("session reset.");
      continue;
    }
    if (line === "/usage") {
      const u = usageSummary(24);
      console.log(`24h: ${u.requests} req, ${u.input_tokens} in / ${u.output_tokens} out, $${u.cost_usd.toFixed(4)}`);
      continue;
    }
    try {
      const result = await chat("cli", line);
      console.log(`\njarvis> ${result.text}\n`);
    } catch (err) {
      console.error("error:", err instanceof Error ? err.message : err);
    }
  }
  rl.close();
}

void main();
