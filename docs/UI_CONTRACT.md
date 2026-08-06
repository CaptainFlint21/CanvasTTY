# UI contract

[English](UI_CONTRACT.md) · [Русский](UI_CONTRACT.ru.md) · [简体中文](UI_CONTRACT.zh-CN.md)

This contract preserves the approved MVP concept and prevents feature ownership from drifting.

## Home zone

- HOME uses fixed-size `82 × 72` logical cells with `18px` gaps so enlarging the page never makes existing widgets smaller. Fresh profiles start at `16 × 12`, while the original arrangement remains in the upper-left `12 × 8` area and leaves explicit spare space for plugins. Its persisted boundary and cell grid are shown only in Edit HOME, where the bottom-right corner resizes the area up to the generous `48 × 36` safety ceiling.
- The wide left tile contains exactly Codex, Claude, and Kimi limit rows. Each row prefers the provider's longest real default quota window (the weekly window when exposed), and falls back to another real window only when needed. It shows the countdown to that window's `resetsAt` and the matching usage rail. Values below one day use `HH:MM`; longer values use `Nд HHч`/`Nd HHh`. Window length stays in accessible metadata; unavailable data is labeled and has no fake reset or percentage.
- The right tile is the only session list. Its viewport shows three rows and scrolls when more real sessions exist; it never discards rows. Each row shows provider mark, localized semantic state, and identity. Session duration and limit-style progress rails never appear here.
- The clock is the dominant middle tile and renders only `HH:MM`. The adjacent media tile is an autonomous widget: click to pick or replace an image/GIF; remove from the widget itself.
- The bottom dock contains Terminal, Codex, Claude, Kimi, and Browser. Settings is a separate tile. Browser opens or focuses the one built-in browser card and never launches an external browser.
- Every default tile except Settings may be hidden. Settings remains the recovery entry point. Edit HOME mode shows the full cell grid and exact HOME boundary, hides all terminal and canvas-plugin windows, and keeps its changes as a draft until Save. Tiles move without overlap and may temporarily cross any HOME edge; Save is disabled until every tile is fully inside. Every tile edge and corner resizes it while preserving the opposite edge, with visible cues only at the top-left and bottom-right corners. The boundary can grow or shrink without crossing placed widgets. Adding a widget automatically grows HOME when the current boundary is full.
- Runtime HOME widgets use the same tile bounds and zoom behavior. Their UI runs inside a sandboxed iframe and cannot reach the trusted renderer DOM or `window.canvasTTY`.

## Launch and settings

- Clicking a provider opens a Focus Card for that provider. The provider is fixed; there is no second provider selector.
- The Focus Card contains only the provider mark, project folder, Normal/YOLO profile, launch action, and contextual danger confirmation.
- Settings uses a top section strip: General, Appearance, Controls, Browser, and Plugins. General owns language. Appearance owns palette, background pattern, the shortcut-hint toggle, system HOME tiles, and the HOME editor entry. Controls owns click focus, hover focus, window snapping, edge panning, zoom sensitivity, wheel direction, and keyboard shortcuts. Browser owns agent access, tab restore, downloads, redacted activity, and browser-data clearing. Plugins owns install preview, permission review, the installed-plugin list, enable/disable/uninstall, and contribution actions. Media controls never appear there.
- Click focus has three explicit modes: Off, Single click, and Double click. It is off by default. Selection and its visible outline still work when camera focus is off; a double-click mode never jumps the camera on the first click.
- Selection is exclusive: pressing on empty canvas clears it. The selected live terminal holds xterm keyboard focus and loses it on deselect.
- Hover focus is a separate off-by-default selection mode: after a configurable delay (slow `500ms`, normal `250ms`, fast `80ms`) the terminal under the pointer becomes selected and receives keyboard focus; leaving the card clears the selection after the same delay.
- Keyboard shortcuts are user-remappable and persisted locally. Defaults are `Home` for focusing the Home zone and `F2` for renaming the selected terminal window. Rename is an inline header edit and does not recreate the PTY. A compact passive hint in the canvas bottom-right reflects the persisted bindings immediately and can be hidden from Appearance.
- Snapping is enabled by default and can be disabled without changing existing window bounds. Edge panning remains off by default and exposes slow/normal/fast speed. Wheel direction is configurable separately for terminal scrolling and camera zoom. By default, wheel-down scrolls a live terminal down, while camera zoom preserves the original CanvasTTY direction.

## Visual system

- Flat, large, pastel tiles; strong dark/light contrast; restrained shadows; no ornamental micro-controls or explanatory microcopy around self-evident controls.
- Home renders at `1:1` whenever its current persisted boundary fits. Auto-fit uses discrete scale steps down to `0.2×` and integer camera coordinates so borders and dock spacing stay optically even across larger plugin layouts.
- System actions use locally vendored SVGs from the official Lucide repository. Do not hand-draw system icons in TSX and do not add an icon runtime package.
- Provider marks use unmodified vendor assets. Do not redraw, recolor, filter, or approximate them. Kimi's raster mark must not render above its native `48px` size.
- Dots and grid are CSS patterns. Waves use the seamless SVG tile in `assets/patterns/waves.svg`; do not emulate waves with radial gradients.
- Terminal cards keep a `54px` header. At normal scale the header shows the provider mark and terminal working directory until the user explicitly renames the window; a custom title then replaces the path. Close is the only window action and stays visible at the far right; canvas cards do not expose maximize/fullscreen. There is no lifecycle dot in terminal chrome.
- Terminal cards switch to semantic summary mode below `0.5×`. Summary typography counter-scales as the camera moves farther out so identical cards keep the same readable hierarchy instead of exposing tiny xterm text.
- In semantic summary mode a card is a canvas navigation target: wheel input zooms the camera around it, and clicking the summary always selects it with a visible card outline. Camera focus follows only the configured Off/Single click/Double click mode. At normal scale the live terminal regains wheel ownership.
- Every terminal edge and corner is a resize target. The minimum card size is `420 × 260`; resizing updates the xterm viewport and preserves the opposite edge.
- Live terminal selection follows the visible pointer position at every canvas zoom. With a non-empty selection, `Ctrl+C`/`Ctrl+Shift+C` (or `Cmd+C`) copies it; `Ctrl+Shift+V`/`Cmd+V` and `Shift+Insert` paste from the system clipboard. Plain `Ctrl+C` without a selection remains the PTY interrupt. `Shift+Enter` sends a line-break sequence (`ESC [ 13 ; 2 u`) to the PTY instead of submitting the line.
- Canvas plugin apps use the same movable card grammar, `54px` header, resize/snap behavior, and semantic summary below `0.5×`. A `window` contribution opens a separate CanvasTTY-owned sandboxed window; arbitrary native window embedding is not part of the contract.
- The built-in Browser is one movable, resizable core canvas card, not a plugin contribution. Its trusted DOM chrome owns compact tabs/favicons, address/search, back/forward/reload, downloads, per-tab provider badges, site dialogs, explicit Close tab/Close all, and the hide-card action. Hiding the card keeps its tabs and shared authenticated Chromium profile alive. Below `0.5×`, during Edit HOME, and behind trusted dialogs/popovers, the native page is hidden and replaced with a semantic summary instead of covering renderer UI.
- While an agent connection is alive, its branded cursor remains at its latest page position and its badge remains visible in trusted tab chrome. Claude uses `#D97757`, Codex `#10A37F`, Kimi `#7C5CFC`, and an unknown provider `#7A8291`. Cursor/badge visibility has no MVP toggle; the Browser agent-access kill switch revokes the connection instead.
- With window snapping enabled, drag and resize use a hidden `10px` grid and a `10px` magnetic threshold for neighboring edges, centers, and a consistent `20px` gap.
- Wheel input belongs to the surface under the pointer when that surface actually scrolls or consumes wheel input. The session list and terminal/card surfaces never zoom the camera. Passive Home widgets — limits, clock, media, and launcher tiles — still allow camera zoom so Home does not shrink the usable zoom area.
- The canvas edge-pans RTS-style while the pointer rests within `56px` of a viewport edge over empty canvas; speed ramps linearly up to `900px/s` at the edge itself. Edge panning is off by default and enabled in Settings. Motion pauses over interactive surfaces (terminal cards, Home, controls) and while drag-panning.
- Dialog close actions stay inside their own header/control row with a consistent inset; they never overlap a field, outline, or panel boundary.

## Acceptance checks

- No custom `<svg>` or `<path>` elements in React TSX.
- No media picker or media-fit selector in Settings.
- No provider picker inside `AgentLaunchDialog`.
- No maximize/fullscreen action inside a canvas card.
- No fake counts, percentages, reset timers, determinate progress, or placeholder sessions.
- Plugin install always shows the validated manifest and requested permissions before confirmation; repository scripts are never executed.
- A newly opened PTY starts as `idle`. Only a structured provider lifecycle signal may mark it `working` or `needs_approval`; PTY existence and terminal text are not activity signals.
- `needs_approval` is displayed only after a structured provider-adapter signal; terminal output is never parsed to invent it.
- Home, Focus Card, Settings, and at least one live terminal are inspected in the real Electron window after build.
