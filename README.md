# @juanibiapina/pi-plan

A [pi](https://github.com/badlogic/pi-mono) extension for plan mode — read-only exploration and analysis.

> Originally based on [`juanibiapina/pi-plan`](https://github.com/juanibiapina/pi-plan), now continuing with changes in this fork.

## Features

- **`/plan` command** — Toggle plan mode on and off
- **Keyboard shortcut** — `alt+p` by default, configurable via `/extension-settings`
- **Read-only tools** — Only safe, non-modifying tools are available while in plan mode
- **System prompt guidance** — While active, plan mode adds explicit planning-only instructions to the system prompt
- **Session persistence** — Explicit plan-mode state is persisted for resume and integrations
- **Machine-readable state** — Emits explicit session state and live events for other extensions
- **Status indicator** — Shows `⏸ plan` in the status bar when active
- **Powerbar support** — Emits a `⏸ plan` segment to [pi-powerbar](https://github.com/juanibiapina/pi-powerbar) when plan mode is active

## Installation

```bash
pi install npm:@juanibiapina/pi-plan
```

## Usage

### Entering Plan Mode

Use `/plan` to toggle plan mode. When enabled:

- Only read-only tools are available (`read`, `bash`, `grep`, `find`, `ls`, `questionnaire`)
- The agent is instructed to only observe, analyze, and plan — no modifications
- A `⏸ plan` indicator appears in the status bar

### Exiting Plan Mode

Use `/plan` again to return to normal mode with full tool access.

### Keyboard Shortcut

`alt+p` is bound by default. To change or disable it, use `/extension-settings` and edit the `shortcut` setting under `plan` (e.g. `tab`, `ctrl+alt+p`, or empty to disable it).

> **Note:** The `/extension-settings` command is provided by the [`@juanibiapina/pi-extension-settings`](https://github.com/juanibiapina/pi-extension-settings) package, which must be installed separately:
>
> ```bash
> pi install npm:@juanibiapina/pi-extension-settings
> ```

### CLI Flag

Start pi directly in plan mode:

```bash
pi --plan
```

### How It Works

While plan mode is active, `pi-plan` appends a planning-only instruction block to the system prompt for each turn. That prompt explicitly forbids direct file edits and workaround paths such as Python scripts, shell redirection, or generated scripts used to bypass blocked tools.

Separately, `pi-plan` persists explicit machine-readable session state so plan mode can be restored on resume and detected reliably by other extensions. On resume, `pi-plan` prefers that explicit state and falls back to the older hidden `plan-mode-enter` / `plan-mode-exit` message history for backward compatibility with older sessions.

### Integration

Other extensions can integrate with `pi-plan` in two ways:

1. **Persistent session state** via a custom session entry:
   - `customType: "plan-mode-state"`
   - `data: { enabled: boolean, source: "@indigoviolet/pi-plan" }`

   This is the canonical integration point for checking whether plan mode is currently active from `ctx.sessionManager.getEntries()`.

2. **Live event notifications** via the shared event bus:
   - event: `"plan-mode:changed"`
   - payload: `{ enabled: boolean, source: "@indigoviolet/pi-plan" }`

Current integrations should prefer `plan-mode-state` for machine-readable state. Legacy hidden `plan-mode-enter` / `plan-mode-exit` messages are only consulted when restoring older sessions that predate explicit state persistence.

## License

MIT
