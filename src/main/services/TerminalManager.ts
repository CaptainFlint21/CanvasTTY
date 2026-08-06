import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename } from "node:path";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type {
  CreateSessionRequest,
  Point,
  ProviderId,
  SessionBounds,
  SessionEvent,
  SessionMetadata,
  SessionRemovedEvent,
  SessionSnapshot,
  TerminalDataEvent
} from "../../shared/contracts.ts";
import { IPC } from "../../shared/contracts.ts";
import type {
  AgentBrowserLaunchCoordinator,
  PreparedAgentBrowserPtyLaunch
} from "./agent-browser/AgentBrowserBridge.ts";
import { AGENT_BROWSER_ENV } from "./agent-browser/AgentBrowserBridge.ts";
import { tryPtyOperation } from "./ptySafety.ts";

const MAX_SCROLLBACK_CHARS = 240_000;
const OUTPUT_BATCH_MS = 16;
const DEFAULT_TERMINAL_SIZE = { width: 700, height: 430 };
const MIN_TERMINAL_SIZE = { width: 420, height: 260 };
const MAX_TERMINAL_SIZE = { width: 1_600, height: 1_100 };

interface ManagedSession {
  metadata: SessionMetadata;
  process: IPty;
  bufferChunks: string[];
  bufferStart: number;
  bufferLength: number;
  pendingOutput: string[];
  outputTimer: ReturnType<typeof setTimeout> | null;
  agentBrowser: PreparedAgentBrowserPtyLaunch | null;
}

export interface ProviderLifecycleSignal {
  kind: "lifecycle";
  state: "idle" | "working" | "needs_approval";
  requestId?: string;
}

type Emit = (
  channel: typeof IPC.terminalData | typeof IPC.terminalSession | typeof IPC.terminalRemoved,
  payload: TerminalDataEvent | SessionEvent | SessionRemovedEvent
) => void;

export class TerminalManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly emit: Emit;
  private readonly agentBrowser?: AgentBrowserLaunchCoordinator;

  constructor(emit: Emit, agentBrowser?: AgentBrowserLaunchCoordinator) {
    this.emit = emit;
    this.agentBrowser = agentBrowser;
  }

  list(): SessionSnapshot[] {
    return [...this.sessions.values()].map((session) => snapshot(session));
  }

  create(request: CreateSessionRequest): SessionSnapshot {
    assertCreateRequest(request);
    assertDirectory(request.cwd);

    const id = randomUUID();
    const agentBrowser = request.provider === "terminal"
      ? null
      : this.agentBrowser?.prepareLaunch({
        terminalSessionId: id,
        provider: request.provider,
        cwd: request.cwd
      }) ?? null;
    const launch = resolveLaunch(request.provider, request.profile, agentBrowser?.args ?? []);
    const metadata: SessionMetadata = {
      id,
      provider: request.provider,
      profile: request.profile,
      title: request.title?.trim() || defaultTitle(request.provider, request.cwd),
      titleCustomized: Boolean(request.title?.trim()),
      cwd: request.cwd,
      position: request.position,
      size: DEFAULT_TERMINAL_SIZE,
      status: "idle",
      startedAt: Date.now(),
      exitCode: null
    };

    let process: IPty;
    try {
      process = pty.spawn(launch.command, launch.args, {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: request.cwd,
        env: { ...terminalEnvironment(), ...agentBrowser?.environment }
      });
    } catch (error) {
      agentBrowser?.cleanup();
      throw error;
    }

    const session: ManagedSession = {
      metadata,
      process,
      bufferChunks: [],
      bufferStart: 0,
      bufferLength: 0,
      pendingOutput: [],
      outputTimer: null,
      agentBrowser
    };
    this.sessions.set(id, session);
    process.onData((data) => {
      const current = this.sessions.get(id);
      if (!current) return;

      appendScrollback(current, data);
      this.queueOutput(id, current, data);
    });

    process.onExit(({ exitCode }) => {
      const current = this.sessions.get(id);
      if (!current) return;

      this.flushOutput(id, current);
      current.metadata.exitCode = exitCode;
      current.metadata.status = exitCode === 0 ? "done" : "failed";
      current.agentBrowser?.cleanup();
      this.emitSession(current.metadata);
    });

    this.emitSession(metadata);
    return snapshot(session);
  }

  input(id: string, data: string): void {
    if (typeof data !== "string" || data.length === 0) return;
    const session = this.sessions.get(id);
    if (!session || session.metadata.exitCode !== null) return;
    tryPtyOperation(() => session.process.write(data));
  }

  resize(id: string, cols: number, rows: number): void {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    const session = this.sessions.get(id);
    if (!session || session.metadata.exitCode !== null) return;
    const safeCols = Math.max(20, Math.min(400, Math.floor(cols)));
    const safeRows = Math.max(5, Math.min(200, Math.floor(rows)));
    tryPtyOperation(() => session.process.resize(safeCols, safeRows));
  }

  setBounds(id: string, bounds: SessionBounds): void {
    if (!isSessionBounds(bounds)) return;
    const session = this.sessions.get(id);
    if (!session) return;

    session.metadata.position = bounds.position;
    session.metadata.size = {
      width: clamp(bounds.size.width, MIN_TERMINAL_SIZE.width, MAX_TERMINAL_SIZE.width),
      height: clamp(bounds.size.height, MIN_TERMINAL_SIZE.height, MAX_TERMINAL_SIZE.height)
    };
    this.emitSession(session.metadata);
  }

  rename(id: string, title: string): SessionMetadata {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Terminal session does not exist.");
    if (typeof title !== "string") throw new Error("Window title is invalid.");

    const nextTitle = title.trim();
    if (nextTitle.length === 0) throw new Error("Window title cannot be empty.");
    session.metadata.title = nextTitle.slice(0, 80);
    session.metadata.titleCustomized = true;
    this.emitSession(session.metadata);
    return structuredClone(session.metadata);
  }

  applyProviderSignal(id: string, signal: ProviderLifecycleSignal): void {
    const session = this.sessions.get(id);
    if (!session || session.metadata.status === "done" || session.metadata.status === "failed") return;

    const nextStatus = signal.state;
    if (session.metadata.status === nextStatus) return;
    session.metadata.status = nextStatus;
    this.emitSession(session.metadata);
  }

  dispose(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    this.flushOutput(id, session);
    this.sessions.delete(id);
    session.agentBrowser?.cleanup();
    try {
      session.process.kill();
    } catch (error) {
      console.warn(`PTY ${id} could not be killed cleanly.`, error);
    }
    this.emit(IPC.terminalRemoved, { id });
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.dispose(id);
    }
  }

  private emitSession(metadata: SessionMetadata): void {
    this.emit(IPC.terminalSession, { session: structuredClone(metadata) });
  }

  private queueOutput(id: string, session: ManagedSession, data: string): void {
    session.pendingOutput.push(data);
    if (session.outputTimer !== null) return;
    // Keep a TUI's clear-and-redraw sequence in one renderer update whenever possible.
    session.outputTimer = setTimeout(() => this.flushOutput(id, session), OUTPUT_BATCH_MS);
  }

  private flushOutput(id: string, session: ManagedSession): void {
    if (session.outputTimer !== null) {
      clearTimeout(session.outputTimer);
      session.outputTimer = null;
    }
    if (session.pendingOutput.length === 0) return;

    const data = session.pendingOutput.join("");
    session.pendingOutput.length = 0;
    this.emit(IPC.terminalData, { id, data });
  }
}

function resolveLaunch(
  provider: ProviderId,
  profile: CreateSessionRequest["profile"],
  agentBrowserArgs: string[]
): {
  command: string;
  args: string[];
} {
  if (provider === "terminal") {
    return { command: process.env.SHELL || "/bin/bash", args: ["-l"] };
  }

  const command: Record<Exclude<ProviderId, "terminal">, string> = {
    codex: "codex",
    claude: "claude",
    kimi: "kimi"
  };
  const dangerousArgs: Record<Exclude<ProviderId, "terminal">, string[]> = {
    codex: ["--dangerously-bypass-approvals-and-sandbox"],
    claude: ["--dangerously-skip-permissions"],
    kimi: ["--yolo"]
  };

  return {
    command: command[provider],
    args: [...(profile === "yolo" ? dangerousArgs[provider] : []), ...agentBrowserArgs]
  };
}

export function terminalEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const reserved = new Set<string>(Object.values(AGENT_BROWSER_ENV));
  const environment = Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => (
      typeof entry[1] === "string" && !reserved.has(entry[0])
    ))
  );
  return { ...environment, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

function defaultTitle(provider: ProviderId, cwd: string): string {
  const project = basename(cwd) || cwd;
  if (provider === "terminal") return `Terminal · ${project}`;
  return `${project} · ${provider[0].toUpperCase()}${provider.slice(1)}`;
}

function assertDirectory(cwd: string): void {
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("Not a directory");
  } catch {
    throw new Error(`Project folder does not exist: ${cwd}`);
  }
}

function assertCreateRequest(request: CreateSessionRequest): void {
  const providers = new Set<ProviderId>(["terminal", "codex", "claude", "kimi"]);
  if (!request || !providers.has(request.provider)) throw new Error("Unknown terminal provider.");
  if (request.profile !== "normal" && request.profile !== "yolo") throw new Error("Unknown launch profile.");
  if (typeof request.cwd !== "string" || request.cwd.length === 0) throw new Error("Project folder is required.");
  if (!isPoint(request.position)) throw new Error("Session position is invalid.");
}

function isPoint(value: unknown): value is Point {
  return Boolean(
    value
    && typeof value === "object"
    && "x" in value
    && "y" in value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
  );
}

function isSessionBounds(value: unknown): value is SessionBounds {
  if (!value || typeof value !== "object" || !("position" in value) || !("size" in value)) return false;
  const size = value.size;
  return isPoint(value.position)
    && Boolean(
      size
      && typeof size === "object"
      && "width" in size
      && "height" in size
      && Number.isFinite(size.width)
      && Number.isFinite(size.height)
    );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapshot(session: ManagedSession): SessionSnapshot {
  return {
    ...structuredClone(session.metadata),
    buffer: session.bufferChunks.slice(session.bufferStart).join("")
  };
}

function appendScrollback(session: ManagedSession, data: string): void {
  session.bufferChunks.push(data);
  session.bufferLength += data.length;

  while (session.bufferLength > MAX_SCROLLBACK_CHARS) {
    const first = session.bufferChunks[session.bufferStart];
    if (first === undefined) {
      session.bufferChunks.length = 0;
      session.bufferStart = 0;
      session.bufferLength = 0;
      return;
    }
    const overflow = session.bufferLength - MAX_SCROLLBACK_CHARS;
    if (first.length <= overflow) {
      session.bufferStart += 1;
      session.bufferLength -= first.length;
      continue;
    }
    session.bufferChunks[session.bufferStart] = first.slice(overflow);
    session.bufferLength -= overflow;
  }

  if (session.bufferStart > 256 && session.bufferStart * 2 >= session.bufferChunks.length) {
    session.bufferChunks = session.bufferChunks.slice(session.bufferStart);
    session.bufferStart = 0;
  }
}
