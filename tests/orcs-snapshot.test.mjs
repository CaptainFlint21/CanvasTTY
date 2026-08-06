import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOrcsSnapshot,
  isOrcsSnapshot,
  ORCS_ROLE_IDS
} from "../src/shared/orcs.ts";
import { createMockOrcsSnapshot } from "../src/renderer/src/features/orcs/orcsMock.ts";

test("accepts the deterministic sanitized ORCS mock snapshot", () => {
  const snapshot = createMockOrcsSnapshot();

  assert.equal(isOrcsSnapshot(snapshot), true);
  assert.deepEqual(snapshot.roles.map(({ role }) => role), ORCS_ROLE_IDS);
  assert.doesNotThrow(() => assertOrcsSnapshot(snapshot));
});

test("rejects unknown raw output fields at every contract boundary", () => {
  const rootLeak = {
    ...createMockOrcsSnapshot(),
    rawPrompt: "must never cross IPC"
  };
  const roleLeak = structuredClone(createMockOrcsSnapshot());
  roleLeak.roles[0].rawOutput = "must never cross IPC";

  assert.equal(isOrcsSnapshot(rootLeak), false);
  assert.equal(isOrcsSnapshot(roleLeak), false);
});

test("requires exactly one snapshot for every ORCS role", () => {
  const missing = structuredClone(createMockOrcsSnapshot());
  missing.roles.pop();

  const duplicate = structuredClone(createMockOrcsSnapshot());
  duplicate.roles[4] = { ...duplicate.roles[0] };

  assert.equal(isOrcsSnapshot(missing), false);
  assert.equal(isOrcsSnapshot(duplicate), false);
});

test("blocks unbounded summaries and event streams", () => {
  const longSummary = structuredClone(createMockOrcsSnapshot());
  longSummary.roles[0].summary = "x".repeat(241);

  const tooManyEvents = structuredClone(createMockOrcsSnapshot());
  tooManyEvents.timeline = Array.from({ length: 201 }, (_, index) => ({
    id: `event-${index}`,
    occurredAt: index,
    level: "info",
    role: null,
    message: "bounded"
  }));

  assert.equal(isOrcsSnapshot(longSummary), false);
  assert.equal(isOrcsSnapshot(tooManyEvents), false);
});
