import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("ORCS Unix socket access stays in Electron main", () => {
  const client = source("src/main/services/OrcsDesktopClient.ts");
  const preload = source("src/preload/index.ts");
  const renderer = source("src/renderer/src/features/orcs/OrcsLiveControlRoom.tsx");
  const shared = source("src/shared/orcsBridge.ts");

  assert.match(client, /from "node:net"/);
  for (const unprivileged of [preload, renderer, shared]) {
    assert.doesNotMatch(unprivileged, /node:net|node:fs|node:path|createConnection\s*\(/);
  }
});

test("ORCS client uses only the private XDG Unix socket and validates live DTO", () => {
  const client = source("src/main/services/OrcsDesktopClient.ts");

  assert.match(client, /process\.env\.XDG_RUNTIME_DIR/);
  assert.match(client, /join\(runtimeDirectory, "orcs", "orcs\.sock"\)/);
  assert.match(client, /MAX_RESPONSE_BYTES = 262_144/);
  assert.match(client, /REQUEST_TIMEOUT_MS = 2_000/);
  assert.match(client, /isOrcsSnapshot\(payload\.data\)/);
  assert.match(client, /payload\.data\.source !== "daemon"/);
  assert.doesNotMatch(client, /\/tmp|0\.0\.0\.0|127\.0\.0\.1|localhost|createServer\s*\(/);
});

test("ORCS IPC is read-only and restricted to the trusted main renderer", () => {
  const registration = source("src/main/ipc/registerOrcsIpc.ts");
  const bridge = source("src/shared/orcsBridge.ts");
  const preload = source("src/preload/index.ts");
  const main = source("src/main/index.ts");

  assert.match(bridge, /snapshotGet: "orcs:snapshot:get"/);
  assert.doesNotMatch(bridge, /write|patch|commit|push|merge|shell|prompt/i);
  assert.match(registration, /event\.sender !== expected\.webContents/);
  assert.match(registration, /event\.senderFrame !== expected\.webContents\.mainFrame/);
  assert.match(preload, /ipcRenderer\.invoke\(ORCS_DESKTOP_IPC\.snapshotGet\)/);
  assert.match(main, /registerOrcsIpc\(/);
  assert.match(main, /new OrcsDesktopClient\(\)/);
});

test("Control Room uses live states and keeps mock behind an explicit dev-only switch", () => {
  const live = source("src/renderer/src/features/orcs/OrcsLiveControlRoom.tsx");
  const bootstrap = source("src/renderer/src/main.tsx");

  assert.match(live, /host\.orcs\.getSnapshot\(\)/);
  assert.match(live, /"loading"/);
  assert.match(live, /"unavailable"/);
  assert.match(live, /"stale"/);
  assert.match(live, /import\.meta\.env\.DEV/);
  assert.match(live, /get\("orcsMock"\) === "1"/);
  assert.match(live, /window\.canvasTTY\.settings\.get\(\)/);
  assert.match(bootstrap, /<OrcsLiveControlRoom \/>/);
  assert.doesNotMatch(bootstrap, /<OrcsControlRoom \/>/);
});
