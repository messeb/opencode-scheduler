# Configuration

[README](../README.md) · [Install](INSTALL.md) · [Usage](USAGE.md) · [Configuration](CONFIGURATION.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)

## Schedules

| Spec | Meaning |
|---|---|
| `0 9 * * 1-5`, `*/15 * * * *`, `0 0 1 jan *` | 5-field cron, local time (lists, ranges, steps, names) |
| `@hourly` `@daily` `@weekly` `@monthly` `@yearly` | cron macros |
| `every 30m`, `every 2h` | fixed interval (≥ 1m) |
| `at 2026-11-21 09:00` | one-shot |
| `continuous`, `continuous 5m` | back to back: start the next run once the previous one finishes, after a cooldown |
| `0 9 * * 1-3; 0 13 * * 1-5` | several schedules in one job, separated by `;` (not with `continuous`) |

A job never overlaps with itself: if the previous run is still active (including waiting for you), the slot is skipped. A run that was missed because the service was down fires once on the next start (`catchUp`).

## jobs.json

`~/.config/opencode/scheduler/jobs.json`. The file is re-read on every tick, so edits take effect without a restart.

```json
{
  "settings": {
    "terminal": "auto",
    "open": "click",
    "target": "app",
    "attachServer": "",
    "catchUp": true,
    "tickSeconds": 20
  },
  "jobs": [
    {
      "id": "triage",
      "directory": "/Users/me/src/app",
      "schedule": "0 9 * * 1-5",
      "skill": "triage",
      "prompt": "Focus on new bugs.",
      "agent": "build",
      "model": "anthropic/claude-sonnet-5-5",
      "session": "new",
      "permissions": "ask",
      "open": "click",
      "timeout": "2h",
      "notify": { "question": true, "permission": true, "done": true, "error": true },
      "enabled": true
    }
  ]
}
```

- `prompt` may reference skills and agents as `@skill:name` and `@agent:name`: skills are attached to the run, a primary agent runs the session, a subagent is named in the text so the main agent delegates to it.
- `skill` / `prompt` / `command`: at least one is required. `command` runs a slash command, and `prompt` becomes its arguments.
- `session`: `new` starts a fresh session per run. `reuse` keeps one long-lived session (it remembers earlier runs) and recreates it if it was deleted.
- `permissions`: `ask` notifies you like a question. `auto` approves the run's permission requests.
- `open`: `click` lets you click to open the session. `auto` opens it right away, for questions and permissions only. `never` sends a plain notification. Finished and failed runs always get a plain notification only, with no "Open session" dialog.
- `timeout`: interrupts a run after this long. Time spent waiting for you does not count.
- `settings.target`: where a session opens. `app` (default) brings the OpenCode desktop app forward and opens the session as a tab (done by this plugin's GUI, so the app must have it loaded). `terminal` attaches the TUI in a terminal instead.
- `settings.notifier`: unset (default) posts notifications from the desktop app and falls back to the system; `"osascript"` always uses the macOS banner plus dialog; `"none"` turns them off.
- `settings.terminal`: `auto` (Ghostty › iTerm › WezTerm › kitty › Alacritty › Terminal), a name, or a template like `"wezterm start -- sh -lc {cmd}"`.

## Files

| Path | What |
|---|---|
| `~/.config/opencode/scheduler/jobs.json` | jobs + settings |
| `~/.local/state/opencode-scheduler/state.json` | next/last run, active runs, history |
| `~/.local/state/opencode-scheduler/scheduler.log` | log |
| `~/.local/state/opencode-scheduler/lock.json` | which process runs the scheduler |

`OPENCODE_SCHEDULER_HOME=/some/dir` puts all of these in one folder (used by the tests).
