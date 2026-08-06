import assert from "node:assert/strict";
import test from "node:test";
import { BrowserCore } from "../src/main/services/browser/BrowserCore.ts";

const emptySnapshot = {
  tabs: [],
  activeTabId: null,
  visible: false,
  agents: [],
  downloads: [],
  pendingDialog: null
};

function actor(id) {
  return {
    kind: "agent",
    agentId: `agent-${id}`,
    provider: "codex",
    terminalSessionId: `terminal-${id}`,
    connectionId: `connection-${id}`,
    cwd: "/tmp"
  };
}

test("BrowserCore activity subscriptions and get_activity isolate each agent", async () => {
  const host = {
    getSnapshot: () => emptySnapshot,
    getTab: () => null,
    ensureRuntime: async () => {},
    newTab: async () => emptySnapshot,
    closeTab: async () => emptySnapshot,
    activateTab: async () => emptySnapshot,
    navigateTab: async () => emptySnapshot,
    back: async () => emptySnapshot,
    forward: async () => emptySnapshot,
    reload: async () => emptySnapshot,
    pendingDialog: () => null,
    waitForDownload: async () => { throw new Error("unused"); },
    touchActor: () => {},
    heartbeatActor: () => {},
    disconnectActor: () => {}
  };
  const audit = {
    append: async (input) => ({ ...input, hash: "hash", previousHash: null, sequence: 1, version: 1 })
  };
  const core = new BrowserCore({ host, automation: {}, policy: {}, audit });
  const first = actor("one");
  const second = actor("two");
  const human = { kind: "human", connectionId: "renderer" };

  await core.execute(first, { type: "browser_list_tabs", requestId: "first-list" });
  await core.execute(second, { type: "browser_list_tabs", requestId: "second-list" });
  await core.execute(human, { type: "browser_list_tabs", requestId: "human-list" });

  const subscribed = [];
  const unsubscribe = core.subscribe(first, 0, (event) => subscribed.push(event));
  assert.deepEqual(subscribed.map((event) => event.agentId), [first.agentId]);

  const result = await core.execute(first, {
    type: "browser_get_activity",
    requestId: "first-activity",
    cursor: "0"
  });
  assert.equal(result.ok, true);
  assert.ok(result.data.events.every((event) => event.agentId === first.agentId));
  assert.ok(result.data.events.every((event) => event.terminalSessionId === first.terminalSessionId));
  unsubscribe();
});

test("BrowserCore paginates owned activity through a busy foreign-agent stream", async () => {
  const host = {
    getSnapshot: () => emptySnapshot,
    getTab: () => null,
    ensureRuntime: async () => {},
    newTab: async () => emptySnapshot,
    closeTab: async () => emptySnapshot,
    activateTab: async () => emptySnapshot,
    navigateTab: async () => emptySnapshot,
    back: async () => emptySnapshot,
    forward: async () => emptySnapshot,
    reload: async () => emptySnapshot,
    pendingDialog: () => null,
    waitForDownload: async () => { throw new Error("unused"); },
    touchActor: () => {},
    heartbeatActor: () => {},
    disconnectActor: () => {}
  };
  const audit = {
    append: async (input) => ({ ...input, hash: "hash", previousHash: null, sequence: 1, version: 1 })
  };
  const core = new BrowserCore({ host, automation: {}, policy: {}, audit });
  const first = actor("one");
  const second = actor("two");

  const firstInitial = await core.execute(first, { type: "browser_list_tabs", requestId: "first-initial" });
  for (let index = 0; index < 5; index += 1) {
    await core.execute(second, { type: "browser_list_tabs", requestId: `second-before-${index}` });
  }
  const firstOwned = await core.execute(first, { type: "browser_list_tabs", requestId: "first-owned" });
  await core.execute(second, { type: "browser_list_tabs", requestId: "second-after" });

  const ownedPage = await core.execute(first, {
    type: "browser_get_activity",
    requestId: "first-owned-page",
    cursor: String(firstInitial.commandSequence),
    limit: 1
  });
  assert.equal(ownedPage.ok, true);
  assert.deepEqual(ownedPage.data.events.map((event) => event.requestId), ["first-owned"]);
  assert.equal(ownedPage.data.nextCursor, String(firstOwned.commandSequence));
  assert.ok(ownedPage.data.events.every((event) => event.agentId === first.agentId));
  assert.ok(ownedPage.data.events.every((event) => event.terminalSessionId === first.terminalSessionId));

  let lastForeign;
  for (let index = 0; index < 3; index += 1) {
    lastForeign = await core.execute(second, {
      type: "browser_list_tabs",
      requestId: `second-only-${index}`
    });
  }
  const emptyOwnedPage = await core.execute(first, {
    type: "browser_get_activity",
    requestId: "first-empty-page",
    cursor: String(ownedPage.commandSequence),
    limit: 1
  });
  assert.equal(emptyOwnedPage.ok, true);
  assert.deepEqual(emptyOwnedPage.data.events, []);
  assert.equal(emptyOwnedPage.data.nextCursor, String(lastForeign.commandSequence));
});

test("BrowserCore handles dialogs by tab without one tab overwriting another", async () => {
  const dialogs = new Map([
    ["tab-a", { tabId: "tab-a", type: "confirm", message: "A", defaultPrompt: "", openedAt: 1 }],
    ["tab-b", { tabId: "tab-b", type: "prompt", message: "B", defaultPrompt: "", openedAt: 2 }]
  ]);
  const snapshot = { ...emptySnapshot, activeTabId: "tab-a" };
  const host = {
    getSnapshot: () => snapshot,
    getTab: (tabId) => ({ id: tabId, url: `https://${tabId}.example/`, documentRevision: 1, status: "ready" }),
    ensureRuntime: async () => {},
    newTab: async () => snapshot,
    closeTab: async () => snapshot,
    activateTab: async () => snapshot,
    navigateTab: async () => snapshot,
    back: async () => snapshot,
    forward: async () => snapshot,
    reload: async () => snapshot,
    pendingDialog: (tabId) => dialogs.get(tabId) ?? null,
    waitForDownload: async () => { throw new Error("unused"); },
    touchActor: () => {}, heartbeatActor: () => {}, disconnectActor: () => {}
  };
  const audit = { append: async (input) => ({ ...input, hash: "hash", previousHash: null, sequence: 1, version: 1 }) };
  const automation = {
    handleDialog: async (tabId) => dialogs.delete(tabId)
  };
  const core = new BrowserCore({ host, automation, policy: {}, audit });

  const result = await core.execute(actor("one"), {
    type: "browser_handle_dialog",
    requestId: "handle-a",
    tabId: "tab-a",
    accept: true
  });
  assert.equal(result.ok, true);
  assert.equal(dialogs.has("tab-a"), false);
  assert.equal(dialogs.has("tab-b"), true);
});

test("BrowserCore strips favicon payloads and raw failures from agent results", async () => {
  const sensitiveFieldName = ["api", "Key"].join("");
  let deeplyNested = { credential: "deep-secret" };
  for (let index = 0; index < 14; index += 1) deeplyNested = { nested: deeplyNested };
  const snapshot = {
    ...emptySnapshot,
    diagnostics: {
      [sensitiveFieldName]: "api-key-secret",
      deeplyNested
    },
    tabs: [{
      id: "tab-a", url: "https://example.com/?q=public&X-Amz-Signature=portable-secret", title: "Example", loading: false,
      canGoBack: false, canGoForward: false, documentRevision: 1, status: "ready",
      favicon: `data:image/png;base64,${"A".repeat(300_000)}`, agents: [], crashState: null
    }],
    activeTabId: "tab-a"
  };
  const host = {
    getSnapshot: () => snapshot,
    getTab: () => null,
    ensureRuntime: async () => {},
    newTab: async () => { throw new Error("https://example.com/?token=raw-secret /Users/private"); },
    closeTab: async () => snapshot,
    activateTab: async () => snapshot,
    navigateTab: async () => snapshot,
    back: async () => snapshot,
    forward: async () => snapshot,
    reload: async () => snapshot,
    pendingDialog: () => null,
    waitForDownload: async () => { throw new Error("unused"); },
    touchActor: () => {}, heartbeatActor: () => {}, disconnectActor: () => {}
  };
  const audit = { append: async (input) => ({ ...input, hash: "hash", previousHash: null, sequence: 1, version: 1 }) };
  const core = new BrowserCore({ host, automation: {}, policy: { assertNavigationUrl: (url) => url }, audit });
  const agentActor = actor("redaction");

  const listed = await core.execute(agentActor, { type: "browser_list_tabs", requestId: "redacted-list" });
  assert.equal(listed.ok, true);
  assert.equal(listed.data.tabs[0].favicon, null);
  assert.equal(listed.data.tabs[0].url.includes("secret"), false);
  assert.equal(listed.data.tabs[0].url, "https://example.com/");
  assert.equal(JSON.stringify(listed.data).includes("api-key-secret"), false);
  assert.equal(JSON.stringify(listed.data).includes("deep-secret"), false);

  const failed = await core.execute(agentActor, {
    type: "browser_new_tab",
    requestId: "redacted-failure",
    url: "https://example.com/"
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.message, "Browser bridge is unavailable.");
  assert.equal(JSON.stringify(failed).includes("raw-secret"), false);
  assert.equal(JSON.stringify(failed).includes("/Users/private"), false);
});

test("canceling one shared-tab read does not detach another agent", async () => {
  const snapshot = { ...emptySnapshot, activeTabId: "tab-a" };
  const host = {
    getSnapshot: () => snapshot,
    getTab: (tabId) => ({
      id: tabId,
      url: `https://${tabId}.example/`,
      documentRevision: 1,
      status: "ready"
    }),
    ensureRuntime: async () => {},
    newTab: async () => snapshot,
    closeTab: async () => snapshot,
    activateTab: async () => snapshot,
    navigateTab: async () => snapshot,
    back: async () => snapshot,
    forward: async () => snapshot,
    reload: async () => snapshot,
    pendingDialog: () => null,
    waitForDownload: async () => { throw new Error("unused"); },
    touchActor: () => {}, heartbeatActor: () => {}, disconnectActor: () => {}
  };
  const gates = [];
  let detachCalls = 0;
  const automation = {
    readPage: async (_tabId, _revision, options) => new Promise((resolve) => {
      gates.push({ signal: options.signal, resolve });
    }),
    cancelPending: () => { detachCalls += 1; }
  };
  const audit = { append: async (input) => ({ ...input, hash: "hash", previousHash: null, sequence: 1, version: 1 }) };
  const core = new BrowserCore({ host, automation, policy: {}, audit });
  const firstAbort = new AbortController();
  const first = core.execute(actor("first-reader"), {
    type: "browser_read_page",
    requestId: "first-shared-read",
    tabId: "tab-a"
  }, firstAbort.signal);
  const second = core.execute(actor("second-reader"), {
    type: "browser_read_page",
    requestId: "second-shared-read",
    tabId: "tab-a"
  });
  while (gates.length < 2) await new Promise((resolve) => setImmediate(resolve));

  firstAbort.abort();
  const firstResult = await first;
  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.error.code, "CANCELED");
  assert.equal(detachCalls, 0);

  gates[1].resolve({ text: "second completed" });
  const secondResult = await second;
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.data.text, "second completed");
  assert.equal(detachCalls, 0);
  gates[0].resolve({ text: "late first completion" });
});
