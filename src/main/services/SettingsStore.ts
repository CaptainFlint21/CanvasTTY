import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type {
  AgentProviderId,
  AppSettings,
  BrowserCanvasState,
  CanvasPatternId,
  EdgePanSpeed,
  FocusActivation,
  HomeGridSize,
  HomeWidgetPlacement,
  LocaleId,
  MediaFit,
  PaletteId,
  PluginCanvasInstance,
  ShortcutBindings,
  ZoomSensitivity
} from "../../shared/contracts";
import {
  DEFAULT_HOME_GRID_SIZE,
  DEFAULT_HOME_LAYOUT,
  HOME_GRID_MAX_COLUMNS,
  HOME_GRID_MAX_ROWS,
  HOME_GRID_MIN_COLUMNS,
  HOME_GRID_MIN_ROWS
} from "../../shared/contracts.ts";

const LOCALES = new Set<LocaleId>(["ru", "en"]);
const PALETTES = new Set<PaletteId>(["sage", "lilac", "night"]);
const PATTERNS = new Set<CanvasPatternId>(["dots", "grid", "waves", "none"]);
const MEDIA_FITS = new Set<MediaFit>(["cover", "contain"]);
const AGENT_PROVIDERS = new Set<AgentProviderId>(["codex", "claude", "kimi"]);
const EDGE_PAN_SPEEDS = new Set<EdgePanSpeed>(["slow", "normal", "fast"]);
const ZOOM_SENSITIVITIES = new Set<ZoomSensitivity>(["slow", "normal", "fast"]);
const FOCUS_ACTIVATIONS = new Set<FocusActivation>(["off", "single", "double"]);
const SHORTCUT_MODIFIERS = new Set(["Ctrl", "Alt", "Shift", "Meta"]);
const DEFAULT_SHORTCUTS: ShortcutBindings = { home: "Home", renameWindow: "F2" };

export class SettingsStore {
  private readonly filePath: string;
  private value: AppSettings;
  private writeQueue = Promise.resolve();

  constructor(userDataPath: string, systemLocale: string) {
    this.filePath = join(userDataPath, "settings.json");
    this.value = createDefaults(systemLocale);
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.value = normalizeSettings(JSON.parse(raw), this.value);
    } catch (error) {
      if (isMissingFile(error)) {
        await this.persist();
      } else {
        console.warn("CanvasTTY settings could not be loaded; defaults are used.", error);
      }
    }

    return this.get();
  }

  get(): AppSettings {
    return structuredClone(this.value);
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.value = normalizeSettings({ ...this.value, ...patch }, this.value);
    await this.persist();
    return this.get();
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.value, null, 2);
    const temporaryPath = `${this.filePath}.tmp`;

    const write = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temporaryPath, snapshot, "utf8");
      await rename(temporaryPath, this.filePath);
    });
    this.writeQueue = write;

    return write;
  }
}

function createDefaults(systemLocale: string): AppSettings {
  return {
    locale: systemLocale.toLowerCase().startsWith("ru") ? "ru" : "en",
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
    lastDirectory: homedir(),
    acknowledgedDangerousProfiles: [],
    homeGridSize: { ...DEFAULT_HOME_GRID_SIZE },
    homeLayout: structuredClone(DEFAULT_HOME_LAYOUT),
    pluginCanvas: [],
    browserCanvas: null,
    browserAgentAccess: true,
    browserRestoreTabs: true
  };
}

export function normalizeSettings(candidate: unknown, fallback: AppSettings): AppSettings {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const source = candidate as Partial<AppSettings>;
  const mediaPath = source.mediaPath === null || typeof source.mediaPath === "string"
    ? source.mediaPath
    : fallback.mediaPath;
  const acknowledged = Array.isArray(source.acknowledgedDangerousProfiles)
    ? source.acknowledgedDangerousProfiles.filter(
      (provider): provider is AgentProviderId => AGENT_PROVIDERS.has(provider as AgentProviderId)
    )
    : fallback.acknowledgedDangerousProfiles;
  const shortcuts = normalizeShortcuts(source.shortcuts, fallback.shortcuts);
  const homeGridSize = normalizeHomeGridSize(
    source.homeGridSize,
    fallback.homeGridSize ?? DEFAULT_HOME_GRID_SIZE
  );
  const homeLayout = normalizeHomeLayout(
    source.homeLayout,
    fallback.homeLayout ?? DEFAULT_HOME_LAYOUT,
    homeGridSize
  );
  const pluginCanvas = normalizePluginCanvas(source.pluginCanvas, fallback.pluginCanvas ?? []);
  const browserCanvas = normalizeBrowserCanvas(source.browserCanvas, fallback.browserCanvas ?? null);

  return {
    locale: LOCALES.has(source.locale as LocaleId) ? source.locale as LocaleId : fallback.locale,
    palette: PALETTES.has(source.palette as PaletteId) ? source.palette as PaletteId : fallback.palette,
    pattern: PATTERNS.has(source.pattern as CanvasPatternId)
      ? source.pattern as CanvasPatternId
      : fallback.pattern,
    snapToGrid: typeof source.snapToGrid === "boolean" ? source.snapToGrid : fallback.snapToGrid,
    invertTerminalWheel: typeof source.invertTerminalWheel === "boolean"
      ? source.invertTerminalWheel
      : fallback.invertTerminalWheel,
    invertCanvasWheel: typeof source.invertCanvasWheel === "boolean"
      ? source.invertCanvasWheel
      : fallback.invertCanvasWheel,
    edgePan: typeof source.edgePan === "boolean" ? source.edgePan : fallback.edgePan,
    edgePanSpeed: EDGE_PAN_SPEEDS.has(source.edgePanSpeed as EdgePanSpeed)
      ? source.edgePanSpeed as EdgePanSpeed
      : fallback.edgePanSpeed,
    zoomSensitivity: ZOOM_SENSITIVITIES.has(source.zoomSensitivity as ZoomSensitivity)
      ? source.zoomSensitivity as ZoomSensitivity
      : fallback.zoomSensitivity,
    zoomOverApplications: typeof source.zoomOverApplications === "boolean"
      ? source.zoomOverApplications
      : fallback.zoomOverApplications,
    focusActivation: FOCUS_ACTIVATIONS.has(source.focusActivation as FocusActivation)
      ? source.focusActivation as FocusActivation
      : fallback.focusActivation,
    hoverFocus: typeof source.hoverFocus === "boolean" ? source.hoverFocus : fallback.hoverFocus,
    hoverFocusSpeed: EDGE_PAN_SPEEDS.has(source.hoverFocusSpeed as EdgePanSpeed)
      ? source.hoverFocusSpeed as EdgePanSpeed
      : fallback.hoverFocusSpeed,
    showShortcutHints: typeof source.showShortcutHints === "boolean"
      ? source.showShortcutHints
      : fallback.showShortcutHints,
    shortcuts,
    mediaPath,
    mediaFit: MEDIA_FITS.has(source.mediaFit as MediaFit) ? source.mediaFit as MediaFit : fallback.mediaFit,
    lastDirectory: typeof source.lastDirectory === "string" && source.lastDirectory.length > 0
      ? source.lastDirectory
      : fallback.lastDirectory,
    acknowledgedDangerousProfiles: [...new Set(acknowledged)],
    homeGridSize,
    homeLayout,
    pluginCanvas,
    browserCanvas,
    browserAgentAccess: typeof source.browserAgentAccess === "boolean"
      ? source.browserAgentAccess
      : fallback.browserAgentAccess,
    browserRestoreTabs: typeof source.browserRestoreTabs === "boolean"
      ? source.browserRestoreTabs
      : fallback.browserRestoreTabs
  };
}

export function normalizeHomeLayout(
  candidate: unknown,
  fallback: readonly HomeWidgetPlacement[] = DEFAULT_HOME_LAYOUT,
  gridSize: HomeGridSize = DEFAULT_HOME_GRID_SIZE
): HomeWidgetPlacement[] {
  if (!Array.isArray(candidate)) return fallback.map((placement) => structuredClone(placement));

  const placements: HomeWidgetPlacement[] = [];
  const widgetIds = new Set<string>();
  for (const value of candidate.slice(0, 64)) {
    if (!value || typeof value !== "object") continue;
    const source = value as Partial<HomeWidgetPlacement>;
    if (!isWidgetId(source.widgetId) || widgetIds.has(source.widgetId)) continue;
    if (![source.column, source.row, source.columnSpan, source.rowSpan].every(Number.isInteger)) continue;

    const placement: HomeWidgetPlacement = {
      widgetId: source.widgetId,
      column: source.column!,
      row: source.row!,
      columnSpan: source.columnSpan!,
      rowSpan: source.rowSpan!
    };
    if (!isPlacementInsideGrid(placement, gridSize) || placements.some((current) => placementsOverlap(current, placement))) {
      continue;
    }
    placements.push(placement);
    widgetIds.add(placement.widgetId);
  }

  const settingsPlacement = placements.find((placement) => placement.widgetId === "core.settings");
  if (!settingsPlacement) {
    const defaultSettings = DEFAULT_HOME_LAYOUT.find((placement) => placement.widgetId === "core.settings")!;
    const withoutCollision = placements.filter((placement) => !placementsOverlap(placement, defaultSettings));
    return [...withoutCollision, structuredClone(defaultSettings)];
  }
  return placements;
}

export function normalizeHomeGridSize(
  candidate: unknown,
  fallback: HomeGridSize = DEFAULT_HOME_GRID_SIZE
): HomeGridSize {
  if (!candidate || typeof candidate !== "object") return { ...fallback };
  const source = candidate as Partial<HomeGridSize>;
  if (!Number.isInteger(source.columns) || !Number.isInteger(source.rows)) return { ...fallback };
  return {
    columns: clamp(source.columns!, HOME_GRID_MIN_COLUMNS, HOME_GRID_MAX_COLUMNS),
    rows: clamp(source.rows!, HOME_GRID_MIN_ROWS, HOME_GRID_MAX_ROWS)
  };
}

function normalizePluginCanvas(candidate: unknown, fallback: readonly PluginCanvasInstance[]): PluginCanvasInstance[] {
  if (!Array.isArray(candidate)) return fallback.map((instance) => structuredClone(instance));

  const instances: PluginCanvasInstance[] = [];
  const ids = new Set<string>();
  for (const value of candidate.slice(0, 64)) {
    if (!value || typeof value !== "object") continue;
    const source = value as Partial<PluginCanvasInstance>;
    if (!isInstanceId(source.id) || ids.has(source.id)) continue;
    if (!isPluginId(source.pluginId) || !isContributionId(source.contributionId)) continue;
    if (typeof source.title !== "string" || source.title.trim().length === 0) continue;
    if (!isFinitePoint(source.position) || !isFiniteSize(source.size)) continue;
    instances.push({
      id: source.id,
      pluginId: source.pluginId,
      contributionId: source.contributionId,
      title: source.title.trim().slice(0, 80),
      position: { x: source.position.x, y: source.position.y },
      size: {
        width: clamp(source.size.width, 320, 1_600),
        height: clamp(source.size.height, 220, 1_100)
      }
    });
    ids.add(source.id);
  }
  return instances;
}

function normalizeBrowserCanvas(candidate: unknown, fallback: BrowserCanvasState | null): BrowserCanvasState | null {
  if (candidate === null) return null;
  if (!candidate || typeof candidate !== "object") return fallback ? structuredClone(fallback) : null;
  const source = candidate as Partial<BrowserCanvasState>;
  if (!isFinitePoint(source.position) || !isFiniteSize(source.size)) {
    return fallback ? structuredClone(fallback) : null;
  }
  return {
    position: { x: source.position.x, y: source.position.y },
    size: {
      width: clamp(source.size.width, 560, 1_600),
      height: clamp(source.size.height, 380, 1_100)
    }
  };
}

function normalizeShortcuts(candidate: unknown, fallback: ShortcutBindings): ShortcutBindings {
  const source = candidate && typeof candidate === "object"
    ? candidate as Partial<ShortcutBindings>
    : {};
  const shortcuts = {
    home: isValidShortcut(source.home) ? source.home : fallback.home,
    renameWindow: isValidShortcut(source.renameWindow) ? source.renameWindow : fallback.renameWindow
  };

  if (shortcuts.home.toLowerCase() === shortcuts.renameWindow.toLowerCase()) {
    return { ...fallback };
  }
  return shortcuts;
}

function isValidShortcut(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 40) return false;
  const parts = value.split("+");
  if (parts.some((part) => part.length === 0) || new Set(parts).size !== parts.length) return false;
  const key = parts.at(-1);
  if (!key || parts.slice(0, -1).some((part) => !SHORTCUT_MODIFIERS.has(part))) return false;
  return /^[A-Z0-9]$/i.test(key)
    || /^F(?:[1-9]|1\d|2[0-4])$/.test(key)
    || new Set([
      "Home", "End", "PageUp", "PageDown", "Space", "Enter", "Escape", "Tab",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Insert", "Backspace"
    ]).has(key);
}

function isWidgetId(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  if (/^core\.(?:limits|sessions|clock|media|launcher|settings)$/.test(value)) return true;
  const match = value.match(/^plugin:([^:]+):([^:]+)$/);
  return Boolean(match && isPluginId(match[1]) && isContributionId(match[2]));
}

function isPluginId(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 80
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);
}

function isContributionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value);
}

function isInstanceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(value);
}

function isFinitePoint(value: unknown): value is { x: number; y: number } {
  return Boolean(
    value
    && typeof value === "object"
    && "x" in value
    && "y" in value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
  );
}

function isFiniteSize(value: unknown): value is { width: number; height: number } {
  return Boolean(
    value
    && typeof value === "object"
    && "width" in value
    && "height" in value
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
  );
}

function isPlacementInsideGrid(placement: HomeWidgetPlacement, gridSize: HomeGridSize): boolean {
  return placement.column >= 0
    && placement.row >= 0
    && placement.columnSpan > 0
    && placement.rowSpan > 0
    && placement.column + placement.columnSpan <= gridSize.columns
    && placement.row + placement.rowSpan <= gridSize.rows;
}

function placementsOverlap(left: HomeWidgetPlacement, right: HomeWidgetPlacement): boolean {
  return left.column < right.column + right.columnSpan
    && left.column + left.columnSpan > right.column
    && left.row < right.row + right.rowSpan
    && left.row + left.rowSpan > right.row;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
