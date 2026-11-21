// Infrastructure: desktop notifications.
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import { attachCommand, onPath, openTerminal, shellJoin, terminalArgv } from "./terminal.js"

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function fire(bin, args) {
  const child = spawn(bin, args, { detached: true, stdio: "ignore" })
  child.on("error", () => {})
  child.unref()
}

/**
 * Desktop notifications that lead into the session.
 *
 * notify({ title, subtitle, message, sessionID, directory, open })
 *   open = "click": clicking the notification (or the dialog button) opens the session
 *   open = "auto":  the session opens immediately
 *   open = "never": plain notification
 *
 * Where the session opens: settings.target "app" (default) uses `openApp` / `appClickCommand` when given
 * (the desktop app), "terminal" attaches the TUI in a terminal.
 *
 * With target "app", `appNotify(n)` (resolves true when the desktop app showed it) posts the notification from
 * the app itself, so a click lands in OpenCode. Banners posted by osascript belong to Script Editor and a click
 * opens that instead; they are only the fallback when no app window takes the notification.
 */
export function createNotifier({
  getSettings = () => ({}),
  log = () => {},
  platform = process.platform,
  exists = fs.existsSync,
  run = fire,
  ask = askDialog,
  terminal = openTerminal,
  openApp,
  appClickCommand,
  appNotify,
} = {}) {
  const recentlyOpened = new Map()
  const pendingDialogs = new Map() // sessionID -> cancel()

  const inApp = (settings) => settings.target !== "terminal" && Boolean(openApp)

  function openSession({ sessionID, directory }) {
    const last = recentlyOpened.get(sessionID) ?? 0
    if (Date.now() - last < 30_000) return
    recentlyOpened.set(sessionID, Date.now())
    const settings = getSettings()
    if (inApp(settings)) {
      openApp({ sessionID, directory })
      log("open in app", { sessionID })
      return
    }
    const command = attachCommand({ sessionID, directory, server: settings.attachServer || undefined })
    const argv = terminal(command, { terminal: settings.terminal ?? "auto", platform })
    log("open terminal", { sessionID, argv: argv?.[0] })
  }

  function notify(n) {
    const settings = getSettings()
    const open = n.open ?? "click"
    log("notify", { title: n.title, subtitle: n.subtitle, sessionID: n.sessionID, open })
    if (!settings.notifier && inApp(settings) && appNotify) {
      Promise.resolve(appNotify({ ...n, open }))
        .catch(() => false)
        .then((shown) => {
          if (shown) log("notified in app", { sessionID: n.sessionID })
          else systemNotify(n, settings, open)
        })
    } else if (settings.notifier !== "none") {
      systemNotify(n, settings, open)
    }
    if (open === "auto") openSession(n)
  }

  function systemNotify(n, settings, open) {
    if (platform === "darwin") {
      const useTerminalNotifier = settings.notifier !== "osascript" && onPath("terminal-notifier", exists)
      if (useTerminalNotifier) {
        const args = ["-title", n.title, "-subtitle", n.subtitle ?? "", "-message", n.message || " ", "-group", n.sessionID, "-sound", "default"]
        if (open === "click" && inApp(settings) && appClickCommand) {
          args.push("-execute", appClickCommand(n))
        } else if (open === "click") {
          const command = attachCommand({ sessionID: n.sessionID, directory: n.directory, server: settings.attachServer || undefined })
          args.push("-execute", shellJoin(terminalArgv(command, { terminal: settings.terminal ?? "auto", platform })))
        }
        run("terminal-notifier", args)
      } else {
        run("osascript", [
          "-e",
          `display notification ${appleScriptString(n.message || " ")} with title ${appleScriptString(n.title)} subtitle ${appleScriptString(n.subtitle ?? "")} sound name "Glass"`,
        ])
        if (open === "click") {
          pendingDialogs.get(n.sessionID)?.()
          const dialog = ask(n)
          const promise = dialog?.promise ?? dialog
          if (dialog?.cancel) pendingDialogs.set(n.sessionID, dialog.cancel)
          promise
            .then((yes) => {
              if (pendingDialogs.get(n.sessionID) === dialog?.cancel) pendingDialogs.delete(n.sessionID)
              if (yes) openSession(n)
            })
            .catch((error) => log("dialog error", String(error)))
        }
      }
    } else if (platform === "linux") {
      if (open === "click" && onPath("notify-send", exists)) {
        execFile(
          "notify-send",
          ["--app-name=opencode", "--action=open=Open session", "--wait", n.title, `${n.subtitle ?? ""}\n${n.message ?? ""}`],
          { timeout: 30 * 60_000 },
          (_error, stdout) => {
            if (String(stdout).trim() === "open") openSession(n)
          },
        )
      } else {
        run("notify-send", ["--app-name=opencode", n.title, `${n.subtitle ?? ""}\n${n.message ?? ""}`])
      }
    }
  }

  /** Close an "Open session" dialog that is no longer relevant (question answered elsewhere, run finished). */
  function dismiss(sessionID) {
    const cancel = pendingDialogs.get(sessionID)
    if (!cancel) return
    pendingDialogs.delete(sessionID)
    cancel()
  }

  return { notify, openSession, dismiss }
}

/** macOS fallback when terminal-notifier is not installed: a dialog with an "Open session" button. */
function askDialog(n) {
  const text = [n.subtitle, n.message].filter(Boolean).join("\n\n")
  const script = `display dialog ${appleScriptString(text)} with title ${appleScriptString(n.title)} buttons {"Later", "Open session"} default button "Open session" giving up after 1800`
  let child
  const promise = new Promise((resolve) => {
    child = execFile("osascript", ["-e", script], { timeout: 31 * 60_000 }, (error, stdout) => {
      resolve(!error && String(stdout).includes("button returned:Open session"))
    })
  })
  return { promise, cancel: () => child?.kill() }
}
