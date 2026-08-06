import { extname } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import type {
  AppSettings,
  BrowserCommand,
  CreateSessionRequest,
  ProviderId,
  SessionBounds
} from "../../shared/contracts";
import { IPC } from "../../shared/contracts";
import type { SettingsStore } from "../services/SettingsStore";
import type { TerminalManager } from "../services/TerminalManager";
import type { LimitsService } from "../services/LimitsService";
import type { PluginManager } from "../services/PluginManager";
import type { PluginMediaService } from "../services/PluginMediaService";
import type { BrowserService } from "../services/BrowserService";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

interface Dependencies {
  settings: SettingsStore;
  terminals: TerminalManager;
  limits: LimitsService;
  plugins: PluginManager;
  pluginMedia: PluginMediaService;
  browser: BrowserService;
  getMainWindow(): BrowserWindow | null;
  applyBrowserSettings(settings: AppSettings): void;
  openPluginWindow(pluginId: string, contributionId: string): Promise<void>;
  closePluginWindows(pluginId: string): void;
  requestPluginLauncher(provider: ProviderId): void;
}

export function registerIpc({
  settings,
  terminals,
  limits,
  plugins,
  pluginMedia,
  browser,
  getMainWindow,
  applyBrowserSettings,
  openPluginWindow,
  closePluginWindows,
  requestPluginLauncher
}: Dependencies): void {
  ipcMain.handle(IPC.clipboardRead, () => clipboard.readText());
  ipcMain.on(IPC.clipboardWrite, (_event, text: string) => {
    if (typeof text === "string" && text.length > 0) clipboard.writeText(text);
  });

  ipcMain.handle(IPC.settingsGet, () => settings.get());
  ipcMain.handle(IPC.settingsUpdate, async (_event, patch: Partial<AppSettings>) => {
    const next = await settings.update(patch);
    applyBrowserSettings(next);
    return next;
  });

  ipcMain.handle(IPC.dialogPickDirectory, async (event, defaultPath?: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose a project folder",
      defaultPath: typeof defaultPath === "string" ? defaultPath : settings.get().lastDirectory,
      properties: ["openDirectory", "createDirectory"]
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC.dialogPickMedia, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose Home media",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    return { path, dataUrl: await readMedia(path) };
  });

  ipcMain.handle(IPC.mediaRead, async (_event, path: string) => {
    if (typeof path !== "string" || settings.get().mediaPath !== path) return null;
    try {
      return await readMedia(path);
    } catch (error) {
      console.warn("CanvasTTY media could not be read.", error);
      return null;
    }
  });

  ipcMain.handle(IPC.limitsGet, () => limits.get());

  ipcMain.handle(IPC.pluginsList, () => plugins.list());
  ipcMain.handle(IPC.pluginsPreviewInstall, (_event, sourceUrl: string) => {
    if (typeof sourceUrl !== "string") throw new Error("GitHub URL is required.");
    return plugins.previewInstall(sourceUrl);
  });
  ipcMain.handle(IPC.pluginsInstall, (_event, token: string) => {
    if (typeof token !== "string") throw new Error("Plugin preview token is invalid.");
    return plugins.install(token);
  });
  ipcMain.handle(IPC.pluginsSetEnabled, async (_event, pluginId: string, enabled: boolean) => {
    if (typeof enabled !== "boolean") throw new Error("Plugin enabled state is invalid.");
    const plugin = await plugins.setEnabled(pluginId, enabled);
    if (!enabled) closePluginWindows(pluginId);
    return plugin;
  });
  ipcMain.handle(IPC.pluginsUninstall, async (_event, pluginId: string) => {
    closePluginWindows(pluginId);
    await pluginMedia.revokeAll(pluginId);
    await plugins.uninstall(pluginId);
  });
  ipcMain.handle(IPC.pluginsOpenWindow, (_event, pluginId: string, contributionId: string) => (
    openPluginWindow(pluginId, contributionId)
  ));
  ipcMain.handle(IPC.pluginsOpenExternal, async (_event, pluginId: string, value: string) => {
    plugins.assertPermission(pluginId, "external:open");
    const url = safeExternalUrl(value);
    await shell.openExternal(url);
  });
  ipcMain.handle(IPC.pluginsStorageGet, (_event, pluginId: string, key: string) => (
    plugins.storageGet(pluginId, key)
  ));
  ipcMain.handle(IPC.pluginsStorageSet, (_event, pluginId: string, key: string, value: unknown) => (
    plugins.storageSet(pluginId, key, value)
  ));
  ipcMain.handle(IPC.pluginsMediaPickLibrary, (event, pluginId: string) => (
    pickPluginMediaLibrary(event, pluginId, plugins, pluginMedia)
  ));
  ipcMain.handle(IPC.pluginsMediaListLibraries, (_event, pluginId: string) => (
    pluginMedia.listLibraries(pluginId)
  ));
  ipcMain.handle(IPC.pluginsMediaScanLibrary, (_event, pluginId: string, libraryId: string) => (
    pluginMedia.scanLibrary(pluginId, libraryId)
  ));
  ipcMain.handle(IPC.pluginsMediaRevokeLibrary, (_event, pluginId: string, libraryId: string) => (
    pluginMedia.revokeLibrary(pluginId, libraryId)
  ));
  ipcMain.handle(IPC.pluginsPlaylistsList, (_event, pluginId: string, libraryId: string) => (
    pluginMedia.listPlaylists(pluginId, libraryId)
  ));
  ipcMain.handle(IPC.pluginsPlaylistsRead, (_event, pluginId: string, libraryId: string, playlistId: string) => (
    pluginMedia.readPlaylist(pluginId, libraryId, playlistId)
  ));
  ipcMain.handle(IPC.pluginsPlaylistsWrite, (
    _event,
    pluginId: string,
    libraryId: string,
    name: string,
    content: string
  ) => pluginMedia.writePlaylist(
    pluginId,
    stringValue(libraryId, "libraryId"),
    stringValue(name, "name"),
    playlistContent(content)
  ));
  ipcMain.handle(IPC.pluginsHostInvoke, async (
    event,
    pluginId: string,
    contributionId: string,
    method: string,
    params: unknown
  ) => {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) throw new Error("Plugin window sender is unavailable.");
    const contribution = assertPluginWindowSender(senderUrl, plugins, pluginId, contributionId);
    const values = params && typeof params === "object" && !Array.isArray(params)
      ? params as Record<string, unknown>
      : {};
    if (method === "host.getContext") {
      const plugin = plugins.list().find((candidate) => candidate.manifest.id === pluginId)!;
      return {
        apiVersion: 1,
        plugin: {
          id: plugin.manifest.id,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          permissions: plugin.manifest.permissions
        },
        contribution: { id: contribution.id, kind: contribution.kind, title: contribution.title },
        appearance: { locale: settings.get().locale, palette: settings.get().palette }
      };
    }
    if (method === "storage.get") return plugins.storageGet(pluginId, stringValue(values.key, "key"));
    if (method === "storage.set") {
      await plugins.storageSet(pluginId, stringValue(values.key, "key"), values.value);
      return null;
    }
    if (method === "sessions.list") {
      plugins.assertPermission(pluginId, "sessions:read");
      return terminals.list().map((session) => ({
        id: session.id,
        provider: session.provider,
        title: session.title,
        status: session.status,
        startedAt: session.startedAt,
        exitCode: session.exitCode
      }));
    }
    if (method === "limits.get") {
      plugins.assertPermission(pluginId, "limits:read");
      return { state: "ready", snapshot: await limits.get() };
    }
    if (method === "launcher.open") {
      plugins.assertPermission(pluginId, "launcher:open");
      const provider = providerValue(values.provider);
      requestPluginLauncher(provider);
      return null;
    }
    if (method === "external.open") {
      plugins.assertPermission(pluginId, "external:open");
      await shell.openExternal(safeExternalUrl(values.url));
      return null;
    }
    if (method === "media.pickLibrary") {
      return pickPluginMediaLibrary(event, pluginId, plugins, pluginMedia);
    }
    if (method === "media.listLibraries") return pluginMedia.listLibraries(pluginId);
    if (method === "media.scanLibrary") {
      return pluginMedia.scanLibrary(pluginId, stringValue(values.libraryId, "libraryId"));
    }
    if (method === "media.revokeLibrary") {
      await pluginMedia.revokeLibrary(pluginId, stringValue(values.libraryId, "libraryId"));
      return null;
    }
    if (method === "playlists.list") {
      return pluginMedia.listPlaylists(pluginId, stringValue(values.libraryId, "libraryId"));
    }
    if (method === "playlists.read") {
      return pluginMedia.readPlaylist(
        pluginId,
        stringValue(values.libraryId, "libraryId"),
        stringValue(values.playlistId, "playlistId")
      );
    }
    if (method === "playlists.write") {
      return pluginMedia.writePlaylist(
        pluginId,
        stringValue(values.libraryId, "libraryId"),
        stringValue(values.name, "name"),
        playlistContent(values.content)
      );
    }
    if (method === "window.open") {
      const targetId = stringValue(values.contributionId, "contributionId");
      const target = plugins.contribution(pluginId, targetId);
      if (target.kind !== "window") throw new Error("Plugin requested an unknown window contribution.");
      await openPluginWindow(pluginId, targetId);
      return null;
    }
    throw new Error(`Unsupported plugin method: ${String(method).slice(0, 80)}.`);
  });

  ipcMain.handle(IPC.browserGetState, (event) => {
    assertMainRenderer(event, getMainWindow);
    return browser.getState();
  });
  ipcMain.handle(IPC.browserOpen, (event, url?: string) => {
    assertMainRenderer(event, getMainWindow);
    return browser.open(url);
  });
  ipcMain.handle(IPC.browserClose, (event) => {
    assertMainRenderer(event, getMainWindow);
    return browser.close();
  });
  ipcMain.handle(IPC.browserCloseAllTabs, (event) => {
    assertMainRenderer(event, getMainWindow);
    return browser.closeAllTabs();
  });
  ipcMain.handle(IPC.browserNewTab, (event, url?: string) => {
    assertMainRenderer(event, getMainWindow);
    return browser.newTab(url);
  });
  ipcMain.handle(IPC.browserSelectTab, (event, id: string) => {
    assertMainRenderer(event, getMainWindow);
    return browser.selectTab(id);
  });
  ipcMain.handle(IPC.browserCloseTab, (event, id: string) => {
    assertMainRenderer(event, getMainWindow);
    return browser.closeTab(id);
  });
  ipcMain.handle(IPC.browserNavigate, (event, id: string, value: string) => {
    assertMainRenderer(event, getMainWindow);
    return browser.navigate(id, value);
  });
  ipcMain.handle(IPC.browserBack, (event, id: string) => {
    assertMainRenderer(event, getMainWindow);
    return browser.back(id);
  });
  ipcMain.handle(IPC.browserForward, (event, id: string) => {
    assertMainRenderer(event, getMainWindow);
    return browser.forward(id);
  });
  ipcMain.handle(IPC.browserReload, (event, id: string) => {
    assertMainRenderer(event, getMainWindow);
    return browser.reload(id);
  });
  ipcMain.handle(IPC.browserExecute, (event, command: BrowserCommand) => {
    assertMainRenderer(event, getMainWindow);
    return browser.executeHuman(command);
  });
  ipcMain.handle(IPC.browserGetActivity, (event, sinceSequence?: number) => {
    assertMainRenderer(event, getMainWindow);
    return browser.getActivity(sinceSequence);
  });
  ipcMain.handle(IPC.browserClearData, (event) => {
    assertMainRenderer(event, getMainWindow);
    return browser.clearData();
  });
  ipcMain.on(IPC.browserSetViewport, (event, bounds) => {
    assertMainRenderer(event, getMainWindow);
    browser.setViewport(bounds);
  });

  ipcMain.handle(IPC.terminalList, () => terminals.list());
  ipcMain.handle(IPC.terminalCreate, (_event, request: CreateSessionRequest) => terminals.create(request));
  ipcMain.on(IPC.terminalInput, (_event, id: string, data: string) => terminals.input(id, data));
  ipcMain.on(IPC.terminalResize, (_event, id: string, cols: number, rows: number) => {
    terminals.resize(id, cols, rows);
  });
  ipcMain.on(IPC.terminalBounds, (_event, id: string, bounds: SessionBounds) => terminals.setBounds(id, bounds));
  ipcMain.handle(IPC.terminalRename, (_event, id: string, title: string) => terminals.rename(id, title));
  ipcMain.handle(IPC.terminalDispose, (_event, id: string) => terminals.dispose(id));

  ipcMain.on(IPC.windowMinimize, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { maximized: false };
    window.isMaximized() ? window.unmaximize() : window.maximize();
    return { maximized: window.isMaximized() };
  });
  ipcMain.on(IPC.windowClose, (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle(IPC.windowGetState, (event) => ({
    maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  }));
}

function assertMainRenderer(
  event: IpcMainEvent | IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null
): void {
  const expected = getMainWindow();
  if (
    !expected
    || expected.isDestroyed()
    || event.sender !== expected.webContents
    || event.senderFrame !== expected.webContents.mainFrame
  ) {
    throw new Error("Browser IPC is available only to the trusted CanvasTTY renderer.");
  }
}

function safeExternalUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) throw new Error("External URL is invalid.");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Plugins may open only HTTP(S) URLs.");
  }
  return url.toString();
}

function assertPluginWindowSender(
  senderUrl: string,
  plugins: PluginManager,
  pluginId: string,
  contributionId: string
) {
  const contribution = plugins.contribution(pluginId, contributionId);
  if (contribution.kind !== "window") throw new Error("Plugin host request is not from a window contribution.");
  const actual = new URL(senderUrl);
  const expected = new URL(plugins.entryUrl(pluginId, contributionId));
  if (
    actual.protocol !== expected.protocol
    || actual.hostname !== expected.hostname
    || actual.pathname !== expected.pathname
  ) throw new Error("Plugin window identity does not match its loaded entry.");
  return contribution;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new Error(`Plugin ${label} parameter is invalid.`);
  }
  return value;
}

function playlistContent(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 4 * 1024 * 1024) {
    throw new Error("Plugin playlist content is invalid or exceeds 4 MB.");
  }
  return value;
}

async function pickPluginMediaLibrary(
  event: IpcMainInvokeEvent,
  pluginId: string,
  plugins: PluginManager,
  pluginMedia: PluginMediaService
) {
  plugins.assertPermission(pluginId, "media:library");
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: "Choose a music library",
    properties: ["openDirectory"]
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  const selected = result.filePaths[0];
  return result.canceled || !selected ? null : pluginMedia.addLibrary(pluginId, selected);
}

function providerValue(value: unknown): ProviderId {
  if (value === "terminal" || value === "codex" || value === "claude" || value === "kimi") return value;
  throw new Error("Plugin requested an unknown launcher provider.");
}

async function readMedia(path: string): Promise<string> {
  const mime = MEDIA_MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error("Unsupported media type.");

  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_MEDIA_BYTES) {
    throw new Error("Media must be a file smaller than 25 MB.");
  }

  const content = await readFile(path);
  return `data:${mime};base64,${content.toString("base64")}`;
}
