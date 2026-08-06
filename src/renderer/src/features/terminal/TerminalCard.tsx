import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type {
  LocaleId,
  PaletteId,
  Point,
  EdgePanSpeed,
  FocusActivation,
  SessionBounds,
  SessionSnapshot
} from "../../../../shared/contracts";
import { ProviderIcon } from "../../components/ProviderIcon";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";
import { sessionStatusLabel } from "../../lib/sessionStatus";
import { attachTerminalMouseCoordinateAdapter } from "./terminalMouseCoordinates";
import {
  SHIFT_ENTER_SEQUENCE,
  shouldCopyTerminalSelection,
  shouldPasteTerminalClipboard,
  shouldSendTerminalLineBreak
} from "./terminalShortcuts";
import {
  constrainResize,
  snapMove,
  snapResize
} from "../workspace/snap";
import type { ResizeDirection } from "../workspace/snap";

interface TerminalCardProps {
  session: SessionSnapshot;
  locale: LocaleId;
  palette: PaletteId;
  zoom: number;
  snapEnabled: boolean;
  focusActivation: FocusActivation;
  hoverFocus: boolean;
  hoverFocusSpeed: EdgePanSpeed;
  invertTerminalWheel: boolean;
  zoomOverApplications: boolean;
  selected: boolean;
  renaming: boolean;
  snapTargets: readonly SessionBounds[];
  onActivate(session: SessionSnapshot): void;
  onSelect(id: string): void;
  onDeselect(id: string): void;
  onRename(id: string, title: string): Promise<void>;
  onRenameEnd(): void;
  onBoundsChange(id: string, bounds: SessionBounds): void;
  onDispose(id: string): void;
}

interface DragState {
  pointerId: number;
  startClient: Point;
  startBounds: SessionBounds;
}

interface ResizeState extends DragState {
  direction: ResizeDirection;
}

const RESIZE_DIRECTIONS: ResizeDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const HOVER_FOCUS_DELAYS: Record<EdgePanSpeed, number> = {
  slow: 500,
  normal: 250,
  fast: 80
};
const TERMINAL_FOCUS_IN = "\u001b[I";
const TERMINAL_FOCUS_OUT = "\u001b[O";

export function TerminalCard({
  session,
  locale,
  palette,
  zoom,
  snapEnabled,
  focusActivation,
  hoverFocus,
  hoverFocusSpeed,
  invertTerminalWheel,
  zoomOverApplications,
  selected,
  renaming,
  snapTargets,
  onActivate,
  onSelect,
  onDeselect,
  onRename,
  onRenameEnd,
  onBoundsChange,
  onDispose
}: TerminalCardProps): React.JSX.Element {
  const terminalHost = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const renameInFlight = useRef(false);
  const hoverFocusTimer = useRef<number | null>(null);
  const hoverFocusTransition = useRef<"focus" | "blur" | null>(null);
  const hoverSelected = useRef(false);
  const suppressFocusReport = useRef(false);
  const invertTerminalWheelRef = useRef(invertTerminalWheel);
  invertTerminalWheelRef.current = invertTerminalWheel;
  const zoomOverApplicationsRef = useRef(zoomOverApplications);
  zoomOverApplicationsRef.current = zoomOverApplications;
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const [position, setPosition] = useState(session.position);
  const [size, setSize] = useState(session.size);
  const liveBounds = useRef<SessionBounds>({ position: session.position, size: session.size });
  const summaryMode = zoom < 0.5;
  const summaryScale = summaryMode ? Math.min(2.5, Math.max(1, 0.5 / zoom)) : 1;
  const terminalBackground = terminalTheme(palette).background;

  useEffect(() => {
    const bounds = { position: session.position, size: session.size };
    liveBounds.current = bounds;
    setPosition(bounds.position);
    setSize(bounds.size);
  }, [session.position, session.size]);

  useEffect(() => {
    const host = terminalHost.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5_000,
      allowTransparency: true,
      theme: terminalTheme(palette)
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminal.attachCustomKeyEventHandler((event) => {
      if (shouldSendTerminalLineBreak(event)) {
        event.preventDefault();
        event.stopPropagation();
        window.canvasTTY.terminal.input(session.id, SHIFT_ENTER_SEQUENCE);
        return false;
      }
      if (shouldCopyTerminalSelection(event, terminal.hasSelection())) {
        event.preventDefault();
        event.stopPropagation();
        window.canvasTTY.clipboard.writeText(terminal.getSelection());
        return false;
      }
      if (!shouldPasteTerminalClipboard(event)) return true;

      event.preventDefault();
      event.stopPropagation();
      void window.canvasTTY.clipboard.readText()
        .then((text) => {
          if (text && terminalRef.current === terminal) terminal.paste(text);
        })
        .catch(() => undefined);
      return false;
    });
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    const detachMouseCoordinateAdapter = screen
      ? attachTerminalMouseCoordinateAdapter(
        screen,
        () => invertTerminalWheelRef.current ? -1 : 1,
        () => zoomOverApplicationsRef.current
      )
      : () => undefined;
    terminalRef.current = terminal;
    if (session.buffer) terminal.write(session.buffer);

    const fit = (): void => {
      try {
        fitAddon.fit();
      } catch {
        // A hidden semantic-zoom surface has no measurable rows yet.
      }
    };
    const frame = requestAnimationFrame(fit);
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(host);

    const input = terminal.onData((data) => {
      // Hover focus routes keyboard input locally; it is not an OS focus change for the agent TUI.
      if (suppressFocusReport.current && (data === TERMINAL_FOCUS_IN || data === TERMINAL_FOCUS_OUT)) return;
      window.canvasTTY.terminal.input(session.id, data);
    });
    const resize = terminal.onResize(({ cols, rows }) => window.canvasTTY.terminal.resize(session.id, cols, rows));
    const unsubscribe = window.canvasTTY.terminal.onData((event) => {
      if (event.id === session.id) terminal.write(event.data);
    });

    return () => {
      cancelAnimationFrame(frame);
      detachMouseCoordinateAdapter();
      unsubscribe();
      resizeObserver.disconnect();
      input.dispose();
      resize.dispose();
      if (terminalRef.current === terminal) terminalRef.current = null;
      terminal.dispose();
    };
  }, [session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.theme = terminalTheme(palette);
  }, [palette]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const transition = hoverFocusTransition.current;
    suppressFocusReport.current = transition !== null || (!selected && hoverSelected.current);
    if (selected && !renaming && !summaryMode) terminal.focus();
    else if (!selected) {
      terminal.blur();
      renameInput.current?.blur();
      hoverSelected.current = false;
    }
    suppressFocusReport.current = false;
    hoverFocusTransition.current = null;
  }, [renaming, selected, summaryMode]);

  useEffect(() => () => {
    if (hoverFocusTimer.current !== null) window.clearTimeout(hoverFocusTimer.current);
  }, []);

  useEffect(() => {
    if (hoverFocus || hoverFocusTimer.current === null) return;
    window.clearTimeout(hoverFocusTimer.current);
    hoverFocusTimer.current = null;
  }, [hoverFocus]);

  const bindRenameInput = useCallback((input: HTMLInputElement | null): void => {
    renameInput.current = input;
    if (!input) return;
    terminalRef.current?.blur();
    input.focus({ preventScroll: true });
    input.select();
  }, []);

  const startDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest("button, input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startBounds: liveBounds.current
    };
  };

  const drag = (event: React.PointerEvent<HTMLElement>): void => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const rawPosition = {
      x: state.startBounds.position.x + (event.clientX - state.startClient.x) / zoom,
      y: state.startBounds.position.y + (event.clientY - state.startClient.y) / zoom
    };
    const nextPosition = snapEnabled
      ? snapMove(rawPosition, state.startBounds.size, snapTargets)
      : rawPosition;
    applyLiveBounds({ position: nextPosition, size: state.startBounds.size });
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
    dragState.current = null;
    onBoundsChange(session.id, liveBounds.current);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>, direction: ResizeDirection): void => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeState.current = {
      pointerId: event.pointerId,
      direction,
      startClient: { x: event.clientX, y: event.clientY },
      startBounds: liveBounds.current
    };
  };

  const resizeCard = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = (event.clientX - state.startClient.x) / zoom;
    const deltaY = (event.clientY - state.startClient.y) / zoom;
    const raw: SessionBounds = {
      position: {
        x: state.startBounds.position.x + (state.direction.includes("w") ? deltaX : 0),
        y: state.startBounds.position.y + (state.direction.includes("n") ? deltaY : 0)
      },
      size: {
        width: state.startBounds.size.width
          + (state.direction.includes("e") ? deltaX : 0)
          - (state.direction.includes("w") ? deltaX : 0),
        height: state.startBounds.size.height
          + (state.direction.includes("s") ? deltaY : 0)
          - (state.direction.includes("n") ? deltaY : 0)
      }
    };
    const constrained = constrainResize(raw, state.direction);
    applyLiveBounds(snapEnabled ? snapResize(constrained, state.direction, snapTargets) : constrained);
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizeState.current || resizeState.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    resizeState.current = null;
    onBoundsChange(session.id, liveBounds.current);
  };

  const applyLiveBounds = (bounds: SessionBounds): void => {
    liveBounds.current = bounds;
    setPosition(bounds.position);
    setSize(bounds.size);
  };

  const activateSummary = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    event.currentTarget.closest<HTMLElement>(".terminal-card")?.focus({ preventScroll: true });
    onSelect(session.id);
    if (focusActivation === "single") onActivate(session);
  };

  const activateSummaryDouble = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (focusActivation === "double") onActivate(session);
  };

  const activateCard = (event: React.MouseEvent<HTMLElement>): void => {
    if (focusActivation !== "single" || isCardControl(event.target)) return;
    onActivate(session);
  };

  const activateCardDouble = (event: React.MouseEvent<HTMLElement>): void => {
    if (focusActivation !== "double" || isCardControl(event.target)) return;
    onActivate(session);
  };

  const scheduleHoverFocus = (): void => {
    if (hoverFocusTimer.current !== null) window.clearTimeout(hoverFocusTimer.current);
    hoverFocusTimer.current = null;
    if (!hoverFocus || selected) return;
    hoverFocusTimer.current = window.setTimeout(() => {
      hoverFocusTimer.current = null;
      hoverSelected.current = true;
      hoverFocusTransition.current = "focus";
      onSelect(session.id);
    }, HOVER_FOCUS_DELAYS[hoverFocusSpeed]);
  };

  const scheduleHoverBlur = (): void => {
    if (hoverFocusTimer.current !== null) window.clearTimeout(hoverFocusTimer.current);
    hoverFocusTimer.current = null;
    if (!hoverFocus || !selected) return;
    hoverFocusTimer.current = window.setTimeout(() => {
      hoverFocusTimer.current = null;
      hoverFocusTransition.current = "blur";
      hoverSelected.current = false;
      onDeselect(session.id);
    }, HOVER_FOCUS_DELAYS[hoverFocusSpeed]);
  };

  const commitRename = async (): Promise<void> => {
    if (renameInFlight.current) return;
    const title = renameInput.current?.value.trim() ?? "";
    if (!title) {
      onRenameEnd();
      return;
    }
    renameInFlight.current = true;
    try {
      await onRename(session.id, title);
      onRenameEnd();
    } finally {
      renameInFlight.current = false;
    }
  };

  return (
    <article
      className={`terminal-card ${summaryMode ? "terminal-card--summary" : ""} ${selected ? "terminal-card--selected" : ""}`}
      data-interactive="true"
      data-canvas-zoom-surface="application"
      data-wheel-owner={summaryMode ? undefined : "local"}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        if (hoverFocusTimer.current !== null) window.clearTimeout(hoverFocusTimer.current);
        hoverFocusTimer.current = null;
        if (hoverFocusTransition.current === "focus") hoverSelected.current = false;
        hoverFocusTransition.current = null;
        onSelect(session.id);
        if (!renaming && !summaryMode && !(event.target as HTMLElement).closest("button, input")) {
          terminalRef.current?.focus();
        }
      }}
      onPointerEnter={scheduleHoverFocus}
      onPointerLeave={scheduleHoverBlur}
      onClick={activateCard}
      onDoubleClick={activateCardDouble}
      style={{
        width: size.width,
        height: size.height,
        transform: `translate(${position.x}px, ${position.y}px)`,
        "--summary-scale": summaryScale,
        "--terminal-background": terminalBackground
      } as React.CSSProperties}
    >
      <header
        className="terminal-card__header"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="terminal-card__identity">
          <ProviderIcon provider={session.provider} size="small" />
          {renaming ? (
            <input
              ref={bindRenameInput}
              className="terminal-card__rename"
              data-terminal-rename="true"
              defaultValue={session.title}
              autoFocus
              maxLength={80}
              aria-label={t(locale, "renameWindow")}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onRenameEnd();
                }
              }}
            />
          ) : (
            <strong title={session.titleCustomized ? session.title : session.cwd}>
              {session.titleCustomized ? session.title : compactPath(session.cwd)}
            </strong>
          )}
        </div>
        <div className="terminal-card__actions">
          <button className="terminal-card__action terminal-card__action--close" type="button" onClick={() => onDispose(session.id)} title={t(locale, "close")} aria-label={t(locale, "close")}><UiIcon name="close" size={16} /></button>
        </div>
      </header>
      <div className="terminal-card__surface" ref={terminalHost} />
      <button
        className="terminal-card__summary"
        type="button"
        onClick={activateSummary}
        onDoubleClick={activateSummaryDouble}
        title={session.title}
        aria-label={session.title}
        data-focus-activation={focusActivation}
      >
        <div className="terminal-card__summary-content">
          <ProviderIcon provider={session.provider} size="large" />
          <div className="terminal-card__summary-copy"><strong>{session.title}</strong><span>{sessionStatusLabel(locale, session.status)}</span></div>
        </div>
      </button>
      {RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          className={`terminal-card__resize-handle terminal-card__resize-handle--${direction}`}
          aria-hidden="true"
          onPointerDown={(event) => startResize(event, direction)}
          onPointerMove={resizeCard}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      ))}
    </article>
  );
}

function terminalTheme(palette: PaletteId): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const background = palette === "night" ? "#171a24" : "#202430";
  return {
    background,
    foreground: "#f7f4ec",
    cursor: palette === "lilac" ? "#bfc9ee" : "#b8cf99",
    selectionBackground: "#7b789966"
  };
}

function compactPath(path: string): string {
  const home = "/home/";
  if (!path.startsWith(home)) return path;
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? `~/${parts.slice(2).join("/")}` : path;
}

function isCardControl(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("button, input, .terminal-card__resize-handle"));
}
