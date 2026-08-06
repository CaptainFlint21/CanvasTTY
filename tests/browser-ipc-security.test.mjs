import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ipcPath = new URL("../src/main/ipc/registerIpc.ts", import.meta.url);

test("privileged browser IPC validates the trusted main renderer", async () => {
  const source = await readFile(ipcPath, "utf8");

  assert.match(source, /function assertMainRenderer/);
  assert.match(source, /event\.sender !== expected\.webContents/);
  assert.match(source, /event\.senderFrame !== expected\.webContents\.mainFrame/);

  for (const channel of [
    "browserGetState",
    "browserOpen",
    "browserClose",
    "browserNewTab",
    "browserSelectTab",
    "browserCloseTab",
    "browserNavigate",
    "browserBack",
    "browserForward",
    "browserReload",
    "browserSetViewport"
  ]) {
    const handler = source.slice(source.indexOf(`IPC.${channel}`), source.indexOf(`IPC.${channel}`) + 320);
    assert.match(handler, /assertMainRenderer\(event, getMainWindow\)/, `${channel} must validate its sender`);
  }
});
