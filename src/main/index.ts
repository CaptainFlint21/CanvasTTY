import { join } from "node:path";
import { app, BrowserWindow, dialog, protocol } from "electron";
import { IPC } from "../shared/contracts";
import { registerIpc } from "./ipc/registerIpc";
import { SettingsStore } from "./services/SettingsStore";
import { TerminalManager } from "./services/TerminalManager";
import { LimitsService } from "./services/LimitsService";
import { augmentCliPath } from "./services/cliEnvironment";
import { PluginManager } from "./services/PluginManager";
import { PluginMediaService } from "./services/PluginMediaService";
import { BrowserService } from "./services/BrowserService";
import { runBrowserElectronSmoke } from "./services/browser/BrowserElectronSmoke";
import {
  runProviderElectronSmoke,
  type ProviderSmokeTarget
} from "./services/browser/ProviderElectronSmoke";
import {
  AgentBrowserBridge,
  AgentGateway,
  WINDOWS_PIPE_HOST_FILENAME,
  WINDOWS_AGENT_GATEWAY_UNAVAILABLE,
  supportsAgentGatewayPlatform
} from "./services/agent-browser";
import {
  recoverKimiConfigurationOnStartup,
  resolveKimiHomeDirectory
} from "./services/agent-browser/ProviderLaunch";
import type { StdioHelperLaunch } from "./services/agent-browser/ProviderLaunch";
import { startupPageUrl } from "./startupPage";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "canvastty-plugin",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  },
  {
    scheme: "canvastty-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// macOS native occlusion can defer a child WebContentsView's CDP input ACK for
// several seconds even when that view disables renderer background throttling.
// Agent-controlled tabs must remain responsive while the canvas is covered.
if (process.platform === "darwin") {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
}

let mainWindow: BrowserWindow | null = null;
let terminalManager: TerminalManager | null = null;
let limitsService: LimitsService | null = null;
let pluginManager: PluginManager | null = null;
let pluginMediaService: PluginMediaService | null = null;
let browserService: BrowserService | null = null;
let agentGateway: AgentGateway | null = null;
let agentBrowserBridge: AgentBrowserBridge | null = null;
let agentBrowserHelper: StdioHelperLaunch | null = null;
const pluginWindows = new Map<BrowserWindow, string>();
let servicesReady = false;
let startupRunning = false;
let shutdownRunning = false;
let shutdownComplete = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 920,
    minHeight: 620,
    show: true,
    frame: false,
    backgroundColor: "#aaa7a2",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (currentUrl && url !== currentUrl) event.preventDefault();
  });

  await window.loadURL(startupPageUrl({ locale: app.getLocale() }));

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

async function initializeServices(): Promise<void> {
  augmentCliPath();
  // Recovery is independent of gateway availability: an interrupted Kimi fallback
  // must be restored before any new terminal can launch, including on Windows.
  const kimiHomeDirectory = resolveKimiHomeDirectory();
  recoverKimiConfigurationOnStartup(kimiHomeDirectory);
  const userDataPath = app.getPath("userData");
  const settings = new SettingsStore(userDataPath, app.getLocale());
  await settings.load();

  browserService = new BrowserService(() => mainWindow, {
    userDataPath,
    restoreTabs: settings.get().browserRestoreTabs,
    ...(process.env.CANVASTTY_BROWSER_SMOKE_URL
      ? { downloadRoot: join(userDataPath, "browser-smoke-downloads") }
      : {})
  });
  await browserService.ready();

  if (supportsAgentGatewayPlatform()) {
    const runtimeDirectory = join(userDataPath, "browser", "runtime");
    const windowsHostPath = process.platform === "win32"
      ? app.isPackaged
        ? join(process.resourcesPath, "agent-browser", WINDOWS_PIPE_HOST_FILENAME)
        : join(app.getAppPath(), "build", "windows-agent-pipe-host", WINDOWS_PIPE_HOST_FILENAME)
      : undefined;
    agentGateway = new AgentGateway(browserService.core, { runtimeDirectory, windowsHostPath });
    agentGateway.setEnabled(settings.get().browserAgentAccess);
    await agentGateway.start();
    const helperPath = app.isPackaged
      ? join(process.resourcesPath, "agent-browser", "mcp-helper.mjs")
      : join(app.getAppPath(), "src", "agent-browser", "mcp-helper.mjs");
    agentBrowserHelper = {
      command: process.execPath,
      args: [helperPath],
      env: { ELECTRON_RUN_AS_NODE: "1" }
    };
    agentBrowserBridge = new AgentBrowserBridge(agentGateway, {
      helper: agentBrowserHelper,
      runtimeDirectory,
      kimiHomeDirectory,
      ...(process.env.CANVASTTY_PROVIDER_SMOKE_KIMI_COMMAND
        ? { kimiCommand: process.env.CANVASTTY_PROVIDER_SMOKE_KIMI_COMMAND }
        : {})
    });
  } else {
    console.warn(WINDOWS_AGENT_GATEWAY_UNAVAILABLE);
  }

  terminalManager = new TerminalManager((channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  }, agentBrowserBridge ?? undefined);
  limitsService = new LimitsService(app.getVersion());
  pluginManager = new PluginManager(app.getPath("userData"));
  await pluginManager.load();
  pluginMediaService = new PluginMediaService(
    app.getPath("userData"),
    (pluginId, permission) => pluginManager!.assertPermission(pluginId, permission)
  );
  await pluginMediaService.load();
  protocol.handle("canvastty-plugin", (request) => pluginManager!.protocolResponse(request.url));
  protocol.handle("canvastty-media", (request) => pluginMediaService!.protocolResponse(request));
  registerIpc({
    settings,
    terminals: terminalManager,
    limits: limitsService,
    plugins: pluginManager,
    pluginMedia: pluginMediaService,
    browser: browserService,
    getMainWindow: () => mainWindow,
    applyBrowserSettings: (next) => {
      agentBrowserBridge?.setEnabled(next.browserAgentAccess);
      browserService?.setRestoreTabs(next.browserRestoreTabs);
    },
    openPluginWindow,
    closePluginWindows,
    requestPluginLauncher
  });
  servicesReady = true;
}

async function loadApplication(window: BrowserWindow): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  if (process.env.CANVASTTY_SMOKE_TEST === "1") {
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    );
    console.log("CANVASTTY_SMOKE_READY");
    app.quit();
  }
  const browserSmokeUrl = process.env.CANVASTTY_BROWSER_SMOKE_URL;
  if (browserSmokeUrl && browserService) {
    await runBrowserElectronSmoke(browserService, browserSmokeUrl, app.getPath("userData"));
    console.log("CANVASTTY_BROWSER_SMOKE_READY");
    app.quit();
  }
  const providerSmoke = process.env.CANVASTTY_PROVIDER_SMOKE;
  if (providerSmoke) {
    if (!agentBrowserBridge || !agentBrowserHelper) {
      throw new Error("Provider smoke requires the local agent browser gateway.");
    }
    const targets = parseProviderSmokeTargets(providerSmoke);
    await runProviderElectronSmoke({
      bridge: agentBrowserBridge,
      helper: agentBrowserHelper,
      cwd: process.env.CANVASTTY_PROVIDER_SMOKE_CWD || app.getPath("temp"),
      targets,
      commands: {
        ...(process.env.CANVASTTY_PROVIDER_SMOKE_KIMI_COMMAND
          ? { kimi: process.env.CANVASTTY_PROVIDER_SMOKE_KIMI_COMMAND }
          : {}),
        ...(process.env.CANVASTTY_PROVIDER_SMOKE_CLAUDE_COMMAND
          ? { claude: process.env.CANVASTTY_PROVIDER_SMOKE_CLAUDE_COMMAND }
          : {}),
        ...(process.env.CANVASTTY_PROVIDER_SMOKE_CODEX_COMMAND
          ? { codex: process.env.CANVASTTY_PROVIDER_SMOKE_CODEX_COMMAND }
          : {})
      }
    });
    console.log("CANVASTTY_PROVIDER_SMOKE_READY");
    app.quit();
  }
}

function parseProviderSmokeTargets(value: string): ProviderSmokeTarget[] {
  const allowed = new Set<ProviderSmokeTarget>(["direct", "claude", "codex", "kimi"]);
  const targets = value.split(",").map((target) => target.trim()).filter(Boolean);
  if (targets.length === 0 || targets.some((target) => !allowed.has(target as ProviderSmokeTarget))) {
    throw new Error("CANVASTTY_PROVIDER_SMOKE contains an unsupported target.");
  }
  return targets as ProviderSmokeTarget[];
}

async function startApplication(): Promise<void> {
  if (startupRunning) return;
  startupRunning = true;
  let window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;

  try {
    if (!window) window = await createWindow();
    if (!servicesReady) await initializeServices();
    await loadApplication(window);
  } catch (error) {
    if (window) await showStartupFailure(window, error);
    else {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error("CanvasTTY could not create its startup window.", error);
      dialog.showErrorBox("CanvasTTY startup failed", detail);
    }
  } finally {
    startupRunning = false;
  }
}

async function showStartupFailure(window: BrowserWindow, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("CanvasTTY startup failed.", error);
  if (window.isDestroyed()) {
    dialog.showErrorBox("CanvasTTY startup failed", detail);
    return;
  }

  try {
    await window.loadURL(startupPageUrl({ locale: app.getLocale(), error: detail }));
    window.show();
  } catch {
    dialog.showErrorBox("CanvasTTY startup failed", detail);
  }
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

if (hasSingleInstanceLock) {
  app.on("second-instance", focusMainWindow);
  void app.whenReady()
    .then(startApplication)
    .catch((error) => {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error("CanvasTTY could not create its startup window.", error);
      dialog.showErrorBox("CanvasTTY startup failed", detail);
      app.quit();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void startApplication();
  });
}

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownRunning) return;
  shutdownRunning = true;
  void shutdownServices().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Keep shared event names in the main bundle so accidental channel drift fails at build time.
void IPC.terminalData;

async function shutdownServices(): Promise<void> {
  terminalManager?.disposeAll();
  limitsService?.dispose();
  if (agentGateway) await Promise.allSettled([agentGateway.close()]);
  if (browserService) await Promise.allSettled([browserService.dispose()]);
  if (pluginManager) await Promise.allSettled([pluginManager.dispose()]);
}

async function openPluginWindow(pluginId: string, contributionId: string): Promise<void> {
  if (!pluginManager) throw new Error("Plugin manager is not ready.");
  const contribution = pluginManager.contribution(pluginId, contributionId);
  if (contribution.kind !== "window") throw new Error("Plugin contribution is not a separate window.");

  const window = new BrowserWindow({
    width: contribution.defaultSize.width,
    height: contribution.defaultSize.height,
    minWidth: 320,
    minHeight: 220,
    title: contribution.title,
    backgroundColor: "#353442",
    webPreferences: {
      preload: join(__dirname, "../preload/plugin.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--canvastty-plugin-id=${encodeURIComponent(pluginId)}`,
        `--canvastty-contribution-id=${encodeURIComponent(contributionId)}`
      ]
    }
  });
  pluginWindows.set(window, pluginId);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`canvastty-plugin://${pluginId}/`)) event.preventDefault();
  });
  window.on("closed", () => pluginWindows.delete(window));
  await window.loadURL(pluginManager.entryUrl(pluginId, contributionId));
}

function closePluginWindows(pluginId: string): void {
  for (const [window, ownerPluginId] of pluginWindows) {
    if (ownerPluginId !== pluginId) continue;
    pluginWindows.delete(window);
    if (!window.isDestroyed()) window.close();
  }
}

function requestPluginLauncher(provider: import("../shared/contracts").ProviderId): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send(IPC.pluginsLauncherRequested, { provider });
}
