# opencode-scheduler

Run opencode skills on a schedule. Runs are autonomous, and when the agent needs you, one click on a notification takes you straight into the session to answer.

## Features

- **Flexible schedules:** cron, intervals, one-shot and back-to-back runs, several rules per job (`0 9 * * 1-3; 0 13 * * 1-5`).
- **Skills, instructions or commands:** run a skill, a prompt with `@skill:` / `@agent:` references, or a slash command, in any project.
- **You stay in the loop:** questions and permission requests wait for you instead of failing the run.
- **Notifications that open the session:** one click opens it as a tab in the OpenCode desktop app, or in a terminal.
- **Schedules tab in the desktop app:** create and edit jobs, watch active runs, answer, stop or run now.
- **Agent tools and a CLI:** ask the agent to schedule something, or use `opencode-scheduler`.
- **Reliable:** no overlapping runs, catch-up after downtime, timeouts that skip the time spent waiting for you.

## Quick start

```sh
npm install -g @messeb/opencode-scheduler
opencode-scheduler install       # registers the plugin in ~/.config/opencode/opencode.jsonc
opencode service restart
```

Restart the OpenCode desktop app once, then open **Schedules** from the + menu. Or ask the agent:

> Schedule the `triage` skill every weekday at 9:00 in this repo, and focus on new bugs.

Requires opencode 2.x (tested with 2.3.2).

## Documentation

- [Install](docs/INSTALL.md): npm or checkout, notifications, uninstall, limitations
- [Usage](docs/USAGE.md): agent tools, CLI, the desktop Schedules tab
- [Configuration](docs/CONFIGURATION.md): schedule syntax, `jobs.json`, settings, files
- [Architecture](docs/ARCHITECTURE.md): how a run works, code layers
- [Development](docs/DEVELOPMENT.md): checks and releasing
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
