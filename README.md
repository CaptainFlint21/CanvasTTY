<p align="center">
  <img src="docs/assets/canvastty-cover.png" alt="CanvasTTY — a spatial desktop for local terminals and AI agents" width="100%">
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<table>
  <tr>
    <td>
      <strong>Your terminals are places, not tabs.</strong><br>
      CanvasTTY is an Electron spatial desktop for real local PTYs and AI-agent CLI sessions. Keep a fixed Home zone, arrange live terminals on an infinite canvas, and see provider limits backed by real data sources.
    </td>
  </tr>
</table>

## Stack

| Desktop | Interface | Terminal | Providers |
|:--|:--|:--|:--|
| **Electron**<br>electron-vite | **React**<br>TypeScript | **xterm.js**<br>node-pty | **Codex**<br>Claude · Kimi |

The application interface currently supports English and Russian. This documentation is also available in Simplified Chinese.

## One canvas, real sessions

Launch a shell or agent in a project directory, move and resize its live terminal, zoom out to navigate semantically, and return to Home for sessions, limits, media, and launch shortcuts. CanvasTTY keeps PTY state in the trusted main process and exposes only typed, allow-listed capabilities to the renderer.

## Install

Download the `1.0.1` release from [GitHub Releases](https://github.com/howdeploy/CanvasTTY/releases): AppImage/deb for Linux x86_64, installer/portable app for Windows x64, and dmg/zip for Apple Silicon macOS. Packages are not yet code-signed or notarized; Intel Mac builds are not included yet. Read [installing and local-data security](docs/installing-and-security.md).

Or run from source:

```bash
npm install
npm run dev
```

## Docs

| Start here | Build on CanvasTTY |
|:--|:--|
| [Documentation hub](docs/README.md) | [Widget authoring](docs/widget-authoring.md) |
| [Getting started](docs/getting-started.md) | [Metrics and telemetry](docs/metrics-and-telemetry.md) |
| [Install, releases, and local data](docs/installing-and-security.md) | [Security policy](SECURITY.md) |
| [Architecture](docs/ARCHITECTURE.md) | [UI contract](docs/UI_CONTRACT.md) |
| [Runtime plugin authoring](docs/plugins.md) | [Typed plugin SDK](docs/plugin-api.d.ts) |
| [Changelog](CHANGELOG.md) | [MIT license](LICENSE) |

## Runtime plugins

CanvasTTY includes a permissioned runtime for ready-to-run static GitHub packages: HOME widgets, canvas apps, and separate sandboxed windows. The host SDK now supports persistent user-selected music-library grants, seekable local audio streams, and bounded playlist import/export for full player plugins. See the [authoring and security guide](docs/plugins.md), [manifest schema](docs/canvastty-plugin.schema.json), and [TypeScript SDK declarations](docs/plugin-api.d.ts).

## Built-in agent browser

CanvasTTY includes a core browser rather than a plugin capability: trusted React chrome backed by sandboxed Electron `WebContentsView` tabs in one persistent Chromium profile. It is available from HOME, restores safe HTTP(S) tabs, keeps website credentials inside Chromium, manages downloads/uploads, and exposes typed browser actions to Claude Code, Codex, and Kimi sessions launched by CanvasTTY.

Agent access uses an authenticated local socket or named pipe and a bundled stdio MCP helper. It does not open a TCP or remote-debugging port and never exports cookies, passwords, auth headers, local storage, arbitrary JavaScript, or raw CDP. See [Architecture](docs/ARCHITECTURE.md) for the trust, audit, and concurrency boundaries.

## Quick checks

```bash
npm test
npm run typecheck
npm run build
```

## License

CanvasTTY is released under the [MIT License](LICENSE).
