# Changelog

## 0.1.0 — unreleased

First release.

- Runs skills, prompts and slash commands on cron, interval, one-shot and continuous schedules, several rules per job (`0 9 * * 1-3; 0 13 * * 1-5`).
- Runs are autonomous. Questions and permission requests send a desktop notification; a click opens the session in the OpenCode desktop app (or a terminal with `"target": "terminal"`).
- Notifications are posted from the OpenCode app while it runs, so a click lands there; the system banner is the fallback.
- Desktop **Schedules** tab: jobs, active runs, finished runs, editor with weekday/time rules, `@skill:` / `@agent:` insertion, global settings, titlebar pill.
- Agent tools `scheduler_add` / `_list` / `_remove` / `_enable` / `_run` and the `opencode-scheduler` CLI.
- CI on `main` and pull requests; release candidates from `release/x.y.z` branches, releases from `x.y.z` tags.
- One scheduler across processes (leader lock), catch-up after downtime, timeouts that exclude time spent waiting for you, run history.
