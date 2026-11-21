# Install

[README](../README.md) · [Install](INSTALL.md) · [Usage](USAGE.md) · [Configuration](CONFIGURATION.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)

Requires opencode **2.x** (tested with 2.3.2): its v2 plugin API, background service and desktop GUI plugin API.


## From npm

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

## From a checkout

Shortcut for the steps below: `npm run setup && opencode service restart`.

```sh
git clone <this repo> opencode-scheduler && cd opencode-scheduler
npm install
npm run build:gui                        # builds dist/gui-experimental.cjs (the desktop tab)
npm link                                 # puts `opencode-scheduler` on your PATH
opencode-scheduler install               # adds this folder to "plugin"
opencode service restart
```

Then restart the **desktop app** once, so it picks up the GUI bundle.

## Notifications

 While the desktop app runs, notifications are posted from the app, so a click opens the session there (allow notifications for OpenCode in System Settings › Notifications). Without the app, macOS falls back to `terminal-notifier` if installed (`brew install terminal-notifier`, clickable) or to a banner plus an "Open session" dialog. Don't click that plain banner: macOS attributes it to Script Editor and opens that. With `"target": "terminal"`, the first time a terminal is opened macOS asks you to let `osascript` control Terminal/iTerm, and Ghostty may ask you to allow the command. Approve these once. Linux uses `notify-send --action`.

## Uninstall

To remove it: `opencode-scheduler uninstall` (your jobs file is kept).

## Limitations

- The desktop GUI API is **experimental** in opencode (`./gui-experimental`), so it may change between releases. The plugin targets 2.3.2.
- Opening a session in the app needs the desktop app with this plugin's GUI loaded. A click that launches the app opens the session if the app starts within a minute. Outside macOS the click can't bring the app forward; use `"target": "terminal"` there.
- Scheduling needs the opencode background service. `--launchd` (or a systemd timer running `opencode-scheduler wake`) restarts it after reboots.
- `permissions: "auto"` approves whatever the run asks for. Use it only for directories and skills you trust.
