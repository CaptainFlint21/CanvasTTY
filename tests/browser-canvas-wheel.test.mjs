import assert from "node:assert/strict";
import test from "node:test";
import { toCanvasWheelDeltaY } from "../src/main/services/browser/BrowserCanvasWheel.ts";

test("converts Electron positive-up wheel input to the DOM convention", () => {
  assert.equal(toCanvasWheelDeltaY({ deltaY: 42 }), -42);
  assert.equal(toCanvasWheelDeltaY({ deltaY: -42 }), 42);
});

test("falls back to wheel ticks and bounds native browser deltas", () => {
  assert.equal(toCanvasWheelDeltaY({ deltaY: 0, wheelTicksY: 1 }), -100);
  assert.equal(toCanvasWheelDeltaY({ deltaY: 4_000 }), -1_200);
  assert.equal(toCanvasWheelDeltaY({ deltaY: Number.NaN }), null);
});
