# opencode-scheduler

npm package: `@messeb/opencode-scheduler` · plugin id and CLI: `opencode-scheduler` · MIT

An opencode plugin that runs skills on a schedule. Runs are autonomous. When the agent needs a decision, it asks with the question tool. You then get a desktop notification, and one click opens that exact session in the OpenCode desktop app (or, if you prefer, in a terminal), where you answer. The run then carries on.

The desktop app gets a **Schedules** tab that lists jobs, active runs and finished runs.

Requires opencode **2.x** (tested with 2.3.2). It uses the v2 plugin API, its background service and its desktop GUI plugin API.

## Prior art

Nothing combines all five pieces: schedule, autonomy, ask a human, notify, and attach.

| Project | Schedule | Autonomous | Asks you | Notifies | Attach | Gap |
|---|---|---|---|---|---|---|
| [opencode-scheduler](https://github.com/different-ai/opencode-scheduler) (different project, owns the unscoped npm name) | ✓ (launchd/systemd + `opencode run`) | ✓ | ✗ denies `question` on purpose | ✗ | partial | no human in the loop |
| [OpenCode Manager](https://chriswritescode-dev.github.io/opencode-manager/features/schedules/) | ✓ cron | ✓ | opt-in | push (unclear for questions) | ✓ web | separate web app, not a plugin |
| [opencode-notifier](https://github.com/mohak34/opencode-notifier), [opencode-shepherd](https://github.com/okazakee/opencode-shepherd) | ✗ | – | answers remotely (shepherd) | ✓ | partial | no scheduling |
| Claude Code Routines / Codex Automations | ✓ | ✓ | ✗ | inbox | web/app | other agents, cloud/app only |
| claude-squad, agent-deck, vibe-kanban | ✗ | partial | in pane | partial | ✓ | no scheduling |

One finding shapes the design: `opencode run` **cancels questions** in non-interactive mode, so a cron job built on `opencode run` cannot ask you anything. This plugin runs inside the opencode server instead. It creates the sessions itself, so questions stay open until you answer.

## How it works

```
 opencode background service (opencode serve --service)   ← the desktop app and the TUI connect here too
 └─ plugin (one scheduler per process; a lock file keeps it to one across processes)
    ├─ tick every 20s: read ~/.config/opencode/scheduler/jobs.json and fire due jobs
    │    session.create({ location: job.directory })
    │    session.prompt({ text: autonomy preamble + job.prompt, skills: [{ id: job.skill }] })
    ├─ event stream
    │    form.created / permission.asked   → status "waiting" → notification → click → the session opens
    │                                          as a tab in the desktop app (or `opencode --session <id>` in a terminal)
    │    form.replied / permission.replied → status "running", stale dialog closed
    │    session.execution.succeeded/failed/interrupted → finished notification, run history
    ├─ agent tools: scheduler_add / _list / _remove / _enable / _run
    └─ RPC (SchedulerRpc) → desktop GUI: Schedules tab, titlebar pill, + menu item, palette command,
                            app notifications ("notify" event), opening sessions ("open" event)
```

In opencode v2, questions are **forms**: the question tool creates one and the session waits for its reply. Sub-agent sessions are mapped to their root run, so their questions reach you too.

## Install

### From npm

```sh
npm install -g @messeb/opencode-scheduler
opencode-scheduler install               # adds "@messeb/opencode-scheduler" to "plugin" in ~/.config/opencode/opencode.jsonc
opencode-scheduler install --launchd     # also: a LaunchAgent that keeps the service and plugin awake (every 5 min, at login)
opencode service restart                 # load it
```

Or add it to `opencode.jsonc` yourself and skip the CLI:

```jsonc
{ "plugin": ["@messeb/opencode-scheduler"] }
```

### From a checkout

```sh
git clone <this repo> opencode-scheduler && cd opencode-scheduler
npm install
npm run build:gui                        # builds dist/gui-experimental.cjs (the desktop tab)
npm link                                 # puts `opencode-scheduler` on your PATH
opencode-scheduler install               # adds this folder to "plugin"
opencode service restart
```

Then restart the **desktop app** once, so it picks up the GUI bundle.

**Notifications.** While the desktop app runs, notifications are posted from the app, so a click opens the session there (allow notifications for OpenCode in System Settings › Notifications). Without the app, macOS falls back to `terminal-notifier` if installed (`brew install terminal-notifier`, clickable) or to a banner plus an "Open session" dialog. Don't click that plain banner: macOS attributes it to Script Editor and opens that. With `"target": "terminal"`, the first time a terminal is opened macOS asks you to let `osascript` control Terminal/iTerm, and Ghostty may ask you to allow the command. Approve these once. Linux uses `notify-send --action`.

To remove it: `opencode-scheduler uninstall` (your jobs file is kept).

## Usage

### Ask the agent

> Schedule the `triage` skill every weekday at 9:00 in this repo, and focus on new bugs.

The agent calls `scheduler_add`. You can also ask it to list, pause, remove or run jobs.

### CLI

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

### Schedules

| Spec | Meaning |
|---|---|
| `0 9 * * 1-5`, `*/15 * * * *`, `0 0 1 jan *` | 5-field cron, local time (lists, ranges, steps, names) |
| `@hourly` `@daily` `@weekly` `@monthly` `@yearly` | cron macros |
| `every 30m`, `every 2h` | fixed interval (≥ 1m) |
| `at 2026-11-21 09:00` | one-shot |
| `continuous`, `continuous 5m` | back to back: start the next run once the previous one finishes, after a cooldown |
| `0 9 * * 1-3; 0 13 * * 1-5` | several schedules in one job, separated by `;` (not with `continuous`) |

A job never overlaps with itself: if the previous run is still active (including waiting for you), the slot is skipped. A run that was missed because the service was down fires once on the next start (`catchUp`).

### jobs.json

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

### Desktop app: the Schedules tab

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

## Files

| Path | What |
|---|---|
| `~/.config/opencode/scheduler/jobs.json` | jobs + settings |
| `~/.local/state/opencode-scheduler/state.json` | next/last run, active runs, history |
| `~/.local/state/opencode-scheduler/scheduler.log` | log |
| `~/.local/state/opencode-scheduler/lock.json` | which process runs the scheduler |

`OPENCODE_SCHEDULER_HOME=/some/dir` puts all of these in one folder (used by the tests).

## Development

```sh
npm test            # domain rules, event translation, scheduler, job repository, notifier, terminal launchers, config editing
npm run typecheck   # GUI types against @opencode/plugin 2.3.2
npm run build:gui   # vite + @opencode/plugin/gui/vite → dist/gui-experimental.cjs
npm run test:gui    # loads the built bundle in jsdom with a mock host: rendering, create/edit/rename/delete/duplicate, stop, settings, notifications
npm run check       # all of the above, as CI runs it
```

Releasing: bump `version`, move the CHANGELOG entry out of "unreleased", then `npm publish` (`prepack` builds the GUI bundle).

### Architecture

The code follows domain-driven design. Dependencies point inwards: interfaces and infrastructure depend on the application layer, the application layer depends on the domain, and the domain depends on nothing.

| Layer | Path | What |
|---|---|---|
| Domain | `src/domain/schedule/` | cron and schedule specs (value objects), next-run computation, preview |
| | `src/domain/job/` | `Job` (validation, prompt with `@skill:`/`@agent:` refs, notification policy), the job list aggregate (unique ids, rename, order) |
| | `src/domain/run/` | `Run` (running ⇄ waiting → finished, timeout without waiting time), the per-job record and the "is it due" rule |
| | `src/domain/settings.js` | global settings and their rules |
| Application | `src/application/scheduler.js` | the scheduling engine: tick, fire, follow runs, notify. Uses injected ports (store, sessions, notifier) |
| | `src/application/job-service.js` | use cases shared by tools, GUI and CLI: save/rename, enable, delete, run now or queue, settings, overview read model |
| Infrastructure | `src/infrastructure/persistence/` | file repositories for jobs, state, run triggers and the leader lock (`fileStore()`) |
| | `src/infrastructure/system/` | notifications, terminals, skill/agent catalog, folder picker, opencode config, log |
| Interfaces | `src/interfaces/opencode/` | the server plugin (composition root), the session adapter, the event translation from opencode events to run events, agent tools, RPC handlers |
| | `src/interfaces/rpc/contract.js`, `src/interfaces/gui/` | the GUI's RPC contract and the desktop bundle source |
| | `bin/cli.js` | the CLI |

Package layout follows opencode's plugin resolution: `exports["."]`/`"./server"` is the server plugin (`src/index.js`), `"./rpc"` the RPC contract, and `"./gui-experimental"` the desktop bundle. opencode hot-reloads the plugin when its files change. Active runs survive a reload; runs from a process that died are marked `lost`.

## Limitations

- The desktop GUI API is **experimental** in opencode (`./gui-experimental`), so it may change between releases. The plugin targets 2.3.2.
- Opening a session in the app needs the desktop app with this plugin's GUI loaded. A click that launches the app opens the session if the app starts within a minute. Outside macOS the click can't bring the app forward; use `"target": "terminal"` there.
- Scheduling needs the opencode background service. `--launchd` (or a systemd timer running `opencode-scheduler wake`) restarts it after reboots.
- `permissions: "auto"` approves whatever the run asks for. Use it only for directories and skills you trust.
