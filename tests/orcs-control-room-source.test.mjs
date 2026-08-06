import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL(
  "../src/renderer/src/features/orcs/OrcsControlRoom.tsx",
  import.meta.url
);
const rendererEntryUrl = new URL("../src/renderer/src/main.tsx", import.meta.url);

test("visible ORCS control room remains deterministic, mock-backed and read-only", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /createMockOrcsSnapshot/);
  assert.match(source, /snapshot\.roles\.map/);
  assert.match(source, /snapshot\.verification\.map/);
  assert.match(source, /snapshot\.timeline\.slice/);
  assert.doesNotMatch(source, /window\.canvasTTY/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bWebSocket\b/);
  assert.doesNotMatch(source, /ipcRenderer|child_process|node:fs/);
});

test("renderer mounts the ORCS surface alongside the existing CanvasTTY app", async () => {
  const source = await readFile(rendererEntryUrl, "utf8");

  assert.match(source, /import \{ OrcsControlRoom \}/);
  assert.match(source, /<App \/>/);
  assert.match(source, /<OrcsControlRoom \/>/);
  assert.match(source, /styles\/orcs\.css/);
});
