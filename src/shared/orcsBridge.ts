import type { OrcsSnapshot } from "./orcs";

export const ORCS_DESKTOP_PROTOCOL_VERSION = 1 as const;

export const ORCS_DESKTOP_IPC = {
  snapshotGet: "orcs:snapshot:get"
} as const;

export type OrcsDesktopUnavailableReason =
  | "unsupported_platform"
  | "runtime_unavailable"
  | "daemon_unavailable"
  | "invalid_response"
  | "snapshot_stale";

export type OrcsDesktopSnapshotResult =
  | {
    state: "available";
    snapshot: OrcsSnapshot;
    reason: null;
  }
  | {
    state: "stale";
    snapshot: OrcsSnapshot;
    reason: OrcsDesktopUnavailableReason;
  }
  | {
    state: "unavailable";
    snapshot: null;
    reason: OrcsDesktopUnavailableReason;
  };

export interface OrcsDesktopApi {
  getSnapshot(): Promise<OrcsDesktopSnapshotResult>;
}

export interface OrcsDesktopApiHost {
  orcs: OrcsDesktopApi;
}
