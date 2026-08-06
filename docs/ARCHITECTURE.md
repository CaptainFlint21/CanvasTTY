# Architecture

[English](ARCHITECTURE.md) · [Русский](ARCHITECTURE.ru.md) · [简体中文](ARCHITECTURE.zh-CN.md)

## Process boundaries

CanvasTTY follows Electron's three-layer model:

```text
React renderer
    │ typed window.canvasTTY API
    ▼
preload bridge (contextBridge)
    │ allow-listed IPC channels
    ▼
Electron main process
    ├── SettingsStore  → validated, atomic JSON persistence
    ├── TerminalManager → node-pty lifecycle, bounded scrollback, and output batching
    ├── LimitsService  → sanitized provider-limit adapters and cache
    ├── PluginManager  → GitHub install, manifest validation, assets, permissions, storage
    ├── PluginMediaService → user-granted music folders, ranged audio streams, playlist files
    ├── BrowserService → tabs, shared persistent profile, downloads, presence, WebContentsView lifecycle
    │   ├── BrowserStore / BrowserPolicyService / BrowserAuditStore
    │   ├── BrowserCore / BrowserCommandDispatcher / BrowserAutomationService
    │   └── AgentGateway → authenticated UDS/named pipe for the bundled stdio MCP helper
    ├── canvastty-plugin:// → CSP-constrained static plugin resources
    ├── canvastty-media:// → permission-checked local audio streams
    └── native dialogs/window controls
```

- `src/shared/contracts.ts` is the single public contract between processes. Add or change cross-process data here first.
- `src/preload/index.ts` exposes only the typed capabilities the renderer needs. Node integration stays disabled; context isolation and sandbox stay enabled.
- `src/main/ipc/registerIpc.ts` owns native side effects and validates access to persisted media.
- `src/main/services/TerminalManager.ts` is the source of truth for live session state and PTY buffers. It keeps scrollback in a bounded chunk buffer and coalesces PTY data into 16ms IPC batches so clear/redraw sequences reach xterm together. A new PTY is `idle`; process exit provides only `done` or `failed`. `working` and `needs_approval` are accepted only as typed provider lifecycle signals, never inferred from PTY existence or terminal text.
- `src/main/services/LimitsService.ts` reads Codex through the installed CLI's app-server protocol and Claude/Kimi through their provider usage endpoints. Provider credentials are read only inside the trusted main process, sent only to the matching provider over HTTPS, and never logged or exposed over IPC. The service owns timeout, structural normalization, caching, stale fallback, and subprocess cleanup; raw provider responses never cross IPC.
- `src/main/services/SettingsStore.ts` normalizes every update and persists through a serialized atomic write.
- `src/main/services/PluginManager.ts` installs ready-to-run static repositories without executing package scripts, rejects symlinks and oversized packages, persists the enabled registry, serves only contained package files, and enforces per-plugin permissions/storage quotas.
- `src/main/services/PluginMediaService.ts` persists per-plugin grants only after a native folder choice, hides absolute paths, skips symlinks, and serves contained audio with HTTP Range semantics. Playlist reads stay inside granted libraries; writes are bounded and atomic under the library's `Playlists/` directory.
- `src/main/services/BrowserService.ts` is the only owner of the built-in browser's `WebContentsView` tabs and shared persistent partition. Remote pages have no preload or Node access, keep context isolation and sandbox enabled, and cannot request hardware, location, notification, clipboard-read, certificate-bypass, or external-protocol capabilities. HTTP(S) popups are adopted as internal tabs; other schemes are rejected.
- `src/main/services/browser/` contains the browser kernel. `BrowserStore` atomically persists only tab order, active tab, and safe restore URLs. `BrowserPolicyService` centralizes URL, permission, download, and upload rules; validated uploads are copied through an already-open no-follow file descriptor into private staging before Chromium sees them. `BrowserAutomationService` attaches Electron's internal debugger to the existing live tab without a remote-debugging port. `BrowserCommandDispatcher` adds revisions, revision-bound refs, mutation request deduplication, per-tab FIFO mutation lanes, bounded concurrency, typed errors, and redacted fail-closed audit for agent mutations.
- `src/main/services/agent-browser/` exposes the kernel only through an authenticated user-local Unix socket (`0600`) or Windows named pipe. The Windows pipe is created by the bundled native host with a protected DACL containing only the exact current-user SID and rejects remote clients. Each agent PTY receives a one-use capability through its child environment. The bundled stdio MCP helper is the only protocol adapter; no TCP listener, cookie/storage endpoint, arbitrary evaluation tool, or raw CDP surface exists.
- `TerminalManager` injects the MCP helper per launch for Claude Code and Codex without changing their global configuration. Kimi uses its per-run MCP configuration when supported; older Kimi versions receive a compare-and-swap temporary CanvasTTY entry and one exact permission rule with an atomic recovery journal. Unrelated MCP entries, credentials, and file/shell permissions are preserved.
- `src/main/services/cliEnvironment.ts` supplements the graphical-session `PATH` with existing per-user CLI directories before any provider process is spawned. It never reads shell startup scripts.

The primary `BrowserWindow` is created and shown with a lightweight local startup page before settings, plugins, media, and IPC services initialize. Successful initialization replaces that page with the trusted renderer; bootstrap failures replace it with a visible error page and retain a native-dialog fallback. The main process holds Electron's single-instance lock and restores/focuses the existing window when another launch is attempted.

Runtime plugin code is never imported into main or the trusted renderer bundle. HOME widgets and canvas apps run in sandboxed iframes with an opaque origin. Separate plugin windows use a dedicated narrow preload which forwards the same message SDK through an IPC handler that verifies the actual `canvastty-plugin://<id>/<entry>` sender URL. Arbitrary native OS windows are not embedded.

Plugin music access is capability-based rather than generic filesystem access. Media scans return library IDs, relative paths, metadata, and `canvastty-media://` stream URLs; raw playlist text remains the only format-neutral file content exposed. A media URL is resolved only for the owning enabled plugin and only beneath a previously selected library root. Removing a plugin revokes its persisted folder grants.

The built-in browser is split across surfaces: `BrowserCard` renders trusted tabs, navigation, agent badges, downloads, dialogs, and canvas geometry, while `BrowserService` positions the active native view over the measured viewport. The native view is hidden during semantic summary, HOME editing, and trusted modal surfaces. A transparent trusted mouse-passthrough window draws live agent cursors above the native view; Wayland uses an isolated-world fallback. Trusted tab badges remain the source of truth.

Renderer IPC and the agent gateway call the same `BrowserCore.execute(actor, command, signal)` boundary. Reads may run concurrently. Mutations are ordered FIFO per tab while different tabs remain independent; a repeated mutation request ID returns the recorded result. Navigation and document changes advance the revision, so stale accessibility refs fail before side effects. Agent activity is recorded as a redacted append-only hash chain: typed/page text, screenshots, URL query/fragment, credentials, headers, cookies, and tokens are not stored.

## Renderer boundaries

`App.tsx` is the orchestration boundary. It loads settings/sessions, subscribes to main-process events, and coordinates dialogs and persistence. Feature components do not call unrelated feature APIs.

```text
App
├── WorkspaceCanvas        camera, pan, zoom, spatial composition
│   ├── HomeZone           persisted resizable grid, visible boundary, and edit gestures
│   │   ├── homeModel      pure derivation of limit/active-session rows
│   │   └── HomeMediaWidget independent pick/replace/remove control
│   ├── TerminalCard       one live xterm view, selection, rename, drag, resize, and snap behavior
│   ├── PluginCanvasCard   sandboxed plugin app with canvas bounds and semantic summary
│   └── BrowserCard        trusted browser chrome and canvas geometry for the native WebContentsView
├── AgentLaunchDialog      fixed provider + folder + profile + launch
└── SettingsPanel          General, Appearance, Controls, Browser, and Plugins
    └── PluginSettingsSection install preview, permissions, registry, and contributions
```

Keep domain decisions in pure selectors such as `homeModel.ts`, orchestration in `App.tsx`, and rendering/local interaction in feature components. IPC calls belong in `App.tsx` or a feature that exclusively owns that capability.

## Session flow

1. Home requests a terminal or opens a provider-specific launch card.
2. `App` sends a typed `terminal:create` request.
3. `TerminalManager` validates the request, spawns the PTY, stores metadata and bounded chunked scrollback, then emits lifecycle events and 16ms-batched data events.
4. `App` reconciles lifecycle snapshots by session ID.
5. `TerminalCard` subscribes to its PTY stream, sends PTY input/grid resize events, and commits typed canvas bounds after a drag or edge resize.

`SessionMetadata` owns both world-space position and card size. `App` reconciles those bounds, while `TerminalCard` may hold transient pointer-move geometry until pointer-up. The main process validates and clamps committed sizes before emitting a session snapshot. Camera wheel handling is limited to empty canvas; interactive surfaces keep their native scroll/input ownership.

A live `TerminalCard` owns one xterm instance for the lifetime of its session ID. Palette changes update `terminal.options.theme` in place; title and settings changes must never dispose the terminal or its renderer-side scrollback. Window titles are updated as session metadata through `terminal:rename`. PTY input and resize events that race with process exit are contained at the main-process boundary and never surface as uncaught Electron errors.

Output batching is an IPC/rendering boundary, not a history boundary: every PTY chunk is appended to bounded scrollback immediately, while pending renderer output is flushed on the 16ms timer, before exit, and before disposal. Scrollback trimming advances through chunks instead of rebuilding the entire buffer for every write; snapshots join only the retained suffix.

Terminal pointer coordinates are converted from the canvas's visually transformed rectangle back to xterm layout coordinates before selection or wheel handling. Terminal and canvas wheel direction are normalized independently from persisted settings. Selected text is copied through the typed clipboard bridge with `Ctrl+C`, `Ctrl+Shift+C`, or `Cmd+C`; paste uses `Ctrl+Shift+V`, `Cmd+V`, or `Shift+Insert` and enters xterm through `Terminal.paste` rather than synthetic keystrokes. `Shift+Enter` sends the CSI-u modified Enter sequence directly to the PTY.

Application shortcuts are normalized in `SettingsStore`, matched in `App`, and rendered from the same persisted bindings in the canvas hint. `App` owns the selected session used by window actions such as rename; `TerminalCard` owns xterm focus and only the inline editor. Pressing empty canvas clears selection. Optional hover focus schedules the same configured delay on entry and exit; focus-in/focus-out sequences produced by this programmatic transition are suppressed before PTY input so agent TUIs do not reset their history position.

Session counters, progress bars, and statuses must always derive from actual `SessionSnapshot` values. The UI must not synthesize telemetry.

## Provider-limit flow

1. `App` requests a sanitized `LimitsSnapshot` at bootstrap and every 60 seconds.
2. `LimitsService` deduplicates refreshes and keeps a 60-second cache.
3. Codex is queried through `codex app-server` using `account/rateLimits/read`. Claude and Kimi use their read-only usage endpoints with the credentials already managed by each installed CLI. Responses are structurally validated and reduced to percentage, window, and reset time.
4. If a refresh fails after a successful read, the last valid snapshot is returned as stale. Missing or unsupported adapters return an explicit unavailable reason, never `0%`.
5. Claude's weekly window exists only for a Claude.ai subscription session. API Usage Billing is reported as `subscription-required`, not as a fake quota. CanvasTTY never parses provider TUI screens.

## Extension points

- Add a provider in `ProviderId`, `providers.ts`, `TerminalManager.resolveLaunch`, the official provider asset map, and an optional safe limit adapter.
- Add a persisted setting to `AppSettings`, defaults/normalization in `SettingsStore`, and the owning feature only. Settings owns user-facing canvas controls and shortcuts; camera math and snapping geometry remain pure renderer concerns.
- Add a canvas entity as a separate feature component with an explicit position and callbacks; keep camera ownership in `WorkspaceCanvas`.
- Publish a runtime extension with `canvastty.plugin.json` API v1 and static HTML/CSS/JS entries. Contribution kinds are `home-widget`, `canvas-app`, and `window`; capability access is restricted to declared permissions. See [Runtime plugins](plugins.md).

Every extension should pass `npm run typecheck`, `npm run build`, and a real Electron interaction check.
