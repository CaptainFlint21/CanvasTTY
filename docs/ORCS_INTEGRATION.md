# ORCS Control Room integration

This fork uses CanvasTTY as the desktop shell for a separate local ORCS runtime.
The first implementation phase is intentionally read-only and mock-backed.

## Primary deployment target

The authoritative environment for ORCS Desktop is the Ubuntu desktop workstation named `kate`.
ORCS core, the CanvasTTY fork, local worktrees, tests and the desktop application all run on this same machine.

Initial platform target:

- Ubuntu Desktop on `kate`;
- Linux x86_64;
- local graphical user session;
- no cloud-hosted GUI or remote backend;
- AppImage/deb packaging after development smoke checks pass;
- Windows and macOS support are deferred and are not Phase 0 acceptance requirements.

Expected local layout:

```text
$HOME/llm/orcs/
├── Orcs-repo/             clean ORCS main / source of truth
├── Orcs-workspace/        ORCS task worktree
├── CanvasTTY-repo/        clean CanvasTTY fork main / source of truth
├── CanvasTTY-workspace/   CanvasTTY task worktree
└── docs/                  local project notes
```

Ignored local configuration remains inside the appropriate workspace and must never be copied into the GUI repository or renderer state.

## Repository boundary

| Repository | Responsibility |
|:--|:--|
| `CaptainFlint21/Orcs` | Python orchestration, roles, tools, verification, audit, budgets and approval policy |
| `CaptainFlint21/CanvasTTY` | Electron desktop, typed renderer contract and ORCS visualization |
| `howdeploy/CanvasTTY` | Upstream desktop framework |

The GUI must not import the Python package, copy API keys into Electron settings or parse terminal output to infer ORCS state.

## Target process boundary on Ubuntu

```text
React renderer
    │ sanitized OrcsSnapshot only
    ▼
preload bridge
    │ allow-listed ORCS IPC
    ▼
Electron main process
    │ local Unix domain socket client
    ▼
ORCS daemon in kate user session
```

Phase 0 stops before the preload, IPC and daemon layers. It provides the strict snapshot contract, deterministic mock data and UI components that consume only that contract.

## Planned local daemon transport

Because both applications run on the same Ubuntu workstation, the preferred transport is a Unix domain socket rather than a TCP listener.

Planned endpoint:

```text
$XDG_RUNTIME_DIR/orcs/orcs.sock
```

On a normal Ubuntu user session this resolves under `/run/user/<uid>/` and disappears when the user session ends.

Requirements:

- socket owned by the `kate` user;
- socket mode `0600`;
- parent directory mode `0700`;
- no bind on LAN, TUN, proxy or public interfaces;
- no fixed TCP port and no browser CORS surface;
- Electron main owns the socket client; renderer never opens it directly;
- strict schema validation before data crosses preload IPC;
- bounded request and response sizes;
- read-only snapshot method before any mutation method;
- reconnect/backoff without spawning duplicate daemons;
- optional systemd user service or socket activation, never a root system service;
- daemon logs must redact secrets and must not persist raw prompts or provider responses by default.

A loopback HTTP fallback may be considered only if an Electron or Python library limitation makes Unix sockets impractical. It would require `127.0.0.1` binding, a random port and a short-lived session token.

## Snapshot rules

`src/shared/orcs.ts` is the single cross-process DTO definition.

The contract exposes only:

- run, phase and approval-gate status;
- five role cards;
- provider/model labels and fallback level;
- bounded tool-call counters;
- bounded sanitized summaries;
- bounded verification checks;
- bounded timeline events.

The contract rejects unknown fields. It has no generic metadata object and no fields for:

- API keys or provider credentials;
- `.env` values;
- prompts or full model responses;
- PTY buffers;
- working-directory or absolute filesystem paths;
- arbitrary command output;
- patch bodies or complete file contents.

## Phase 0 UI

The read-only Control Room will render:

1. a HOME status widget;
2. a spatial five-role canvas;
3. an approval-gate banner;
4. a verification summary;
5. an event timeline;
6. explicit mock, loading, stale and unavailable states.

No Phase 0 control may launch ORCS, apply a patch, execute a command, commit, push, open a pull request or merge.

## Ubuntu desktop integration

Later packaging should provide:

- a Linux desktop entry for ORCS Desktop;
- AppImage and/or deb output for Ubuntu x86_64;
- user-session startup only when explicitly enabled;
- diagnostics that report Node/Electron, Python and daemon status without reading `.env`;
- clear unavailable state when the ORCS daemon is stopped;
- no dependency on SSH, Railway, Netlify or another remote host for normal operation.

Development and smoke verification must run from the `kate` graphical desktop session so Electron, `node-pty`, Wayland/X11 behavior, filesystem permissions and the user runtime directory are exercised in the real target environment.

## Upstream maintenance

- keep fork `main` close to `howdeploy/CanvasTTY/main`;
- develop ORCS work on `orcs/*` branches;
- record the upstream base SHA in each ORCS pull request;
- minimize edits to CanvasTTY core services;
- prefer separate ORCS feature modules and explicit typed contracts;
- resolve upstream drift before adding new privileged capabilities.

## Required verification

```bash
npm test
npm run typecheck
npm run build
```

Before merge, perform a real Electron smoke check on Ubuntu Desktop `kate` and verify that existing terminal, plugin, browser and settings behavior is unchanged.
