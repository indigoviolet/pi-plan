> **⚠️ Deprecated** — This extension is deprecated. The same functionality is better achieved with a simple [prompt template](https://github.com/juanibiapina/dotfiles/blob/main/dotfiles/pi/.pi/agent/prompts/plan.md). Drop a `plan.md` file in `~/.pi/agent/prompts/` and invoke it with `/plan <description>`.

---

# @juanibiapina/pi-plan

A [pi](https://github.com/badlogic/pi-mono) extension for plan mode — read-only exploration and analysis.

## Features

- **`/plan` command** — Toggle plan mode on and off
- **Keyboard shortcut** — `alt+p` by default, configurable via `/extension-settings`
- **Read-only tools** — Only safe, non-modifying tools are available while in plan mode
- **Session persistence** — System reminders are kept in session history, so what the LLM sees is exactly what you see
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

Plan mode works by injecting system reminder messages into the session when the mode changes. These messages instruct the LLM to operate in read-only mode (or restore full access when exiting). The messages are kept in the session history, so what is sent to the LLM is always exactly what you see in the session — no hidden prompt manipulation.

In addition, `pi-plan` now writes explicit machine-readable session state so other extensions can reliably detect plan mode without scraping hidden prompt messages. On resume, `pi-plan` prefers that explicit state and falls back to the older hidden-message history for backward compatibility.

### Integration

Other extensions can integrate with `pi-plan` in two ways:

1. **Persistent session state** via a custom session entry:
   - `customType: "plan-mode-state"`
   - `data: { enabled: boolean, source: "@indigoviolet/pi-plan" }`

   This is the canonical integration point for checking whether plan mode is currently active from `ctx.sessionManager.getEntries()`.

2. **Live event notifications** via the shared event bus:
   - event: `"plan-mode:changed"`
   - payload: `{ enabled: boolean, source: "@indigoviolet/pi-plan" }`

The hidden `plan-mode-enter` / `plan-mode-exit` messages are still emitted for LLM behavior, but integrations should prefer `plan-mode-state` for machine-readable state.

## License

MIT
