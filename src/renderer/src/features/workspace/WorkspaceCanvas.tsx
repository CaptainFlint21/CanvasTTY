import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentProviderId,
  AppSettings,
  BrowserCanvasState,
  BrowserSnapshot,
  CameraState,
  HomeGridSize,
  HomeWidgetPlacement,
  InstalledPlugin,
  LimitsSnapshot,
  Point,
  SessionBounds,
  SessionSnapshot
} from "../../../../shared/contracts";
import { HomeZone } from "../home/HomeZone";
import { EDGE_PAN_SPEEDS, edgePanVelocity } from "./edgePan";
import { wheelZoomFactor } from "./zoom";
import { TerminalCard } from "../terminal/TerminalCard";
import { PluginCanvasCard } from "../plugins/PluginCanvasCard";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";
import type { LimitsLoadState } from "../home/homeModel";
import { homeGridPixelSize, homeLayoutFitsGrid } from "../home/homeLayout";
import { BrowserCard } from "../browser/BrowserCard";

interface WorkspaceCanvasProps {
  settings: AppSettings;
  mediaData: string | null;
  sessions: SessionSnapshot[];
  limits: LimitsSnapshot | null;
  limitsLoadState: LimitsLoadState;
  plugins: InstalledPlugin[];
  browser: BrowserSnapshot;
  browserViewVisible: boolean;
  homeEditing: boolean;
  camera: CameraState;
  onCameraChange(camera: CameraState): void;
  onGoHome(): void;
  onOpenSettings(): void;
  onOpenAgent(provider: AgentProviderId): void;
  onOpenTerminal(): void;
  onOpenBrowser(): void;
  onFocusSession(session: SessionSnapshot): void;
  activeSessionId: string | null;
  renamingSessionId: string | null;
  onSelectSession(id: string): void;
  onClearSessionSelection(): void;
  onDeselectSession(id: string): void;
  onRenameSession(id: string, title: string): Promise<void>;
  onRenameEnd(): void;
  onRequestMedia(): Promise<void>;
  onRemoveMedia(): Promise<void>;
  onHomeLayoutChange(layout: HomeWidgetPlacement[]): void;
  onHomeGridSizeChange(gridSize: HomeGridSize): void;
  onFinishHomeEdit(): void;
  onResetHomeLayout(): void;
  onPluginError(message: string): void;
  onPluginCanvasBoundsChange(id: string, bounds: SessionBounds): void;
  onDisposePluginCanvas(id: string): void;
  onFocusPluginCanvas(id: string): void;
  onSessionBoundsChange(id: string, bounds: SessionBounds): void;
  onDisposeSession(id: string): void;
  onBrowserBoundsChange(bounds: BrowserCanvasState): void;
  onFocusBrowser(): void;
  onCloseBrowser(): void;
}

interface PanState {
  pointerId: number;
  startClient: Point;
  startCamera: CameraState;
}

export function WorkspaceCanvas({
  settings,
  mediaData,
  sessions,
  limits,
  limitsLoadState,
  plugins,
  browser,
  browserViewVisible,
  homeEditing,
  camera,
  onCameraChange,
  onGoHome,
  onOpenSettings,
  onOpenAgent,
  onOpenTerminal,
  onOpenBrowser,
  onFocusSession,
  activeSessionId,
  renamingSessionId,
  onSelectSession,
  onClearSessionSelection,
  onDeselectSession,
  onRenameSession,
  onRenameEnd,
  onRequestMedia,
  onRemoveMedia,
  onHomeLayoutChange,
  onHomeGridSizeChange,
  onFinishHomeEdit,
  onResetHomeLayout,
  onPluginError,
  onPluginCanvasBoundsChange,
  onDisposePluginCanvas,
  onFocusPluginCanvas,
  onSessionBoundsChange,
  onDisposeSession,
  onBrowserBoundsChange,
  onFocusBrowser,
  onCloseBrowser
}: WorkspaceCanvasProps): React.JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const panState = useRef<PanState | null>(null);
  const [panning, setPanning] = useState(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const edgePointer = useRef<Point | null>(null);
  const edgeFrame = useRef<number | null>(null);
  const edgeLastTime = useRef(0);

  useEffect(() => () => {
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current);
  }, []);

  const edgePanStep = (time: number): void => {
    edgeFrame.current = null;
    const pointer = edgePointer.current;
    if (!pointer || panState.current || !settingsRef.current.edgePan) return;
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const hovered = document.elementFromPoint(pointer.x, pointer.y);
    if (hovered?.closest('[data-interactive="true"]')) return;
    const velocity = edgePanVelocity(pointer, bounds, {
      maxSpeed: EDGE_PAN_SPEEDS[settingsRef.current.edgePanSpeed]
    });
    if (!velocity) return;
    const dt = edgeLastTime.current === 0 ? 0 : Math.min(0.05, (time - edgeLastTime.current) / 1000);
    edgeLastTime.current = time;
    onCameraChange({
      ...cameraRef.current,
      x: cameraRef.current.x + velocity.x * dt,
      y: cameraRef.current.y + velocity.y * dt
    });
    edgeFrame.current = requestAnimationFrame(edgePanStep);
  };

  const trackEdgePointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!settings.edgePan) {
      edgePointer.current = null;
      return;
    }
    edgePointer.current = { x: event.clientX, y: event.clientY };
    if (edgeFrame.current === null) {
      edgeLastTime.current = 0;
      edgeFrame.current = requestAnimationFrame(edgePanStep);
    }
  };

  const startPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-interactive="true"]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panState.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startCamera: camera
    };
    setPanning(true);
  };

  const pan = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = panState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    onCameraChange({
      ...camera,
      x: state.startCamera.x + event.clientX - state.startClient.x,
      y: state.startCamera.y + event.clientY - state.startClient.y
    });
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (panState.current?.pointerId !== event.pointerId) return;
    panState.current = null;
    setPanning(false);
  };

  const zoomAt = useCallback((clientX: number, clientY: number, nextZoom: number): void => {
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const currentCamera = cameraRef.current;
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const worldX = (localX - currentCamera.x) / currentCamera.zoom;
    const worldY = (localY - currentCamera.y) / currentCamera.zoom;
    onCameraChange({
      zoom: nextZoom,
      x: localX - worldX * nextZoom,
      y: localY - worldY * nextZoom
    });
  }, [onCameraChange]);

  const zoomFromWheel = useCallback((clientX: number, clientY: number, wheelDeltaY: number): void => {
    const currentSettings = settingsRef.current;
    const deltaY = currentSettings.invertCanvasWheel ? -wheelDeltaY : wheelDeltaY;
    const nextZoom = clamp(
      cameraRef.current.zoom * wheelZoomFactor(deltaY, currentSettings.zoomSensitivity),
      0.2,
      1.35
    );
    zoomAt(clientX, clientY, nextZoom);
  }, [zoomAt]);

  useEffect(() => window.canvasTTY.browser.onCanvasWheel((event) => {
    if (!settingsRef.current.zoomOverApplications) return;
    zoomFromWheel(event.clientX, event.clientY, event.deltaY);
  }), [zoomFromWheel]);

  const zoomBy = (factor: number): void => {
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const nextZoom = clamp(cameraRef.current.zoom * factor, 0.2, 1.35);
    zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, nextZoom);
  };

  const homeBounds: SessionBounds = {
    position: { x: 0, y: 0 },
    size: homeGridPixelSize(settings.homeGridSize)
  };
  const homeLayoutValid = homeLayoutFitsGrid(settings.homeLayout, settings.homeGridSize);

  return (
    <div
      ref={viewport}
      className={`workspace pattern-${settings.pattern} ${panning ? "workspace--panning" : ""}`}
      onPointerDownCapture={(event) => {
        if (!(event.target as HTMLElement).closest(".terminal-card")) onClearSessionSelection();
      }}
      onPointerDown={startPan}
      onPointerMove={(event) => {
        pan(event);
        trackEdgePointer(event);
      }}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={() => {
        edgePointer.current = null;
      }}
      onWheelCapture={(event) => {
        if (!settings.zoomOverApplications || !isApplicationWheelTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        zoomFromWheel(event.clientX, event.clientY, event.deltaY);
      }}
      onWheel={(event) => {
        if (settings.zoomOverApplications && isApplicationWheelTarget(event.target)) return;
        if ((event.target as HTMLElement).closest('[data-wheel-owner="local"]')) return;
        event.preventDefault();
        zoomFromWheel(event.clientX, event.clientY, event.deltaY);
      }}
    >
      <div className="workspace__scene" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        <HomeZone
          settings={settings}
          browser={browser}
          mediaData={mediaData}
          sessions={sessions}
          limits={limits}
          limitsLoadState={limitsLoadState}
          plugins={plugins}
          editing={homeEditing}
          onOpenSettings={onOpenSettings}
          onOpenAgent={onOpenAgent}
          onOpenTerminal={onOpenTerminal}
          onOpenBrowser={onOpenBrowser}
          onFocusSession={onFocusSession}
          onRequestMedia={onRequestMedia}
          onRemoveMedia={onRemoveMedia}
          onLayoutChange={onHomeLayoutChange}
          onGridSizeChange={onHomeGridSizeChange}
          onPluginError={onPluginError}
        />
        <div
          className={`workspace__windows ${homeEditing ? "workspace__windows--hidden" : ""}`}
          aria-hidden={homeEditing}
        >
          {sessions.map((session) => (
            <TerminalCard
              key={session.id}
              session={session}
              locale={settings.locale}
              palette={settings.palette}
              zoom={camera.zoom}
              snapEnabled={settings.snapToGrid}
              focusActivation={settings.focusActivation}
              hoverFocus={settings.hoverFocus}
              hoverFocusSpeed={settings.hoverFocusSpeed}
              invertTerminalWheel={settings.invertTerminalWheel}
              zoomOverApplications={settings.zoomOverApplications}
              selected={activeSessionId === session.id}
              renaming={renamingSessionId === session.id}
              snapTargets={[
                homeBounds,
                ...sessions
                  .filter((candidate) => candidate.id !== session.id)
                  .map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...settings.pluginCanvas.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...(settings.browserCanvas ? [settings.browserCanvas] : [])
              ]}
              onActivate={onFocusSession}
              onSelect={onSelectSession}
              onDeselect={onDeselectSession}
              onRename={onRenameSession}
              onRenameEnd={onRenameEnd}
              onBoundsChange={onSessionBoundsChange}
              onDispose={onDisposeSession}
            />
          ))}
          {settings.pluginCanvas.map((instance) => {
            const plugin = plugins.find((candidate) => candidate.manifest.id === instance.pluginId && candidate.enabled);
            const contribution = plugin?.manifest.contributions.find((candidate) => candidate.id === instance.contributionId);
            if (!plugin || !contribution || contribution.kind !== "canvas-app") return null;
            return (
              <PluginCanvasCard
                key={instance.id}
                instance={instance}
                plugin={plugin}
                contribution={contribution}
                locale={settings.locale}
                palette={settings.palette}
                zoom={camera.zoom}
                snapEnabled={settings.snapToGrid}
                sessions={sessions}
                limits={limits}
                snapTargets={[
                  homeBounds,
                  ...sessions.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                  ...settings.pluginCanvas
                    .filter((candidate) => candidate.id !== instance.id)
                    .map((candidate) => ({ position: candidate.position, size: candidate.size })),
                  ...(settings.browserCanvas ? [settings.browserCanvas] : [])
                ]}
                onActivate={() => onFocusPluginCanvas(instance.id)}
                onBoundsChange={onPluginCanvasBoundsChange}
                onDispose={onDisposePluginCanvas}
                onOpenLauncher={(provider) => provider === "terminal" ? onOpenTerminal() : onOpenAgent(provider)}
                onError={onPluginError}
              />
            );
          })}
          {settings.browserCanvas && (
            <BrowserCard
              browser={browser}
              bounds={settings.browserCanvas}
              locale={settings.locale}
              zoom={camera.zoom}
              camera={camera}
              visible={browserViewVisible && !homeEditing}
              snapEnabled={settings.snapToGrid}
              zoomOverApplications={settings.zoomOverApplications}
              snapTargets={[
                homeBounds,
                ...sessions.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...settings.pluginCanvas.map((candidate) => ({ position: candidate.position, size: candidate.size }))
              ]}
              onBoundsChange={onBrowserBoundsChange}
              onActivate={onFocusBrowser}
              onClose={onCloseBrowser}
              onError={onPluginError}
            />
          )}
        </div>
      </div>

      {homeEditing && (
        <div className="home-editor-toolbar" data-interactive="true">
          <strong>{t(settings.locale, "homeEditor")}</strong>
          <button type="button" onClick={onResetHomeLayout}>{t(settings.locale, "resetHome")}</button>
          <button
            className="home-editor-toolbar__done"
            type="button"
            disabled={!homeLayoutValid}
            title={homeLayoutValid ? undefined : t(settings.locale, "homeLayoutOutside")}
            onClick={onFinishHomeEdit}
          >{t(settings.locale, "doneEditing")}</button>
        </div>
      )}

      <div className="canvas-controls" data-interactive="true">
        <button type="button" onClick={onGoHome} title={t(settings.locale, "home")}><UiIcon name="home" size={17} /></button>
        <button type="button" onClick={() => zoomBy(0.82)} title={t(settings.locale, "zoomOut")}><UiIcon name="zoom-out" size={17} /></button>
        <button type="button" onClick={() => zoomBy(1.22)} title={t(settings.locale, "zoomIn")}><UiIcon name="zoom-in" size={17} /></button>
      </div>
      {settings.showShortcutHints && (
        <aside className="shortcut-hints" aria-label={t(settings.locale, "keyboardShortcuts")}>
          <div><kbd>{settings.shortcuts.home}</kbd><span>{t(settings.locale, "homeShortcut")}</span></div>
          <div><kbd>{settings.shortcuts.renameWindow}</kbd><span>{t(settings.locale, "renameWindow")}</span></div>
        </aside>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isApplicationWheelTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && target.closest('[data-canvas-zoom-surface="application"]') !== null;
}
