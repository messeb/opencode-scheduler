# Usage

[README](../README.md) · [Install](INSTALL.md) · [Usage](USAGE.md) · [Configuration](CONFIGURATION.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)

## Ask the agent

> Schedule the `triage` skill every weekday at 9:00 in this repo, and focus on new bugs.

The agent calls `scheduler_add`. You can also ask it to list, pause, remove or run jobs.

## CLI

```sh
opencode-scheduler add triage --schedule "0 9 * * 1-5" --skill triage --prompt "Focus on new bugs"
opencode-scheduler add next-ticket --schedule "continuous 5m" --skill implement-next-ticket --session reuse --permissions auto --timeout 2h
opencode-scheduler add release-notes --schedule "@weekly" --command release-notes
opencode-scheduler status                # jobs, next/last run, active sessions
opencode-scheduler run triage            # start now
opencode-scheduler attach triage         # open the job's session in this terminal
opencode-scheduler open triage           # ...in a new terminal window
opencode-scheduler logs -f
opencode-scheduler next "*/15 9-17 * * mon-fri"
opencode-scheduler notify-test --open    # try notification + terminal launch
```

## Desktop app: the Schedules tab

- **+ menu → Schedules** in any session opens the side-panel tab. It is also available from the command palette ("Schedules: show overview").
- A **titlebar pill** shows `N waiting` or `N running`. Click it to open the overview, or a dialog when you are on the home screen.
- **New schedule** (also in the palette as "Schedules: new schedule") opens the editor:
  - name, project directory (type it or **Choose…** for the native folder picker), enabled switch
  - schedule: **Weekdays & times** lets you add several rules, each with weekday toggles and hour/minute dropdowns (e.g. Mon–Wed 09:00 plus Mon–Fri 13:00); the resulting cron (`0 9 * * 1-3; 0 13 * * 1-5`) and the next runs are shown. **Custom** takes any spec (`every 30m`, `continuous 5m`, raw cron)
  - instructions, with **Add skill** / **Add agent** menus that insert `@skill:name` / `@agent:name` at the cursor (skills and agents found for that directory)
  - **Advanced**: slash command, timeout, model, new/reuse session, permissions (ask/auto, with a warning), what happens on a question, which notifications to send
- **Edit** on a job opens the same editor. Renaming keeps the job's run count and history. **Delete** asks for a second click. The **⋯** menu offers Duplicate, Open last session and Delete.
- The **gear** opens global settings: where sessions open (app or terminal), terminal, what happens on a question, notification style (from the app, macOS banner + dialog, off), attach server, catch-up.
- **Active** lists running and waiting runs. **Answer / Open session** opens the session as an app tab, **Terminal** attaches a terminal, and **Stop** interrupts the run.
- **Schedules** shows each job's cron, next/last run and run count, with **Run now** and an enable switch.
- **Finished** lists recent runs with status and duration. Click one to open its session, or **Clear** the list.

Changes go to `jobs.json` and take effect at once. Errors (duplicate name, bad schedule, relative path) are shown in the dialog.

The tab talks to the server plugin over opencode's plugin RPC (`POST /api/rpc/opencode-scheduler/<method>`) and refreshes on a `changed` event. Desktop, TUI and scheduler share the same background service, so a session opened in the app shows the live run.
