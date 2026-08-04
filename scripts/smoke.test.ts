// Env BEFORE any project import (dynamic imports below avoid ESM hoisting).
process.env.JARVIS_DB = "/tmp/jarvis-test.db";
process.env.JARVIS_KILLSWITCH = "/tmp/jarvis-ks-test";

const fs = await import("node:fs");
const m = await import("../src/core/memory.js");
const g = await import("../src/core/permission-gate.js");

m.initMemory();
m.rememberFact("owner", "Tre, Arch+Hyprland");
m.logMessage("cli", "user", "remember my setup");
m.setSessionId("cli", "abc-123");
m.recordUsage("abc-123", 100, 50, 0.003);
console.log("facts:", m.allFacts().length, "| session:", m.getSessionId("cli"), "| usage:", JSON.stringify(m.usageSummary(24)));

const asStr = (r: any) => r.behavior + (r.message ? ` (${r.message.slice(0, 45)}...)` : "");
g.onConfirmationRequested((c) => g.resolveConfirmation(c.id, false)); // auto-deny pending confirms in test

console.log("Read            ->", asStr(await g.permissionGate("Read", { file_path: "/etc/hostname" }, {} as any)));
console.log("Bash git status ->", asStr(await g.permissionGate("Bash", { command: "git status" }, {} as any)));
console.log("Bash git push   ->", asStr(await g.permissionGate("Bash", { command: "git push origin main" }, {} as any)));
console.log("Bash ls | wc    ->", asStr(await g.permissionGate("Bash", { command: "ls | wc -l" }, {} as any)));
console.log("Write           ->", asStr(await g.permissionGate("Write", { file_path: "/tmp/x" }, {} as any)));

fs.writeFileSync("/tmp/jarvis-ks-test", "");
console.log("KILLSWITCH Read ->", asStr(await g.permissionGate("Read", { file_path: "/etc/hostname" }, {} as any)));
fs.unlinkSync("/tmp/jarvis-ks-test");
console.log("ks removed Read ->", asStr(await g.permissionGate("Read", { file_path: "/etc/hostname" }, {} as any)));
