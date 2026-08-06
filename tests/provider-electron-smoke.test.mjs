import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProviderTranscript,
  providerSmokeArguments
} from "../src/main/services/browser/ProviderElectronSmoke.ts";

const expectedTool = "mcp__canvastty_browser__browser_list_tabs";
const browserResult = JSON.stringify({
  ok: true,
  requestId: "provider-smoke-request",
  data: { tabs: [] }
});

test("Kimi provider transcript requires exactly one successful CanvasTTY tool call", () => {
  const transcript = jsonl([
    {
      role: "assistant",
      tool_calls: [{ id: "call-1", type: "function", function: { name: expectedTool, arguments: "{}" } }]
    },
    { role: "tool", tool_call_id: "call-1", content: browserResult },
    { role: "assistant", content: "CANVASTTY_PROVIDER_SMOKE_OK" }
  ]);
  assert.doesNotThrow(() => assertProviderTranscript("kimi", transcript));
});

test("Claude provider transcript accepts stream-json tool_use and tool_result blocks", () => {
  const transcript = jsonl([
    { type: "assistant", message: { content: [{ type: "tool_use", id: "call-1", name: expectedTool, input: {} }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "call-1", content: browserResult }] } },
    { type: "result", result: "CANVASTTY_PROVIDER_SMOKE_OK" }
  ]);
  assert.doesNotThrow(() => assertProviderTranscript("claude", transcript));
});

test("Codex provider transcript deduplicates started and completed events for one MCP item", () => {
  const item = {
    id: "item-1",
    type: "mcp_tool_call",
    server: "canvastty_browser",
    tool: "browser_list_tabs",
    result: browserResult
  };
  const transcript = jsonl([
    { type: "item.started", item },
    { type: "item.completed", item },
    { type: "turn.completed", final_output: "CANVASTTY_PROVIDER_SMOKE_OK" }
  ]);
  assert.doesNotThrow(() => assertProviderTranscript("codex", transcript));
});

test("Kimi transcript rejects a model-printed BrowserResult when the correlated tool result failed", () => {
  const transcript = jsonl([
    {
      role: "assistant",
      tool_calls: [{ id: "call-1", type: "function", function: { name: expectedTool, arguments: "{}" } }]
    },
    {
      role: "tool",
      tool_call_id: "call-1",
      content: JSON.stringify({ ok: false, requestId: "failed-call", error: { code: "BRIDGE_UNAVAILABLE" } })
    },
    { role: "assistant", content: browserResult },
    { role: "assistant", content: "CANVASTTY_PROVIDER_SMOKE_OK" }
  ]);
  assert.throws(() => assertProviderTranscript("kimi", transcript), /expected tool call/u);
});

test("Claude transcript rejects a model-printed BrowserResult when the correlated tool result failed", () => {
  const transcript = jsonl([
    { type: "assistant", message: { content: [{ type: "tool_use", id: "call-1", name: expectedTool, input: {} }] } },
    {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "call-1",
          is_error: true,
          content: JSON.stringify({ ok: false, requestId: "failed-call", error: { code: "BRIDGE_UNAVAILABLE" } })
        }]
      }
    },
    { type: "assistant", message: { content: [{ type: "text", text: browserResult }] } },
    { type: "result", result: "CANVASTTY_PROVIDER_SMOKE_OK" }
  ]);
  assert.throws(() => assertProviderTranscript("claude", transcript), /expected tool call/u);
});

test("Codex transcript rejects a model-printed BrowserResult when the correlated MCP item failed", () => {
  const transcript = jsonl([
    {
      type: "item.completed",
      item: {
        id: "item-1",
        type: "mcp_tool_call",
        server: "canvastty_browser",
        tool: "browser_list_tabs",
        result: JSON.stringify({ ok: false, requestId: "failed-call", error: { code: "BRIDGE_UNAVAILABLE" } })
      }
    },
    { type: "item.completed", item: { id: "item-2", type: "agent_message", text: browserResult } },
    { type: "turn.completed", final_output: "CANVASTTY_PROVIDER_SMOKE_OK" }
  ]);
  assert.throws(() => assertProviderTranscript("codex", transcript), /expected tool call/u);
});

test("provider transcript rejects a successful result that belongs to a different call id", () => {
  const transcript = jsonl([
    {
      role: "assistant",
      tool_calls: [{ id: "call-1", type: "function", function: { name: expectedTool, arguments: "{}" } }]
    },
    { role: "tool", tool_call_id: "call-other", content: browserResult },
    { role: "assistant", content: "CANVASTTY_PROVIDER_SMOKE_OK" }
  ]);
  assert.throws(() => assertProviderTranscript("kimi", transcript), /expected tool call/u);
});

test("provider transcript rejects any extra tool invocation", () => {
  const transcript = jsonl([
    {
      role: "assistant",
      tool_calls: [
        { id: "call-1", type: "function", function: { name: expectedTool, arguments: "{}" } },
        { id: "call-2", type: "function", function: { name: "Bash", arguments: "{}" } }
      ]
    },
    { role: "tool", tool_call_id: "call-1", content: browserResult },
    { role: "assistant", content: "CANVASTTY_PROVIDER_SMOKE_OK" }
  ]);
  assert.throws(
    () => assertProviderTranscript("kimi", transcript),
    /unexpected tool sequence/u
  );
});

test("Codex transcript rejects built-in command, file, and web actions", () => {
  for (const type of ["command_execution", "file_change", "web_search"]) {
    const transcript = jsonl([
      { type: "item.started", item: { id: `extra-${type}`, type } },
      {
        type: "item.completed",
        item: {
          id: "item-1",
          type: "mcp_tool_call",
          server: "canvastty_browser",
          tool: "browser_list_tabs",
          result: browserResult
        }
      },
      { type: "turn.completed", final_output: "CANVASTTY_PROVIDER_SMOKE_OK" }
    ]);
    assert.throws(() => assertProviderTranscript("codex", transcript), /unexpected tool sequence/u);
  }
});

test("provider argv keeps approval scoped and disables unrelated Claude configuration", () => {
  const launchArgs = ["--provider-launch-marker"];
  const claude = providerSmokeArguments("claude", launchArgs, "/tmp/smoke");
  assert.deepEqual(optionValue(claude, "--setting-sources"), "");
  assert.deepEqual(optionValue(claude, "--tools"), "");
  assert.deepEqual(optionValue(claude, "--prompt-suggestions"), "false");
  assert.equal(claude.includes("--permission-mode"), false);
  assert.equal(claude.includes("--strict-mcp-config"), true);

  const codex = providerSmokeArguments("codex", launchArgs, "/tmp/smoke");
  assert.equal(codex[0], "exec");
  assert.equal(codex.includes('approval_policy="on-request"'), true);
  assert.equal(codex.includes("--sandbox"), true);
  assert.equal(optionValue(codex, "--sandbox"), "read-only");

  const kimi = providerSmokeArguments("kimi", launchArgs, "/tmp/smoke");
  assert.equal(kimi.includes("--yolo"), false);
  assert.equal(optionValue(kimi, "--output-format"), "stream-json");
});

function jsonl(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `missing ${option}`);
  return args[index + 1];
}
