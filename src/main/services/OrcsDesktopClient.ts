import { createConnection } from "node:net";
import { isAbsolute, join } from "node:path";
import { TextDecoder } from "node:util";
import type { OrcsSnapshot } from "../../shared/orcs";
import { isOrcsSnapshot } from "../../shared/orcs";
import type {
  OrcsDesktopSnapshotResult,
  OrcsDesktopUnavailableReason
} from "../../shared/orcsBridge";
import { ORCS_DESKTOP_PROTOCOL_VERSION } from "../../shared/orcsBridge";

const MAX_RESPONSE_BYTES = 262_144;
const REQUEST_TIMEOUT_MS = 2_000;
const RESPONSE_KEYS = ["version", "ok", "operation", "data", "error"] as const;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

class OrcsDesktopClientError extends Error {
  constructor(readonly reason: OrcsDesktopUnavailableReason) {
    super(reason);
  }
}

export class OrcsDesktopClient {
  private lastSnapshot: OrcsSnapshot | null = null;

  async getSnapshot(): Promise<OrcsDesktopSnapshotResult> {
    try {
      const snapshot = await this.fetchSnapshot();
      this.lastSnapshot = snapshot;
      if (snapshot.stale) {
        return { state: "stale", snapshot, reason: "snapshot_stale" };
      }
      return { state: "available", snapshot, reason: null };
    } catch (error) {
      const reason = error instanceof OrcsDesktopClientError
        ? error.reason
        : "daemon_unavailable";
      if (this.lastSnapshot) {
        return {
          state: "stale",
          snapshot: { ...this.lastSnapshot, stale: true },
          reason
        };
      }
      return { state: "unavailable", snapshot: null, reason };
    }
  }

  private fetchSnapshot(): Promise<OrcsSnapshot> {
    const socketPath = resolveSocketPath();
    return new Promise((resolve, reject) => {
      let finished = false;
      let response = Buffer.alloc(0);
      const socket = createConnection({ path: socketPath });

      const fail = (reason: OrcsDesktopUnavailableReason): void => {
        if (finished) return;
        finished = true;
        socket.destroy();
        reject(new OrcsDesktopClientError(reason));
      };

      socket.setTimeout(REQUEST_TIMEOUT_MS);
      socket.on("connect", () => {
        socket.write(JSON.stringify({
          version: ORCS_DESKTOP_PROTOCOL_VERSION,
          operation: "snapshot"
        }) + "\n");
      });
      socket.on("data", (chunk: Buffer) => {
        if (finished) return;
        if (response.length + chunk.length > MAX_RESPONSE_BYTES) {
          fail("invalid_response");
          return;
        }
        response = Buffer.concat([response, chunk]);
      });
      socket.on("timeout", () => fail("daemon_unavailable"));
      socket.on("error", () => fail("daemon_unavailable"));
      socket.on("end", () => {
        if (finished) return;
        try {
          const snapshot = parseSnapshotResponse(response);
          finished = true;
          resolve(snapshot);
        } catch (error) {
          const reason = error instanceof OrcsDesktopClientError
            ? error.reason
            : "invalid_response";
          fail(reason);
        }
      });
    });
  }
}

function resolveSocketPath(): string {
  if (process.platform !== "linux") {
    throw new OrcsDesktopClientError("unsupported_platform");
  }
  const runtimeDirectory = process.env.XDG_RUNTIME_DIR;
  if (!runtimeDirectory || !isAbsolute(runtimeDirectory)) {
    throw new OrcsDesktopClientError("runtime_unavailable");
  }
  return join(runtimeDirectory, "orcs", "orcs.sock");
}

function parseSnapshotResponse(raw: Buffer): OrcsSnapshot {
  if (raw.length === 0 || raw.length > MAX_RESPONSE_BYTES || raw[raw.length - 1] !== 0x0a) {
    throw new OrcsDesktopClientError("invalid_response");
  }
  if (raw.subarray(0, raw.length - 1).includes(0x0a)) {
    throw new OrcsDesktopClientError("invalid_response");
  }

  let payload: unknown;
  try {
    const decoded = STRICT_UTF8.decode(raw.subarray(0, raw.length - 1));
    payload = JSON.parse(decoded);
  } catch {
    throw new OrcsDesktopClientError("invalid_response");
  }
  if (!isRecord(payload) || !hasOnlyKeys(payload, RESPONSE_KEYS)) {
    throw new OrcsDesktopClientError("invalid_response");
  }
  if (payload.version !== ORCS_DESKTOP_PROTOCOL_VERSION || typeof payload.ok !== "boolean") {
    throw new OrcsDesktopClientError("invalid_response");
  }

  if (!payload.ok) {
    if (payload.operation !== null || payload.data !== null || !isErrorPayload(payload.error)) {
      throw new OrcsDesktopClientError("invalid_response");
    }
    throw new OrcsDesktopClientError("daemon_unavailable");
  }

  if (payload.operation !== "snapshot" || payload.error !== null || !isOrcsSnapshot(payload.data)) {
    throw new OrcsDesktopClientError("invalid_response");
  }
  if (payload.data.source !== "daemon") {
    throw new OrcsDesktopClientError("invalid_response");
  }
  return payload.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isErrorPayload(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["code", "message"])
    && typeof value.code === "string"
    && value.code.length > 0
    && value.code.length <= 64
    && typeof value.message === "string"
    && value.message.length > 0
    && value.message.length <= 160;
}
