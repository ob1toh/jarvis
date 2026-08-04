import { initMemory } from "./core/memory.js";
import { startServer } from "./server.js";
import { startTelegram } from "./frontends/telegram.js";
import { config } from "./config.js";
import { killSwitchActive } from "./core/permission-gate.js";

/**
 * jarvis-core daemon. This is what the systemd unit runs.
 */

function main(): void {
  initMemory();

  console.log(`[jarvis] starting. auth=${config.authMode} project=${config.projectDir}`);
  if (killSwitchActive()) {
    console.warn(`[jarvis] KILL SWITCH ACTIVE at ${config.killSwitchPath}. Tool execution disabled until removed.`);
  }

  const server = startServer();
  startTelegram();

  const shutdown = (signal: string) => {
    console.log(`[jarvis] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
