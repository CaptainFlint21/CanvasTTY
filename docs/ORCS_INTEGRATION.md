# ORCS Control Room integration

This fork uses CanvasTTY as the desktop shell for a separate local ORCS runtime.
The first implementation phase is intentionally read-only and mock-backed.

## Repository boundary

| Repository | Responsibility |
|:--|:--|
| `CaptainFlint21/Orcs` | Python orchestration, roles, tools, verification, audit, budgets and approval policy |
| `CaptainFlint21/CanvasTTY` | Electron desktop, typed renderer contract and ORCS visualization |
| `howdeploy/CanvasTTY` | Upstream desktop framework |

The GUI must not import the Python package, copy API keys into Electron settings or parse terminal output to infer ORCS state.

## Target process boundary

```text
React renderer
    │ sanitized OrcsSnapshot only
    ▼
preload bridge
    │ allow-listed ORCS IPC
    ▼
Electron main process
    │ loopback-only authenticated client
    ▼
ORCS local daemon
```

Phase 0 stops before the preload, IPC and daemon layers. It provides the strict snapshot contract, deterministic mock data and UI components that consume only that contract.

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

## Later daemon transport

A later phase may add a localhost transport with these requirements:

- bind only to `127.0.0.1` on a random port;
- short-lived pairing/session token;
- strict schema validation before state crosses IPC;
- no wildcard CORS;
- no token persistence in the repository;
- read-only snapshot endpoint before any mutation endpoint;
- server-sent events or WebSocket messages use the same bounded DTO;
- approval tokens bind to run ID, exact HEAD and operation hash.

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

Before merge, perform a real Electron smoke check and verify that existing terminal, plugin, browser and settings behavior is unchanged.
