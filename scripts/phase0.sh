#!/usr/bin/env bash
# Phase 0 foundation spike. Run this ON THE ARCH BOX before writing off two weeks.
# Each check prints PASS/FAIL. Run once, then AGAIN after a reboot for check 3.
set -u

pass() { printf '\033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$1"; }
note() { printf '\033[33mNOTE\033[0m %s\n' "$1"; }

echo "== JARVIS Phase 0 spike =="
echo

# 1. Base CLI auth present
if claude auth status >/dev/null 2>&1; then
  pass "claude CLI authenticated"
else
  fail "claude CLI not authenticated. Run: claude login"
fi

# 2. Long-lived token for headless use
note "Run 'claude setup-token' manually if you haven't. Then verify a fresh"
note "subprocess can call the model without the interactive session:"
if OUT=$(cd /tmp && claude -p "Reply with exactly: SPIKE_OK" --max-turns 1 2>&1) && echo "$OUT" | grep -q "SPIKE_OK"; then
  pass "headless -p call works from a fresh cwd"
else
  fail "headless call failed. Output: $(echo "$OUT" | head -2)"
fi

# 3. Connector auth portability (THE decision point)
note "Connector login (once, interactive):"
note '  cd ~/Projects/jarvis && claude mcp login "claude.ai Gmail" --no-browser'
note "Then this check, from a separate shell AND again after reboot:"
if cd ~/Projects/jarvis 2>/dev/null && claude mcp list 2>/dev/null | grep -qi "gmail.*connected"; then
  pass "Gmail connector authenticated in JARVIS scope"
else
  fail "Gmail connector not authenticated here. If this persists after login+reboot: pivot Phase 4 to own Google Cloud OAuth app."
fi

# 4. Headless permission behavior (shapes Phase 2)
note "Checking what headless mode does with a Bash-requiring prompt and no TTY:"
OUT=$(cd /tmp && timeout 60 claude -p "Run 'touch /tmp/jarvis-phase0-write-test' using bash" --max-turns 3 2>&1)
if [ -f /tmp/jarvis-phase0-write-test ]; then
  fail "headless mode EXECUTED a write with nobody approving. Phase 2 gate is mandatory, not optional."
  rm -f /tmp/jarvis-phase0-write-test
else
  pass "headless mode did not silently execute the write (denied or asked). Output tail: $(echo "$OUT" | tail -1)"
fi

# 5. Toolchain
command -v mise >/dev/null && pass "mise present" || fail "mise missing"
node -e 'require("node:sqlite")' 2>/dev/null && pass "node:sqlite available" || fail "node:sqlite missing (need Node >= 22.5)"

echo
echo "Verdict logic:"
echo " - Checks 1+2 pass          -> Phase 1 is green, build on subscription auth."
echo " - Check 3 fails post-reboot -> Phase 4 pivots to dedicated Google OAuth app."
echo " - Check 4 fails             -> do NOT run the daemon until permission-gate.ts is wired (it is, in this repo, but verify)."
