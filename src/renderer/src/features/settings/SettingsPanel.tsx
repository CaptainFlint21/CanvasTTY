import { useEffect, useState } from "react";
import type {
  AppSettings,
  BrowserActivityEvent,
  BrowserCommandType,
  BrowserDownloadSnapshot,
  BrowserSnapshot,
  CanvasPatternId,
  EdgePanSpeed,
  FocusActivation,
  InstalledPlugin,
  LocaleId,
  PaletteId,
  PluginContribution,
  PluginGridSize,
  PluginInstallPreview,
  ShortcutAction,
  ZoomSensitivity
} from "../../../../shared/contracts";
import { BROWSER_PROVIDER_COLORS } from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";
import { shortcutFromKeyboardEvent } from "../../lib/shortcuts";
import { t } from "../../lib/i18n";
import { PluginSettingsSection } from "../plugins/PluginSettingsSection";
import { HomeAppearanceSettings } from "../home/HomeAppearanceSettings";

type SettingsSection = "general" | "appearance" | "controls" | "browser" | "plugins";

interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  plugins: InstalledPlugin[];
  browser: BrowserSnapshot;
  onClose(): void;
  onChange(patch: Partial<AppSettings>): Promise<void>;
  onPreviewPlugin(sourceUrl: string): Promise<PluginInstallPreview>;
  onInstallPlugin(token: string): Promise<void>;
  onSetPluginEnabled(pluginId: string, enabled: boolean): Promise<void>;
  onUninstallPlugin(pluginId: string): Promise<void>;
  onOpenPluginContribution(plugin: InstalledPlugin, contribution: PluginContribution): Promise<void>;
  onToggleHomeWidget(widgetId: string, size: PluginGridSize): Promise<void>;
  onEditHome(): void;
}

export function SettingsPanel({
  open,
  settings,
  plugins,
  browser,
  onClose,
  onChange,
  onPreviewPlugin,
  onInstallPlugin,
  onSetPluginEnabled,
  onUninstallPlugin,
  onOpenPluginContribution,
  onToggleHomeWidget,
  onEditHome
}: SettingsPanelProps): React.JSX.Element {
  const locale = settings.locale;
  const [section, setSection] = useState<SettingsSection>("general");
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [activity, setActivity] = useState<BrowserActivityEvent[]>([]);
  const [activityState, setActivityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearingBrowserData, setClearingBrowserData] = useState(false);
  const [browserDataMessage, setBrowserDataMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCapturing(null);
      setShortcutError(null);
      setClearConfirm(false);
      setBrowserDataMessage(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || section !== "browser") return;
    let active = true;
    setActivityState("loading");
    void window.canvasTTY.browser.getActivity()
      .then((events) => {
        if (!active) return;
        setActivity(events.slice(-40));
        setActivityState("ready");
      })
      .catch(() => {
        if (active) setActivityState("error");
      });
    const unsubscribe = window.canvasTTY.browser.onActivity(({ event }) => {
      if (!active) return;
      setActivity((current) => [...current.filter((candidate) => candidate.sequence !== event.sequence), event].slice(-40));
      setActivityState("ready");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [open, section]);

  const clearBrowserData = async (): Promise<void> => {
    if (!clearConfirm) {
      setClearConfirm(true);
      setBrowserDataMessage(null);
      return;
    }
    setClearingBrowserData(true);
    try {
      await window.canvasTTY.browser.clearData();
      setBrowserDataMessage(t(locale, "browserDataCleared"));
      setClearConfirm(false);
    } catch {
      setBrowserDataMessage(t(locale, "browserDataClearFailed"));
    } finally {
      setClearingBrowserData(false);
    }
  };

  const captureShortcut = async (
    action: ShortcutAction,
    event: React.KeyboardEvent<HTMLButtonElement>
  ): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturing(null);
      setShortcutError(null);
      return;
    }

    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    const conflict = Object.entries(settings.shortcuts).find(
      ([candidateAction, value]) => candidateAction !== action && value.toLowerCase() === shortcut.toLowerCase()
    );
    if (conflict) {
      setShortcutError(t(locale, "shortcutConflict"));
      return;
    }

    setShortcutError(null);
    await onChange({ shortcuts: { ...settings.shortcuts, [action]: shortcut } });
    setCapturing(null);
  };

  return (
    <div className={`settings-backdrop ${open ? "settings-backdrop--open" : ""}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className={`settings-panel ${open ? "settings-panel--open" : ""}`} aria-hidden={!open}>
        <header className="dialog-header settings-panel__header">
          <h2>{t(locale, "settings")}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t(locale, "close")}><UiIcon name="close" size={20} /></button>
        </header>

        <nav className="settings-tabs" role="tablist" aria-label={t(locale, "settingsSections")}>
          {(["general", "appearance", "controls", "browser", "plugins"] as SettingsSection[]).map((value) => (
            <button
              key={value}
              className={section === value ? "settings-tabs__button settings-tabs__button--active" : "settings-tabs__button"}
              type="button"
              role="tab"
              aria-selected={section === value}
              onClick={() => setSection(value)}
            >{t(locale, value)}</button>
          ))}
        </nav>

        <div className="settings-panel__content" role="tabpanel">
          {section === "general" && (
            <SettingGroup label={t(locale, "language")}>
              <Segmented
                value={settings.locale}
                options={[["ru", "Русский"], ["en", "English"]]}
                onChange={(value) => void onChange({ locale: value as LocaleId })}
              />
            </SettingGroup>
          )}

          {section === "appearance" && (
            <>
              <SettingGroup label={t(locale, "palette")}>
                <Segmented
                  value={settings.palette}
                  options={(["sage", "lilac", "night"] as PaletteId[]).map((value) => [value, t(locale, value)])}
                  onChange={(value) => void onChange({ palette: value as PaletteId })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "canvasPattern")}>
                <Segmented
                  value={settings.pattern}
                  options={(["dots", "grid", "waves", "none"] as CanvasPatternId[]).map((value) => [value, t(locale, value)])}
                  onChange={(value) => void onChange({ pattern: value as CanvasPatternId })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "shortcutHints")}>
                <Segmented
                  value={settings.showShortcutHints ? "on" : "off"}
                  options={[["on", t(locale, "on")], ["off", t(locale, "off")]]}
                  onChange={(value) => void onChange({ showShortcutHints: value === "on" })}
                />
              </SettingGroup>
              <HomeAppearanceSettings
                settings={settings}
                onToggleHomeWidget={onToggleHomeWidget}
                onEditHome={onEditHome}
              />
            </>
          )}

          {section === "controls" && (
            <>
              <SettingGroup label={t(locale, "focusActivation")}>
                <Segmented
                  value={settings.focusActivation}
                  options={(["off", "single", "double"] as FocusActivation[]).map((value) => [value, t(locale, value)])}
                  onChange={(value) => void onChange({ focusActivation: value as FocusActivation })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "hoverFocus")} description={t(locale, "hoverFocusDescription")}>
                <Segmented
                  value={settings.hoverFocus ? "on" : "off"}
                  options={[["on", t(locale, "on")], ["off", t(locale, "off")]]}
                  onChange={(value) => void onChange({ hoverFocus: value === "on" })}
                />
              </SettingGroup>
              {settings.hoverFocus && (
                <SettingGroup label={t(locale, "hoverFocusSpeed")}>
                  <Segmented
                    value={settings.hoverFocusSpeed}
                    options={(["slow", "normal", "fast"] as EdgePanSpeed[]).map((value) => [value, t(locale, value)])}
                    onChange={(value) => void onChange({ hoverFocusSpeed: value as EdgePanSpeed })}
                  />
                </SettingGroup>
              )}
              <SettingGroup label={t(locale, "snapToGrid")}>
                <Segmented
                  value={settings.snapToGrid ? "on" : "off"}
                  options={[["on", t(locale, "on")], ["off", t(locale, "off")]]}
                  onChange={(value) => void onChange({ snapToGrid: value === "on" })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "edgePan")} description={t(locale, "edgePanDescription")}>
                <Segmented
                  value={settings.edgePan ? "on" : "off"}
                  options={[["on", t(locale, "on")], ["off", t(locale, "off")]]}
                  onChange={(value) => void onChange({ edgePan: value === "on" })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "edgePanSpeed")}>
                <Segmented
                  value={settings.edgePanSpeed}
                  options={(["slow", "normal", "fast"] as EdgePanSpeed[]).map((value) => [value, t(locale, value)])}
                  onChange={(value) => void onChange({ edgePanSpeed: value as EdgePanSpeed })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "zoomSensitivity")}>
                <Segmented
                  value={settings.zoomSensitivity}
                  options={(["slow", "normal", "fast"] as ZoomSensitivity[]).map((value) => [value, t(locale, value)])}
                  onChange={(value) => void onChange({ zoomSensitivity: value as ZoomSensitivity })}
                />
              </SettingGroup>
              <SettingGroup
                label={t(locale, "zoomOverApplications")}
                description={t(locale, "zoomOverApplicationsDescription")}
              >
                <Segmented
                  value={settings.zoomOverApplications ? "on" : "off"}
                  options={[["on", t(locale, "on")], ["off", t(locale, "off")]]}
                  onChange={(value) => void onChange({ zoomOverApplications: value === "on" })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "terminalWheelDirection")}>
                <Segmented
                  value={settings.invertTerminalWheel ? "inverted" : "normal"}
                  options={[["inverted", t(locale, "wheelInverted")], ["normal", t(locale, "wheelNormal")]]}
                  onChange={(value) => void onChange({ invertTerminalWheel: value === "inverted" })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "canvasWheelDirection")}>
                <Segmented
                  value={settings.invertCanvasWheel ? "inverted" : "normal"}
                  options={[["normal", t(locale, "wheelNormal")], ["inverted", t(locale, "wheelInverted")]]}
                  onChange={(value) => void onChange({ invertCanvasWheel: value === "inverted" })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "keyboardShortcuts")}>
                <div className="shortcut-editor">
                  <ShortcutRow
                    label={t(locale, "homeShortcut")}
                    value={settings.shortcuts.home}
                    capturing={capturing === "home"}
                    onStart={() => {
                      setShortcutError(null);
                      setCapturing("home");
                    }}
                    onKeyDown={(event) => void captureShortcut("home", event)}
                  />
                  <ShortcutRow
                    label={t(locale, "renameWindow")}
                    value={settings.shortcuts.renameWindow}
                    capturing={capturing === "renameWindow"}
                    onStart={() => {
                      setShortcutError(null);
                      setCapturing("renameWindow");
                    }}
                    onKeyDown={(event) => void captureShortcut("renameWindow", event)}
                  />
                </div>
                {shortcutError && <p className="shortcut-editor__error" role="alert">{shortcutError}</p>}
              </SettingGroup>
            </>
          )}

          {section === "browser" && (
            <>
              <SettingGroup
                label={t(locale, "browserAgentAccess")}
                description={t(locale, "browserAgentAccessDescription")}
              >
                <Segmented
                  value={settings.browserAgentAccess ? "on" : "off"}
                  options={[["on", t(locale, "on")], ["off", t(locale, "off")]]}
                  onChange={(value) => void onChange({ browserAgentAccess: value === "on" })}
                />
              </SettingGroup>
              <SettingGroup
                label={t(locale, "browserRestoreTabs")}
                description={t(locale, "browserRestoreTabsDescription")}
              >
                <Segmented
                  value={settings.browserRestoreTabs ? "on" : "off"}
                  options={[["on", t(locale, "on")], ["off", t(locale, "off")]]}
                  onChange={(value) => void onChange({ browserRestoreTabs: value === "on" })}
                />
              </SettingGroup>
              <SettingGroup label={t(locale, "browserDownloads")}>
                <BrowserDownloadList downloads={browser.downloads} locale={locale} />
              </SettingGroup>
              <SettingGroup label={t(locale, "browserActivity")}>
                <BrowserActivityList activity={activity} state={activityState} locale={locale} />
              </SettingGroup>
              <SettingGroup
                label={t(locale, "browserData")}
                description={t(locale, "browserDataDescription")}
              >
                <div className="browser-settings__data-actions">
                  <button
                    className={clearConfirm ? "browser-settings__clear browser-settings__clear--confirm" : "browser-settings__clear"}
                    type="button"
                    disabled={clearingBrowserData}
                    onClick={() => void clearBrowserData()}
                  >
                    {clearingBrowserData
                      ? t(locale, "browserDataClearing")
                      : clearConfirm
                        ? t(locale, "browserDataClearConfirm")
                        : t(locale, "browserDataClear")}
                  </button>
                  {clearConfirm && !clearingBrowserData && (
                    <button className="browser-settings__cancel" type="button" onClick={() => setClearConfirm(false)}>
                      {t(locale, "cancel")}
                    </button>
                  )}
                </div>
                {browserDataMessage && <p className="browser-settings__message" role="status">{browserDataMessage}</p>}
              </SettingGroup>
            </>
          )}

          {section === "plugins" && (
            <PluginSettingsSection
              settings={settings}
              plugins={plugins}
              onPreviewPlugin={onPreviewPlugin}
              onInstallPlugin={onInstallPlugin}
              onSetPluginEnabled={onSetPluginEnabled}
              onUninstallPlugin={onUninstallPlugin}
              onOpenPluginContribution={onOpenPluginContribution}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function BrowserDownloadList({
  downloads,
  locale
}: {
  downloads: BrowserDownloadSnapshot[];
  locale: LocaleId;
}): React.JSX.Element {
  const recent = [...downloads]
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, 6);
  if (recent.length === 0) return <p className="browser-settings__empty">{t(locale, "browserNoDownloads")}</p>;

  return (
    <div className="browser-settings__list" data-wheel-owner="local">
      {recent.map((download) => {
        const percent = download.totalBytes > 0
          ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100))
          : null;
        return (
          <div className="browser-settings__download" key={download.id}>
            <span className="browser-settings__download-icon"><UiIcon name="download" size={15} /></span>
            <span className="browser-settings__row-copy">
              <strong title={download.fileName}>{download.fileName}</strong>
              <small>{downloadStatusLabel(locale, download.status)}{percent === null ? "" : `, ${percent}%`}</small>
            </span>
            {download.status === "progressing" && percent !== null && (
              <span className="browser-settings__progress" aria-label={`${percent}%`}>
                <span style={{ width: `${percent}%` }} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BrowserActivityList({
  activity,
  state,
  locale
}: {
  activity: BrowserActivityEvent[];
  state: "idle" | "loading" | "ready" | "error";
  locale: LocaleId;
}): React.JSX.Element {
  if (state === "loading" || state === "idle") {
    return <p className="browser-settings__empty">{t(locale, "browserActivityLoading")}</p>;
  }
  if (state === "error") return <p className="browser-settings__empty browser-settings__empty--error">{t(locale, "browserActivityFailed")}</p>;
  const recent = [...activity].sort((left, right) => right.sequence - left.sequence).slice(0, 10);
  if (recent.length === 0) return <p className="browser-settings__empty">{t(locale, "browserNoActivity")}</p>;

  return (
    <div className="browser-settings__list" data-wheel-owner="local">
      {recent.map((event) => {
        const provider = event.provider ?? "unknown";
        return (
          <div className={`browser-settings__activity ${event.ok ? "" : "browser-settings__activity--failed"}`} key={event.sequence}>
            <span
              className="browser-settings__agent-mark"
              style={{ "--agent-color": BROWSER_PROVIDER_COLORS[provider] } as React.CSSProperties}
              aria-hidden="true"
            />
            <span className="browser-settings__row-copy">
              <strong title={event.agentId ?? t(locale, "browserYou")}>{event.agentId ?? t(locale, "browserYou")}</strong>
              <small>{activityOperationLabel(locale, event.operation)}</small>
            </span>
            <time dateTime={new Date(event.timestamp).toISOString()}>
              {new Date(event.timestamp).toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-GB", {
                hour: "2-digit",
                minute: "2-digit"
              })}
            </time>
          </div>
        );
      })}
    </div>
  );
}

function downloadStatusLabel(locale: LocaleId, status: BrowserDownloadSnapshot["status"]): string {
  const keys = {
    pending: "browserDownloadPending",
    progressing: "browserDownloadProgressing",
    completed: "browserDownloadCompleted",
    canceled: "browserDownloadCanceled",
    interrupted: "browserDownloadInterrupted"
  } as const;
  return t(locale, keys[status]);
}

const ACTIVITY_LABELS: Record<LocaleId, Record<BrowserCommandType, string>> = {
  ru: {
    browser_list_tabs: "Просмотрел вкладки",
    browser_new_tab: "Открыл вкладку",
    browser_close_tab: "Закрыл вкладку",
    browser_activate_tab: "Выбрал вкладку",
    browser_navigate: "Перешёл по адресу",
    browser_back: "Вернулся назад",
    browser_forward: "Перешёл вперёд",
    browser_reload: "Обновил страницу",
    browser_observe: "Осмотрел страницу",
    browser_read_page: "Прочитал страницу",
    browser_screenshot: "Сделал снимок",
    browser_click: "Нажал на странице",
    browser_hover: "Навёл курсор",
    browser_type: "Ввёл текст",
    browser_select: "Выбрал значение",
    browser_press: "Нажал клавишу",
    browser_scroll: "Прокрутил страницу",
    browser_drag: "Перетащил элемент",
    browser_wait_for: "Ждал изменения",
    browser_handle_dialog: "Ответил сайту",
    browser_download_wait: "Ждал загрузку",
    browser_upload: "Передал файл",
    browser_get_activity: "Проверил историю"
  },
  en: {
    browser_list_tabs: "Viewed tabs",
    browser_new_tab: "Opened a tab",
    browser_close_tab: "Closed a tab",
    browser_activate_tab: "Selected a tab",
    browser_navigate: "Opened an address",
    browser_back: "Went back",
    browser_forward: "Went forward",
    browser_reload: "Reloaded the page",
    browser_observe: "Inspected the page",
    browser_read_page: "Read the page",
    browser_screenshot: "Took a screenshot",
    browser_click: "Clicked the page",
    browser_hover: "Moved the pointer",
    browser_type: "Entered text",
    browser_select: "Selected a value",
    browser_press: "Pressed a key",
    browser_scroll: "Scrolled the page",
    browser_drag: "Dragged an item",
    browser_wait_for: "Waited for a change",
    browser_handle_dialog: "Answered the site",
    browser_download_wait: "Waited for a download",
    browser_upload: "Uploaded a file",
    browser_get_activity: "Checked activity"
  }
};

function activityOperationLabel(locale: LocaleId, operation: BrowserCommandType): string {
  return ACTIVITY_LABELS[locale][operation];
}

function ShortcutRow({
  label,
  value,
  capturing,
  onStart,
  onKeyDown
}: {
  label: string;
  value: string;
  capturing: boolean;
  onStart(): void;
  onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void;
}): React.JSX.Element {
  return (
    <div className="shortcut-editor__row">
      <span>{label}</span>
      <button
        className={capturing ? "shortcut-editor__key shortcut-editor__key--capturing" : "shortcut-editor__key"}
        type="button"
        data-shortcut-capture="true"
        onClick={onStart}
        onKeyDown={(event) => {
          if (capturing) onKeyDown(event);
        }}
      >{capturing ? "…" : value}</button>
    </div>
  );
}

function SettingGroup({
  label,
  description,
  children
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="setting-group">
      <h3>{label}</h3>
      {description && <p className="setting-group__description">{description}</p>}
      {children}
    </section>
  );
}

function Segmented({
  value,
  options,
  onChange
}: {
  value: string;
  options: [string, string][];
  onChange(value: string): void;
}): React.JSX.Element {
  return (
    <div className="segmented">
      {options.map(([optionValue, label]) => (
        <button
          className={value === optionValue ? "segmented__button segmented__button--active" : "segmented__button"}
          type="button"
          key={optionValue}
          onClick={() => onChange(optionValue)}
        >{label}</button>
      ))}
    </div>
  );
}
