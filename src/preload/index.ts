import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  BrowserActivityStateEvent,
  BrowserCanvasWheelEvent,
  BrowserCommand,
  BrowserStateEvent,
  BrowserViewportBounds,
  CanvasTTYApi,
  CreateSessionRequest,
  PluginLauncherRequest,
  SessionBounds,
  SessionEvent,
  SessionRemovedEvent,
  TerminalDataEvent
} from "../shared/contracts";
import { IPC } from "../shared/contracts";

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: CanvasTTYApi = {
  clipboard: {
    readText: () => ipcRenderer.invoke(IPC.clipboardRead),
    writeText: (text: string) => ipcRenderer.send(IPC.clipboardWrite, text)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  dialog: {
    pickDirectory: (defaultPath?: string) => ipcRenderer.invoke(IPC.dialogPickDirectory, defaultPath),
    pickMedia: () => ipcRenderer.invoke(IPC.dialogPickMedia)
  },
  media: {
    read: (path: string) => ipcRenderer.invoke(IPC.mediaRead, path)
  },
  limits: {
    get: () => ipcRenderer.invoke(IPC.limitsGet)
  },
  plugins: {
    list: () => ipcRenderer.invoke(IPC.pluginsList),
    previewInstall: (sourceUrl: string) => ipcRenderer.invoke(IPC.pluginsPreviewInstall, sourceUrl),
    install: (token: string) => ipcRenderer.invoke(IPC.pluginsInstall, token),
    setEnabled: (pluginId: string, enabled: boolean) => ipcRenderer.invoke(IPC.pluginsSetEnabled, pluginId, enabled),
    uninstall: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsUninstall, pluginId),
    openWindow: (pluginId: string, contributionId: string) => ipcRenderer.invoke(IPC.pluginsOpenWindow, pluginId, contributionId),
    openExternal: (pluginId: string, url: string) => ipcRenderer.invoke(IPC.pluginsOpenExternal, pluginId, url),
    storageGet: (pluginId: string, key: string) => ipcRenderer.invoke(IPC.pluginsStorageGet, pluginId, key),
    storageSet: (pluginId: string, key: string, value: unknown) => ipcRenderer.invoke(IPC.pluginsStorageSet, pluginId, key, value),
    mediaPickLibrary: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsMediaPickLibrary, pluginId),
    mediaListLibraries: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsMediaListLibraries, pluginId),
    mediaScanLibrary: (pluginId: string, libraryId: string) => ipcRenderer.invoke(IPC.pluginsMediaScanLibrary, pluginId, libraryId),
    mediaRevokeLibrary: (pluginId: string, libraryId: string) => ipcRenderer.invoke(IPC.pluginsMediaRevokeLibrary, pluginId, libraryId),
    playlistsList: (pluginId: string, libraryId: string) => ipcRenderer.invoke(IPC.pluginsPlaylistsList, pluginId, libraryId),
    playlistsRead: (pluginId: string, libraryId: string, playlistId: string) => ipcRenderer.invoke(IPC.pluginsPlaylistsRead, pluginId, libraryId, playlistId),
    playlistsWrite: (pluginId: string, libraryId: string, name: string, content: string) => ipcRenderer.invoke(IPC.pluginsPlaylistsWrite, pluginId, libraryId, name, content),
    onOpenLauncher: (listener: (event: PluginLauncherRequest) => void) => subscribe(IPC.pluginsLauncherRequested, listener)
  },
  browser: {
    getState: () => ipcRenderer.invoke(IPC.browserGetState),
    open: (url?: string) => ipcRenderer.invoke(IPC.browserOpen, url),
    close: () => ipcRenderer.invoke(IPC.browserClose),
    closeAllTabs: () => ipcRenderer.invoke(IPC.browserCloseAllTabs),
    newTab: (url?: string) => ipcRenderer.invoke(IPC.browserNewTab, url),
    selectTab: (id: string) => ipcRenderer.invoke(IPC.browserSelectTab, id),
    closeTab: (id: string) => ipcRenderer.invoke(IPC.browserCloseTab, id),
    navigate: (id: string, value: string) => ipcRenderer.invoke(IPC.browserNavigate, id, value),
    back: (id: string) => ipcRenderer.invoke(IPC.browserBack, id),
    forward: (id: string) => ipcRenderer.invoke(IPC.browserForward, id),
    reload: (id: string) => ipcRenderer.invoke(IPC.browserReload, id),
    execute: (command: BrowserCommand) => ipcRenderer.invoke(IPC.browserExecute, command),
    getActivity: (sinceSequence?: number) => ipcRenderer.invoke(IPC.browserGetActivity, sinceSequence),
    clearData: () => ipcRenderer.invoke(IPC.browserClearData),
    setViewport: (bounds: BrowserViewportBounds) => ipcRenderer.send(IPC.browserSetViewport, bounds),
    onState: (listener: (event: BrowserStateEvent) => void) => subscribe(IPC.browserState, listener),
    onActivity: (listener: (event: BrowserActivityStateEvent) => void) => subscribe(IPC.browserActivity, listener),
    onCanvasWheel: (listener: (event: BrowserCanvasWheelEvent) => void) => subscribe(IPC.browserCanvasWheel, listener)
  },
  terminal: {
    list: () => ipcRenderer.invoke(IPC.terminalList),
    create: (request: CreateSessionRequest) => ipcRenderer.invoke(IPC.terminalCreate, request),
    input: (id: string, data: string) => ipcRenderer.send(IPC.terminalInput, id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC.terminalResize, id, cols, rows),
    setBounds: (id: string, bounds: SessionBounds) => ipcRenderer.send(IPC.terminalBounds, id, bounds),
    rename: (id: string, title: string) => ipcRenderer.invoke(IPC.terminalRename, id, title),
    dispose: (id: string) => ipcRenderer.invoke(IPC.terminalDispose, id),
    onData: (listener: (event: TerminalDataEvent) => void) => subscribe(IPC.terminalData, listener),
    onSession: (listener: (event: SessionEvent) => void) => subscribe(IPC.terminalSession, listener),
    onRemoved: (listener: (event: SessionRemovedEvent) => void) => subscribe(IPC.terminalRemoved, listener)
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    getState: () => ipcRenderer.invoke(IPC.windowGetState)
  }
};

contextBridge.exposeInMainWorld("canvasTTY", api);
