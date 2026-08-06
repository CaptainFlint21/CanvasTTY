import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentProviderId,
  AppSettings,
  BrowserCanvasState,
  BrowserSnapshot,
  CameraState,
  HomeGridSize,
  HomeWidgetPlacement,
  InstalledPlugin,
  LaunchProfileId,
  LimitsSnapshot,
  Point,
  PluginContribution,
  PluginGridSize,
  PluginInstallPreview,
  ProviderId,
  SessionBounds,
  SessionMetadata,
  SessionSnapshot
} from "../../shared/contracts";
import {
  DEFAULT_HOME_GRID_SIZE,
  DEFAULT_HOME_LAYOUT,
  DEFAULT_SHORTCUTS
} from "../../shared/contracts";
import { TitleBar } from "./components/TitleBar";
import { Toast } from "./components/Toast";
import { AgentLaunchDialog } from "./features/launcher/AgentLaunchDialog";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { WorkspaceCanvas } from "./features/workspace/WorkspaceCanvas";
import type { LimitsLoadState } from "./features/home/homeModel";
import { t } from "./lib/i18n";
import { isRenameInputTarget, isShortcutCaptureTarget, matchesShortcut } from "./lib/shortcuts";
import { homeGridPixelSize, homeLayoutFitsGrid, placeHomeWidget } from "./features/home/homeLayout";

interface HomeEditDraft {
  homeGridSize: HomeGridSize;
  homeLayout: HomeWidgetPlacement[];
}

const FALLBACK_SETTINGS: AppSettings = {
  locale: "ru",
  palette: "sage",
  pattern: "dots",
  snapToGrid: true,
  invertTerminalWheel: true,
  invertCanvasWheel: false,
  edgePan: false,
  edgePanSpeed: "normal",
  zoomSensitivity: "normal",
  zoomOverApplications: false,
  focusActivation: "off",
  hoverFocus: false,
  hoverFocusSpeed: "normal",
  showShortcutHints: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  mediaPath: null,
  mediaFit: "cover",
  lastDirectory: "/",
  acknowledgedDangerousProfiles: [],
  homeGridSize: { ...DEFAULT_HOME_GRID_SIZE },
  homeLayout: structuredClone(DEFAULT_HOME_LAYOUT),
  pluginCanvas: [],
  browserCanvas: null,
  browserAgentAccess: true,
  browserRestoreTabs: true
};

const EMPTY_BROWSER_SNAPSHOT: BrowserSnapshot = {
  tabs: [],
  activeTabId: null,
  visible: false,
  agents: [],
  downloads: [],
  pendingDialog: null
};

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState(FALLBACK_SETTINGS);
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [limits, setLimits] = useState<LimitsSnapshot | null>(null);
  const [limitsLoadState, setLimitsLoadState] = useState<LimitsLoadState>("loading");
  const [mediaData, setMediaData] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [browser, setBrowser] = useState<BrowserSnapshot>(EMPTY_BROWSER_SNAPSHOT);
  const [camera, setCamera] = useState<CameraState>(() => homeCamera(DEFAULT_HOME_GRID_SIZE));
  const isHomeCamera = useRef(true);
  const [launchProvider, setLaunchProvider] = useState<AgentProviderId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeEditDraft, setHomeEditDraft] = useState<HomeEditDraft | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const showToast = useCallback((message: string): void => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2_600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let active = true;
    const browserApi = window.canvasTTY.browser;
    const unsubscribeSession = window.canvasTTY.terminal.onSession(({ session }) => {
      if (active) setSessions((current) => upsertSession(current, session));
    });
    const unsubscribeRemoved = window.canvasTTY.terminal.onRemoved(({ id }) => {
      if (!active) return;
      setSessions((current) => current.filter((session) => session.id !== id));
      setActiveSessionId((current) => current === id ? null : current);
      setRenamingSessionId((current) => current === id ? null : current);
    });

    void Promise.all([
      window.canvasTTY.settings.get(),
      window.canvasTTY.terminal.list(),
      window.canvasTTY.plugins.list()
    ])
      .then(async ([loadedSettings, loadedSessions, loadedPlugins]) => {
        if (!active) return;
        setSettings(loadedSettings);
        setSessions(loadedSessions);
        setPlugins(loadedPlugins);
        if (loadedSettings.browserCanvas && browserApi) {
          const browserState = await browserApi.open();
          if (active) setBrowser(browserState);
        }
        if (isHomeCamera.current) setCamera(homeCamera(loadedSettings.homeGridSize));
        if (loadedSettings.mediaPath) {
          const data = await window.canvasTTY.media.read(loadedSettings.mediaPath);
          if (active) setMediaData(data);
        }
      })
      .catch((error) => showToast(error instanceof Error ? error.message : "CanvasTTY initialization failed"))
      .finally(() => active && setReady(true));

    return () => {
      active = false;
      unsubscribeSession();
      unsubscribeRemoved();
    };
  }, [showToast]);

  useEffect(() => {
    const browserApi = window.canvasTTY.browser;
    if (!browserApi) return;
    const unsubscribe = browserApi.onState(({ snapshot }) => setBrowser(snapshot));
    void browserApi.getState().then(setBrowser).catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    let requestRunning = false;
    let timer: number | null = null;

    const refreshLimits = async (): Promise<void> => {
      if (requestRunning) return;
      requestRunning = true;
      try {
        const snapshot = await window.canvasTTY.limits.get();
        if (!active) return;
        setLimits(snapshot);
        setLimitsLoadState("ready");
      } catch {
        if (active) setLimitsLoadState("error");
      } finally {
        requestRunning = false;
      }
    };

    const refreshAndSchedule = async (): Promise<void> => {
      await refreshLimits();
      if (active) timer = window.setTimeout(() => void refreshAndSchedule(), 60_000);
    };

    void refreshAndSchedule();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const recenterHome = (): void => {
      if (isHomeCamera.current) setCamera(homeCamera(settings.homeGridSize));
    };
    window.addEventListener("resize", recenterHome);
    return () => window.removeEventListener("resize", recenterHome);
  }, [settings.homeGridSize]);

  const saveSettings = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    try {
      const updated = await window.canvasTTY.settings.update(patch);
      setSettings(updated);
    } catch {
      showToast(t(settings.locale, "settingsFailed"));
    }
  }, [settings.locale, showToast]);

  const createSession = useCallback(async (
    provider: ProviderId,
    profile: LaunchProfileId,
    cwd: string
  ): Promise<SessionSnapshot> => {
    const position = nextSessionPosition(sessions.length, settings.homeGridSize);
    const session = await window.canvasTTY.terminal.create({ provider, profile, cwd, position });
    setSessions((current) => upsertSnapshot(current, session));
    setActiveSessionId(session.id);
    await saveSettings({ lastDirectory: cwd });
    isHomeCamera.current = false;
    setCamera(focusCamera(position, session.size));
    return session;
  }, [sessions.length, saveSettings, settings.homeGridSize]);

  const openTerminal = useCallback(async (): Promise<void> => {
    try {
      await createSession("terminal", "normal", settings.lastDirectory);
      showToast(t(settings.locale, "terminalStarted"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "launchFailed"));
    }
  }, [createSession, settings.lastDirectory, settings.locale, showToast]);

  useEffect(() => window.canvasTTY.plugins.onOpenLauncher(({ provider }) => {
    if (provider === "terminal") void openTerminal();
    else setLaunchProvider(provider);
  }), [openTerminal]);

  const launchAgent = useCallback(async (
    provider: AgentProviderId,
    profile: LaunchProfileId,
    cwd: string
  ): Promise<void> => {
    await createSession(provider, profile, cwd);
    showToast(`${t(settings.locale, "sessionStarted")}: ${provider}`);
  }, [createSession, settings.locale, showToast]);

  const acknowledgeDanger = useCallback(async (provider: AgentProviderId): Promise<void> => {
    if (settings.acknowledgedDangerousProfiles.includes(provider)) return;
    await saveSettings({
      acknowledgedDangerousProfiles: [...settings.acknowledgedDangerousProfiles, provider]
    });
  }, [saveSettings, settings.acknowledgedDangerousProfiles]);

  const requestMedia = useCallback(async (): Promise<void> => {
    try {
      const selection = await window.canvasTTY.dialog.pickMedia();
      if (!selection) return;

      const updated = await window.canvasTTY.settings.update({ mediaPath: selection.path });
      setSettings(updated);
      setMediaData(selection.dataUrl);
    } catch {
      showToast(t(settings.locale, "mediaFailed"));
    }
  }, [settings.locale, showToast]);

  const removeMedia = useCallback(async (): Promise<void> => {
    try {
      const updated = await window.canvasTTY.settings.update({ mediaPath: null });
      setSettings(updated);
      setMediaData(null);
    } catch {
      showToast(t(settings.locale, "mediaFailed"));
    }
  }, [settings.locale, showToast]);

  const changeSessionBounds = useCallback((id: string, bounds: SessionBounds): void => {
    setSessions((current) => current.map((session) => session.id === id
      ? { ...session, position: bounds.position, size: bounds.size }
      : session));
    window.canvasTTY.terminal.setBounds(id, bounds);
  }, []);

  const changePluginCanvasBounds = useCallback((id: string, bounds: SessionBounds): void => {
    const pluginCanvas = settings.pluginCanvas.map((instance) => instance.id === id
      ? { ...instance, position: bounds.position, size: bounds.size }
      : instance);
    setSettings((current) => ({ ...current, pluginCanvas }));
    void saveSettings({ pluginCanvas });
  }, [saveSettings, settings.pluginCanvas]);

  const changeBrowserBounds = useCallback((browserCanvas: BrowserCanvasState): void => {
    setSettings((current) => ({ ...current, browserCanvas }));
    void saveSettings({ browserCanvas });
  }, [saveSettings]);

  const disposePluginCanvas = useCallback((id: string): void => {
    void saveSettings({ pluginCanvas: settings.pluginCanvas.filter((instance) => instance.id !== id) });
  }, [saveSettings, settings.pluginCanvas]);

  const focusPluginCanvas = useCallback((id: string): void => {
    const instance = settings.pluginCanvas.find((candidate) => candidate.id === id);
    if (!instance) return;
    isHomeCamera.current = false;
    setCamera(focusCamera(instance.position, instance.size));
  }, [settings.pluginCanvas]);

  const openBrowser = useCallback(async (): Promise<void> => {
    try {
      const browserApi = window.canvasTTY.browser;
      if (!browserApi) {
        showToast(t(settings.locale, "browserRestartRequired"));
        return;
      }
      const homeSize = homeGridPixelSize(settings.homeGridSize);
      const browserCanvas = settings.browserCanvas ?? {
        position: {
          x: homeSize.width + 160 + ((sessions.length + settings.pluginCanvas.length) % 2) * 760,
          y: Math.floor((sessions.length + settings.pluginCanvas.length) / 2) * 500 + 20
        },
        size: { width: 920, height: 620 }
      };
      const snapshot = await browserApi.open();
      setBrowser(snapshot);
      if (!settings.browserCanvas) await saveSettings({ browserCanvas });
      setSettingsOpen(false);
      isHomeCamera.current = false;
      setCamera(focusCamera(browserCanvas.position, browserCanvas.size));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "browserActionFailed"));
    }
  }, [saveSettings, sessions.length, settings.browserCanvas, settings.homeGridSize, settings.locale, settings.pluginCanvas.length, showToast]);

  const closeBrowser = useCallback(async (): Promise<void> => {
    try {
      const browserApi = window.canvasTTY.browser;
      if (!browserApi) return;
      await browserApi.close();
      await saveSettings({ browserCanvas: null });
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "browserActionFailed"));
    }
  }, [saveSettings, settings.locale, showToast]);

  const focusBrowser = useCallback((): void => {
    if (!settings.browserCanvas) return;
    isHomeCamera.current = false;
    setCamera(focusCamera(settings.browserCanvas.position, settings.browserCanvas.size));
  }, [settings.browserCanvas]);

  const disposeSession = useCallback((id: string): void => {
    void window.canvasTTY.terminal.dispose(id);
    setSessions((current) => current.filter((session) => session.id !== id));
    setActiveSessionId((current) => current === id ? null : current);
    setRenamingSessionId((current) => current === id ? null : current);
  }, []);

  const focusSession = useCallback((session: SessionSnapshot): void => {
    setActiveSessionId(session.id);
    isHomeCamera.current = false;
    setCamera(focusCamera(session.position, session.size));
  }, []);

  const renameSession = useCallback(async (id: string, title: string): Promise<void> => {
    try {
      const metadata = await window.canvasTTY.terminal.rename(id, title);
      setSessions((current) => upsertSession(current, metadata));
    } catch {
      showToast(t(settings.locale, "renameFailed"));
    }
  }, [settings.locale, showToast]);

  const changeCamera = useCallback((nextCamera: CameraState): void => {
    isHomeCamera.current = false;
    setCamera(nextCamera);
  }, []);

  const goHome = useCallback((): void => {
    isHomeCamera.current = true;
    setCamera(homeCamera(homeEditDraft?.homeGridSize ?? settings.homeGridSize));
  }, [homeEditDraft?.homeGridSize, settings.homeGridSize]);

  const changeHomeLayout = useCallback((homeLayout: HomeWidgetPlacement[]): void => {
    setHomeEditDraft((current) => current ? { ...current, homeLayout } : current);
  }, []);

  const changeHomeGridSize = useCallback((homeGridSize: HomeGridSize): void => {
    setHomeEditDraft((current) => current ? { ...current, homeGridSize } : current);
    isHomeCamera.current = true;
    setCamera(homeCamera(homeGridSize));
  }, []);

  const resetHomeLayout = useCallback((): void => {
    const homeGridSize = { ...DEFAULT_HOME_GRID_SIZE };
    setHomeEditDraft((current) => current ? {
      homeGridSize,
      homeLayout: structuredClone(DEFAULT_HOME_LAYOUT)
    } : current);
    isHomeCamera.current = true;
    setCamera(homeCamera(homeGridSize));
  }, []);

  const toggleHomeWidget = useCallback(async (
    widgetId: string,
    defaultSize: PluginGridSize
  ): Promise<void> => {
    const exists = settings.homeLayout.some((placement) => placement.widgetId === widgetId);
    if (exists) {
      if (widgetId === "core.settings") return;
      await saveSettings({
        homeLayout: settings.homeLayout.filter((placement) => placement.widgetId !== widgetId)
      });
      return;
    }

    const result = placeHomeWidget(
      settings.homeLayout,
      widgetId,
      defaultSize,
      settings.homeGridSize
    );
    if (!result) {
      showToast(t(settings.locale, "homeLayoutFull"));
      return;
    }
    await saveSettings({
      homeGridSize: result.gridSize,
      homeLayout: [...settings.homeLayout, result.placement]
    });
  }, [saveSettings, settings.homeGridSize, settings.homeLayout, settings.locale, showToast]);

  const previewPlugin = useCallback((sourceUrl: string): Promise<PluginInstallPreview> => (
    window.canvasTTY.plugins.previewInstall(sourceUrl)
  ), []);

  const installPlugin = useCallback(async (token: string): Promise<void> => {
    const installed = await window.canvasTTY.plugins.install(token);
    setPlugins((current) => [...current.filter((plugin) => plugin.manifest.id !== installed.manifest.id), installed]);

    let homeLayout = settings.homeLayout;
    let homeGridSize = settings.homeGridSize;
    for (const contribution of installed.manifest.contributions) {
      if (contribution.kind !== "home-widget") continue;
      const widgetId = `plugin:${installed.manifest.id}:${contribution.id}`;
      const result = placeHomeWidget(homeLayout, widgetId, contribution.defaultSize, homeGridSize);
      if (!result) continue;
      homeGridSize = result.gridSize;
      homeLayout = [...homeLayout, result.placement];
    }
    if (homeLayout !== settings.homeLayout) await saveSettings({ homeGridSize, homeLayout });
    showToast(`${t(settings.locale, "pluginInstalled")}: ${installed.manifest.name}`);
  }, [saveSettings, settings.homeGridSize, settings.homeLayout, settings.locale, showToast]);

  const setPluginEnabled = useCallback(async (pluginId: string, enabled: boolean): Promise<void> => {
    const updated = await window.canvasTTY.plugins.setEnabled(pluginId, enabled);
    setPlugins((current) => current.map((plugin) => plugin.manifest.id === pluginId ? updated : plugin));
  }, []);

  const uninstallPlugin = useCallback(async (pluginId: string): Promise<void> => {
    await window.canvasTTY.plugins.uninstall(pluginId);
    setPlugins((current) => current.filter((plugin) => plugin.manifest.id !== pluginId));
    await saveSettings({
      homeLayout: settings.homeLayout.filter((placement) => !placement.widgetId.startsWith(`plugin:${pluginId}:`)),
      pluginCanvas: settings.pluginCanvas.filter((instance) => instance.pluginId !== pluginId)
    });
    showToast(t(settings.locale, "pluginRemoved"));
  }, [saveSettings, settings.homeLayout, settings.locale, settings.pluginCanvas, showToast]);

  const openPluginContribution = useCallback(async (
    plugin: InstalledPlugin,
    contribution: PluginContribution
  ): Promise<void> => {
    if (contribution.kind === "window") {
      await window.canvasTTY.plugins.openWindow(plugin.manifest.id, contribution.id);
      return;
    }
    if (contribution.kind === "home-widget") {
      await toggleHomeWidget(`plugin:${plugin.manifest.id}:${contribution.id}`, contribution.defaultSize);
      return;
    }

    const index = settings.pluginCanvas.length;
    const homeSize = homeGridPixelSize(settings.homeGridSize);
    const instance = {
      id: crypto.randomUUID(),
      pluginId: plugin.manifest.id,
      contributionId: contribution.id,
      title: contribution.title,
      position: {
        x: homeSize.width + 160 + (index % 2) * 760,
        y: Math.floor(index / 2) * 500 + 20
      },
      size: contribution.defaultSize
    };
    await saveSettings({ pluginCanvas: [...settings.pluginCanvas, instance] });
    setSettingsOpen(false);
    isHomeCamera.current = false;
    setCamera(focusCamera(instance.position, instance.size));
  }, [saveSettings, settings.homeGridSize, settings.pluginCanvas, toggleHomeWidget]);

  const startHomeEditor = useCallback((): void => {
    setSettingsOpen(false);
    setHomeEditDraft({
      homeGridSize: { ...settings.homeGridSize },
      homeLayout: structuredClone(settings.homeLayout)
    });
    isHomeCamera.current = true;
    setCamera(homeCamera(settings.homeGridSize));
  }, [settings.homeGridSize, settings.homeLayout]);

  const finishHomeEditor = useCallback(async (): Promise<void> => {
    if (!homeEditDraft || !homeLayoutFitsGrid(homeEditDraft.homeLayout, homeEditDraft.homeGridSize)) return;
    try {
      const updated = await window.canvasTTY.settings.update(homeEditDraft);
      setSettings(updated);
      setHomeEditDraft(null);
    } catch {
      showToast(t(settings.locale, "settingsFailed"));
    }
  }, [homeEditDraft, settings.locale, showToast]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (event.repeat || isShortcutCaptureTarget(event.target) || isRenameInputTarget(event.target)) return;
      if (matchesShortcut(event, settings.shortcuts.home)) {
        event.preventDefault();
        event.stopPropagation();
        goHome();
        return;
      }
      if (matchesShortcut(event, settings.shortcuts.renameWindow)) {
        event.preventDefault();
        event.stopPropagation();
        if (!activeSessionId) {
          showToast(t(settings.locale, "selectWindowToRename"));
          return;
        }
        setRenamingSessionId(activeSessionId);
      }
    };

    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, [activeSessionId, goHome, settings.locale, settings.shortcuts, showToast]);

  const rootClasses = useMemo(
    () => `app app--${settings.palette}`,
    [settings.palette]
  );
  const workspaceSettings = useMemo(() => homeEditDraft ? {
    ...settings,
    homeGridSize: homeEditDraft.homeGridSize,
    homeLayout: homeEditDraft.homeLayout
  } : settings, [homeEditDraft, settings]);

  return (
    <div className={rootClasses}>
      <TitleBar locale={settings.locale} />
      <main className="app__content">
        {!ready && <div className="loading-screen">{t(settings.locale, "loading")}</div>}
        <WorkspaceCanvas
          settings={workspaceSettings}
          mediaData={mediaData}
          sessions={sessions}
          limits={limits}
          limitsLoadState={limitsLoadState}
          plugins={plugins}
          browser={browser}
          browserViewVisible={!settingsOpen && launchProvider === null}
          homeEditing={homeEditDraft !== null}
          camera={camera}
          onCameraChange={changeCamera}
          onGoHome={goHome}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAgent={setLaunchProvider}
          onOpenTerminal={() => void openTerminal()}
          onOpenBrowser={() => void openBrowser()}
          onRequestMedia={requestMedia}
          onRemoveMedia={removeMedia}
          onHomeLayoutChange={changeHomeLayout}
          onHomeGridSizeChange={changeHomeGridSize}
          onFinishHomeEdit={() => void finishHomeEditor()}
          onResetHomeLayout={resetHomeLayout}
          onPluginError={showToast}
          onPluginCanvasBoundsChange={changePluginCanvasBounds}
          onDisposePluginCanvas={disposePluginCanvas}
          onFocusPluginCanvas={focusPluginCanvas}
          onFocusSession={focusSession}
          activeSessionId={activeSessionId}
          renamingSessionId={renamingSessionId}
          onSelectSession={setActiveSessionId}
          onClearSessionSelection={() => setActiveSessionId(null)}
          onDeselectSession={(id) => setActiveSessionId((current) => current === id ? null : current)}
          onRenameSession={renameSession}
          onRenameEnd={() => setRenamingSessionId(null)}
          onSessionBoundsChange={changeSessionBounds}
          onDisposeSession={disposeSession}
          onBrowserBoundsChange={changeBrowserBounds}
          onFocusBrowser={focusBrowser}
          onCloseBrowser={() => void closeBrowser()}
        />
      </main>

      <AgentLaunchDialog
        provider={launchProvider}
        settings={settings}
        onClose={() => setLaunchProvider(null)}
        onAcknowledge={acknowledgeDanger}
        onLaunch={launchAgent}
      />
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        plugins={plugins}
        browser={browser}
        onClose={() => setSettingsOpen(false)}
        onChange={saveSettings}
        onPreviewPlugin={previewPlugin}
        onInstallPlugin={installPlugin}
        onSetPluginEnabled={setPluginEnabled}
        onUninstallPlugin={uninstallPlugin}
        onOpenPluginContribution={openPluginContribution}
        onToggleHomeWidget={toggleHomeWidget}
        onEditHome={startHomeEditor}
      />
      <Toast message={toast} />
    </div>
  );
}

function upsertSession(sessions: SessionSnapshot[], metadata: SessionMetadata): SessionSnapshot[] {
  const existing = sessions.find((session) => session.id === metadata.id);
  const next: SessionSnapshot = { ...metadata, buffer: existing?.buffer ?? "" };
  return upsertSnapshot(sessions, next);
}

function upsertSnapshot(sessions: SessionSnapshot[], next: SessionSnapshot): SessionSnapshot[] {
  const index = sessions.findIndex((session) => session.id === next.id);
  if (index < 0) return [...sessions, next];
  return sessions.map((session) => session.id === next.id ? next : session);
}

function nextSessionPosition(index: number, homeGridSize: HomeGridSize): Point {
  const homeSize = homeGridPixelSize(homeGridSize);
  return {
    x: homeSize.width + 160 + (index % 2) * 760,
    y: Math.floor(index / 2) * 500 + 20
  };
}

function homeCamera(homeGridSize: HomeGridSize): CameraState {
  const viewportWidth = typeof window === "undefined" ? 1360 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 820 : window.innerHeight - 44;
  const homeSize = homeGridPixelSize(homeGridSize);
  const availableZoom = Math.min(
    1,
    (viewportWidth - 80) / homeSize.width,
    (viewportHeight - 72) / homeSize.height
  );
  const zoom = [1, 0.9, 0.8, 0.75, 2 / 3, 0.5, 0.4, 1 / 3, 0.28, 0.25, 0.2]
    .find((step) => step <= availableZoom) ?? 0.2;
  return {
    zoom,
    x: Math.round((viewportWidth - homeSize.width * zoom) / 2),
    y: Math.round((viewportHeight - homeSize.height * zoom) / 2)
  };
}

function focusCamera(position: Point, size: { width: number; height: number }): CameraState {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight - 44;
  const zoom = 0.92;
  return {
    zoom,
    x: viewportWidth / 2 - (position.x + size.width / 2) * zoom,
    y: viewportHeight / 2 - (position.y + size.height / 2) * zoom
  };
}
