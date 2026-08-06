export const ORCS_SNAPSHOT_VERSION = 1 as const;

export const ORCS_ROLE_IDS = [
  "moderator",
  "architect",
  "coder",
  "critic",
  "judge"
] as const;

export type OrcsRoleId = (typeof ORCS_ROLE_IDS)[number];
export type OrcsSnapshotSource = "mock" | "daemon";
export type OrcsRunStatus =
  | "idle"
  | "running"
  | "needs_approval"
  | "completed"
  | "failed";
export type OrcsPhase =
  | "planning"
  | "reading"
  | "patching"
  | "verification"
  | "review"
  | "judging"
  | "reporting"
  | "complete";
export type OrcsGateStatus = "none" | "pending" | "approved" | "rejected" | "blocked";
export type OrcsRoleStatus =
  | "idle"
  | "working"
  | "waiting"
  | "needs_approval"
  | "done"
  | "failed";
export type OrcsProviderHealth = "available" | "stale" | "unavailable";
export type OrcsCheckStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type OrcsEventLevel = "info" | "success" | "warning" | "error";

export interface OrcsRoleSnapshot {
  role: OrcsRoleId;
  status: OrcsRoleStatus;
  provider: string;
  model: string;
  providerHealth: OrcsProviderHealth;
  fallbackLevel: number;
  toolCalls: number;
  summary: string;
}

export interface OrcsVerificationCheck {
  id: string;
  label: string;
  status: OrcsCheckStatus;
  detail: string | null;
}

export interface OrcsTimelineEvent {
  id: string;
  occurredAt: number;
  level: OrcsEventLevel;
  role: OrcsRoleId | null;
  message: string;
}

export interface OrcsApprovalGate {
  status: OrcsGateStatus;
  action: "none" | "apply_patch" | "run_verification" | "commit" | "open_pr" | "merge";
  label: string | null;
}

export interface OrcsSnapshot {
  schemaVersion: typeof ORCS_SNAPSHOT_VERSION;
  source: OrcsSnapshotSource;
  fetchedAt: number;
  stale: boolean;
  runId: string | null;
  taskTitle: string | null;
  headSha: string | null;
  status: OrcsRunStatus;
  phase: OrcsPhase;
  gate: OrcsApprovalGate;
  roles: OrcsRoleSnapshot[];
  verification: OrcsVerificationCheck[];
  timeline: OrcsTimelineEvent[];
}

const ROLE_ID_SET = new Set<string>(ORCS_ROLE_IDS);
const RUN_STATUS_SET = new Set<string>(["idle", "running", "needs_approval", "completed", "failed"]);
const PHASE_SET = new Set<string>([
  "planning",
  "reading",
  "patching",
  "verification",
  "review",
  "judging",
  "reporting",
  "complete"
]);
const GATE_STATUS_SET = new Set<string>(["none", "pending", "approved", "rejected", "blocked"]);
const GATE_ACTION_SET = new Set<string>([
  "none",
  "apply_patch",
  "run_verification",
  "commit",
  "open_pr",
  "merge"
]);
const ROLE_STATUS_SET = new Set<string>([
  "idle",
  "working",
  "waiting",
  "needs_approval",
  "done",
  "failed"
]);
const PROVIDER_HEALTH_SET = new Set<string>(["available", "stale", "unavailable"]);
const CHECK_STATUS_SET = new Set<string>(["pending", "running", "passed", "failed", "skipped"]);
const EVENT_LEVEL_SET = new Set<string>(["info", "success", "warning", "error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isBoundedString(value: unknown, maxLength: number, allowNull = false): boolean {
  return (allowNull && value === null) || (typeof value === "string" && value.length <= maxLength);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRoleSnapshot(value: unknown): value is OrcsRoleSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "role",
    "status",
    "provider",
    "model",
    "providerHealth",
    "fallbackLevel",
    "toolCalls",
    "summary"
  ])) return false;

  return typeof value.role === "string"
    && ROLE_ID_SET.has(value.role)
    && typeof value.status === "string"
    && ROLE_STATUS_SET.has(value.status)
    && isBoundedString(value.provider, 80)
    && isBoundedString(value.model, 120)
    && typeof value.providerHealth === "string"
    && PROVIDER_HEALTH_SET.has(value.providerHealth)
    && isBoundedInteger(value.fallbackLevel, 0, 3)
    && isBoundedInteger(value.toolCalls, 0, 10_000)
    && isBoundedString(value.summary, 240);
}

function isVerificationCheck(value: unknown): value is OrcsVerificationCheck {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "label", "status", "detail"])) return false;
  return isBoundedString(value.id, 80)
    && isBoundedString(value.label, 120)
    && typeof value.status === "string"
    && CHECK_STATUS_SET.has(value.status)
    && isBoundedString(value.detail, 240, true);
}

function isTimelineEvent(value: unknown): value is OrcsTimelineEvent {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "occurredAt", "level", "role", "message"])) return false;
  return isBoundedString(value.id, 80)
    && isFiniteNumber(value.occurredAt)
    && typeof value.level === "string"
    && EVENT_LEVEL_SET.has(value.level)
    && (value.role === null || (typeof value.role === "string" && ROLE_ID_SET.has(value.role)))
    && isBoundedString(value.message, 240);
}

function isApprovalGate(value: unknown): value is OrcsApprovalGate {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "action", "label"])) return false;
  return typeof value.status === "string"
    && GATE_STATUS_SET.has(value.status)
    && typeof value.action === "string"
    && GATE_ACTION_SET.has(value.action)
    && isBoundedString(value.label, 160, true);
}

export function isOrcsSnapshot(value: unknown): value is OrcsSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion",
    "source",
    "fetchedAt",
    "stale",
    "runId",
    "taskTitle",
    "headSha",
    "status",
    "phase",
    "gate",
    "roles",
    "verification",
    "timeline"
  ])) return false;

  if (value.schemaVersion !== ORCS_SNAPSHOT_VERSION
    || (value.source !== "mock" && value.source !== "daemon")
    || !isFiniteNumber(value.fetchedAt)
    || typeof value.stale !== "boolean"
    || !isBoundedString(value.runId, 128, true)
    || !isBoundedString(value.taskTitle, 200, true)
    || !isBoundedString(value.headSha, 64, true)
    || typeof value.status !== "string"
    || !RUN_STATUS_SET.has(value.status)
    || typeof value.phase !== "string"
    || !PHASE_SET.has(value.phase)
    || !isApprovalGate(value.gate)
    || !Array.isArray(value.roles)
    || value.roles.length !== ORCS_ROLE_IDS.length
    || !value.roles.every(isRoleSnapshot)
    || new Set(value.roles.map((role) => role.role)).size !== ORCS_ROLE_IDS.length
    || !Array.isArray(value.verification)
    || value.verification.length > 50
    || !value.verification.every(isVerificationCheck)
    || !Array.isArray(value.timeline)
    || value.timeline.length > 200
    || !value.timeline.every(isTimelineEvent)) return false;

  // The checks above prove that every entry is an OrcsRoleSnapshot. TypeScript
  // does not preserve that property-level narrowing after the compound guard,
  // so keep the validated array in an explicitly typed local binding.
  const roles = value.roles as OrcsRoleSnapshot[];
  return ORCS_ROLE_IDS.every((roleId) => roles.some((role) => role.role === roleId));
}

export function assertOrcsSnapshot(value: unknown): asserts value is OrcsSnapshot {
  if (!isOrcsSnapshot(value)) throw new Error("Invalid ORCS snapshot");
}
