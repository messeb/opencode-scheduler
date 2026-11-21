# Architecture

[README](../README.md) · [Install](INSTALL.md) · [Usage](USAGE.md) · [Configuration](CONFIGURATION.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)

## Runtime

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

## Layers

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
