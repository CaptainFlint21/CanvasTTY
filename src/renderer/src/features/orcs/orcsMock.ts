import type { OrcsSnapshot } from "../../../../shared/orcs";

export const ORCS_MOCK_TIME = 1_786_027_200_000;

export function createMockOrcsSnapshot(now = ORCS_MOCK_TIME): OrcsSnapshot {
  return {
    schemaVersion: 1,
    source: "mock",
    fetchedAt: now,
    stale: false,
    runId: "orcs-phase-0-demo",
    taskTitle: "Build the ORCS read-only control room",
    headSha: "bdebc677984281b294839ff5def85776ae45ec89",
    status: "needs_approval",
    phase: "review",
    gate: {
      status: "pending",
      action: "apply_patch",
      label: "Owner approval required before applying the proposed GUI patch"
    },
    roles: [
      {
        role: "moderator",
        status: "done",
        provider: "AnyModel",
        model: "DeepSeek V4 Flash",
        providerHealth: "available",
        fallbackLevel: 0,
        toolCalls: 4,
        summary: "Plan and acceptance criteria are complete."
      },
      {
        role: "architect",
        status: "done",
        provider: "NVIDIA NIM",
        model: "DeepSeek V4 Pro",
        providerHealth: "available",
        fallbackLevel: 0,
        toolCalls: 9,
        summary: "Renderer, IPC and daemon boundaries are defined."
      },
      {
        role: "coder",
        status: "done",
        provider: "AnyModel",
        model: "GLM 5.2",
        providerHealth: "available",
        fallbackLevel: 0,
        toolCalls: 12,
        summary: "A bounded read-only dashboard patch has been proposed."
      },
      {
        role: "critic",
        status: "working",
        provider: "NVIDIA NIM",
        model: "MiniMax M3",
        providerHealth: "available",
        fallbackLevel: 0,
        toolCalls: 6,
        summary: "Reviewing IPC exposure, telemetry integrity and secret boundaries."
      },
      {
        role: "judge",
        status: "waiting",
        provider: "NVIDIA NIM",
        model: "Nemotron 3 Ultra",
        providerHealth: "stale",
        fallbackLevel: 1,
        toolCalls: 0,
        summary: "Waiting for security review and owner approval."
      }
    ],
    verification: [
      { id: "typecheck", label: "TypeScript typecheck", status: "pending", detail: null },
      { id: "tests", label: "Repository tests", status: "pending", detail: null },
      { id: "build", label: "Electron build", status: "pending", detail: null },
      { id: "electron-smoke", label: "Electron smoke check", status: "pending", detail: "Requires local runtime" }
    ],
    timeline: [
      {
        id: "event-1",
        occurredAt: now - 300_000,
        level: "info",
        role: "moderator",
        message: "Moderator created the Phase 0 implementation plan."
      },
      {
        id: "event-2",
        occurredAt: now - 240_000,
        level: "success",
        role: "architect",
        message: "Architect fixed the renderer, IPC and daemon trust boundaries."
      },
      {
        id: "event-3",
        occurredAt: now - 180_000,
        level: "success",
        role: "coder",
        message: "Coder prepared a typed read-only dashboard patch."
      },
      {
        id: "event-4",
        occurredAt: now - 120_000,
        level: "warning",
        role: "critic",
        message: "Critic is checking that no raw output or credentials cross IPC."
      },
      {
        id: "event-5",
        occurredAt: now - 60_000,
        level: "info",
        role: null,
        message: "The run is paused at the owner approval gate."
      }
    ]
  };
}
