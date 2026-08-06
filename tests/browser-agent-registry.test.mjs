import assert from "node:assert/strict";
import test from "node:test";
import { AgentRegistry } from "../src/main/services/browser/AgentRegistry.ts";
import { BROWSER_SCREENSHOT_MAX_BINARY_BYTES } from "../src/main/services/browser/BrowserAutomationService.ts";

const actor = {
  kind: "agent",
  agentId: "agent-1",
  provider: "codex",
  terminalSessionId: "terminal-1",
  connectionId: "connection-1",
  cwd: "/tmp/project"
};

test("AgentRegistry follows tab/cursor heartbeats and expires presence at 15 seconds", () => {
  let now = 1_000;
  const registry = new AgentRegistry(() => now);
  assert.equal(registry.touch(actor, "tab-1", { x: 320, y: 240 }), true);
  assert.deepEqual(registry.forTab("tab-1")[0].cursor, { x: 320, y: 240, updatedAt: 1_000 });

  now = 12_000;
  assert.equal(registry.snapshot()[0].connectionState, "stale");
  registry.heartbeat(actor, now);
  assert.equal(registry.snapshot()[0].connectionState, "connected");

  now = 27_001;
  assert.deepEqual(registry.snapshot(), []);
});

test("bounded screenshot base64 plus its JSON envelope fits the 512 KiB bridge", () => {
  const result = {
    v: 1,
    type: "response",
    id: "request-1",
    result: {
      ok: true,
      requestId: "request-1",
      tabId: "tab-1",
      commandSequence: 1,
      revisionBefore: 1,
      revisionAfter: 1,
      data: {
        untrustedWebContent: true,
        mimeType: "image/jpeg",
        base64: Buffer.alloc(BROWSER_SCREENSHOT_MAX_BINARY_BYTES).toString("base64"),
        width: 1_280,
        height: 720
      }
    }
  };
  assert.ok(Buffer.byteLength(`${JSON.stringify(result)}\n`) < 512 * 1024);
});
