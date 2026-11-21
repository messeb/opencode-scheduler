import assert from "node:assert/strict"
import { test } from "node:test"
import { createNotifier } from "../src/infrastructure/system/notifier.js"
import { attachCommand, detectTerminal, shellQuote, terminalArgv } from "../src/infrastructure/system/terminal.js"

test("attach command targets the session in its directory", () => {
  assert.equal(
    attachCommand({ sessionID: "ses_1", directory: "/Users/me/my repo", bin: "/bin/opencode" }),
    "cd '/Users/me/my repo' && /bin/opencode --session ses_1",
  )
  assert.equal(
    attachCommand({ sessionID: "ses_1", server: "http://127.0.0.1:4096", bin: "opencode" }),
    "opencode --server http://127.0.0.1:4096 --session ses_1",
  )
  assert.equal(shellQuote("it's"), `'it'\\''s'`)
})

test("terminal launchers", () => {
  const cmd = "cd /x && opencode --session ses_1"
  const terminal = terminalArgv(cmd, { terminal: "Terminal", platform: "darwin" })
  assert.equal(terminal[0], "osascript")
  assert.match(terminal[2], /do script "cd \/x && opencode --session ses_1"/)
  assert.deepEqual(terminalArgv(cmd, { terminal: "Ghostty", platform: "darwin", shell: "/bin/zsh" }), ["open", "-na", "Ghostty", "--args", "-e", "/bin/zsh", "-lc", cmd])
  assert.match(terminalArgv(cmd, { terminal: "iTerm", platform: "darwin" })[2], /write text "cd \/x/)
  assert.deepEqual(terminalArgv(cmd, { terminal: "wezterm start -- sh -lc {cmd}" }), ["/bin/sh", "-c", `wezterm start -- sh -lc 'cd /x && opencode --session ses_1'`])
  assert.equal(detectTerminal("darwin", (p) => p === "/Applications/iTerm.app"), "iTerm")
  assert.equal(detectTerminal("darwin", () => false), "Terminal")
})

test("notifier: osascript fallback shows banner + dialog, opens terminal on yes", async () => {
  const runs = []
  const opened = []
  const notifier = createNotifier({
    platform: "darwin",
    exists: () => false, // no terminal-notifier
    getSettings: () => ({ terminal: "Terminal" }),
    run: (bin, args) => runs.push([bin, args]),
    ask: async () => true,
    terminal: (command, options) => opened.push([command, options.terminal]),
  })
  notifier.notify({ title: "opencode · job", subtitle: "Needs your answer", message: 'say "hi"', sessionID: "ses_9", directory: "/repo", open: "click" })
  assert.equal(runs[0][0], "osascript")
  assert.match(runs[0][1][1], /display notification "say \\"hi\\""/)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(opened.length, 1)
  assert.match(opened[0][0], /cd \/repo && .*--session ses_9/)
})

test("notifier: dialogs are dismissed when the question is handled elsewhere", async () => {
  let cancelled = 0
  const opened = []
  const notifier = createNotifier({
    platform: "darwin",
    exists: () => false,
    run: () => {},
    ask: () => ({ promise: new Promise(() => {}), cancel: () => cancelled++ }),
    terminal: (command) => opened.push(command),
  })
  notifier.notify({ title: "t", subtitle: "s", message: "m", sessionID: "ses_1", directory: "/repo", open: "click" })
  notifier.notify({ title: "t", subtitle: "s", message: "m2", sessionID: "ses_1", directory: "/repo", open: "click" })
  assert.equal(cancelled, 1, "a newer question replaces the older dialog")
  notifier.dismiss("ses_1")
  assert.equal(cancelled, 2)
  notifier.dismiss("ses_1")
  assert.equal(cancelled, 2, "dismiss is idempotent")
  assert.equal(opened.length, 0)
})

test("notifier: terminal-notifier gets a click action; auto opens immediately once", () => {
  const runs = []
  const opened = []
  const notifier = createNotifier({
    platform: "darwin",
    exists: (p) => p.endsWith("/terminal-notifier"),
    getSettings: () => ({ terminal: "Terminal" }),
    run: (bin, args) => runs.push([bin, args]),
    terminal: (command) => opened.push(command),
  })
  notifier.notify({ title: "t", subtitle: "s", message: "m", sessionID: "ses_1", directory: "/repo", open: "click" })
  const args = runs[0][1]
  assert.equal(runs[0][0], "terminal-notifier")
  assert.match(args[args.indexOf("-execute") + 1], /osascript/)
  notifier.notify({ title: "t", subtitle: "s", message: "m", sessionID: "ses_2", directory: "/repo", open: "auto" })
  notifier.notify({ title: "t", subtitle: "s", message: "m", sessionID: "ses_2", directory: "/repo", open: "auto" })
  assert.equal(opened.length, 1, "deduped within 30s")
})

test("notifier: by default a click opens the session in the desktop app; target terminal keeps the TUI", async () => {
  const inApp = []
  const opened = []
  let settings = {}
  const notifier = createNotifier({
    platform: "darwin",
    exists: () => false,
    getSettings: () => settings,
    run: () => {},
    ask: async () => true,
    terminal: (command) => opened.push(command),
    openApp: (n) => inApp.push(n.sessionID),
    appClickCommand: () => "focus",
  })
  notifier.notify({ title: "t", subtitle: "s", message: "m", sessionID: "ses_1", directory: "/repo", open: "click" })
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(inApp, ["ses_1"])
  assert.equal(opened.length, 0)
  settings = { target: "terminal" }
  notifier.notify({ title: "t", subtitle: "s", message: "m", sessionID: "ses_2", directory: "/repo", open: "click" })
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(opened.length, 1)
})

test("notifier: target app posts from the desktop app; osascript only when no app window takes it", async () => {
  const runs = []
  const posted = []
  let shown = true
  const notifier = createNotifier({
    platform: "darwin",
    exists: () => false,
    run: (bin, args) => runs.push([bin, ...args]),
    ask: () => ({ promise: new Promise(() => {}) }),
    openApp: () => {},
    appNotify: async (n) => (posted.push(n.sessionID), shown),
  })
  const tick = () => new Promise((r) => setTimeout(r, 0))
  notifier.notify({ title: "t", subtitle: "s", message: "m", sessionID: "ses_1", open: "click" })
  await tick()
  assert.deepEqual(posted, ["ses_1"])
  assert.equal(runs.length, 0, "no osascript banner (its click opens Script Editor)")
  shown = false
  notifier.notify({ title: "t", subtitle: "s", message: "m", sessionID: "ses_2", open: "click" })
  await tick()
  assert.equal(runs[0][0], "osascript", "falls back to the system banner")
})

test("desktop app: focus command calls the plugin RPC, then focuses the app", async () => {
  const { activateApp, focusCommand } = await import("../src/infrastructure/system/desktop-app.js")
  const cmd = focusCommand({ sessionID: "ses_1", rpcID: "opencode-scheduler", bin: "/bin/opencode" })
  assert.match(cmd, /^\/bin\/opencode api rpc\.call --param rpcID=opencode-scheduler --param method=focusSession -d '\{"input":\{"sessionID":"ses_1"\}\}' .*; open -b ai\.opencode\.desktop$/)
  const runs = []
  assert.equal(activateApp({ platform: "darwin", run: (bin, args) => runs.push([bin, ...args]) }), true)
  assert.deepEqual(runs, [["open", "-b", "ai.opencode.desktop"]])
  assert.equal(activateApp({ platform: "linux" }), false)
})
