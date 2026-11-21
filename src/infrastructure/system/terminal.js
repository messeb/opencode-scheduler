// Infrastructure: opening a terminal attached to a session.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

export function shellQuote(value) {
  const s = String(value)
  if (/^[a-zA-Z0-9_./:=@%+-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function shellJoin(argv) {
  return argv.map(shellQuote).join(" ")
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** Path to the opencode binary. Inside the opencode server process this is the running binary. */
export function opencodeBinary(execPath = process.execPath) {
  return path.basename(execPath).startsWith("opencode") ? execPath : "opencode"
}

/** Shell command that opens the opencode TUI on the given session. */
export function attachCommand({ sessionID, directory, server, bin = opencodeBinary() }) {
  const argv = [bin]
  if (server) argv.push("--server", server)
  argv.push("--session", sessionID)
  const run = shellJoin(argv)
  return directory ? `cd ${shellQuote(directory)} && ${run}` : run
}

const MAC_APPS = [
  ["Ghostty", "Ghostty.app"],
  ["iTerm", "iTerm.app"],
  ["WezTerm", "WezTerm.app"],
  ["kitty", "kitty.app"],
  ["Alacritty", "Alacritty.app"],
]

export function detectTerminal(platform = process.platform, exists = fs.existsSync) {
  if (platform === "darwin") {
    const dirs = ["/Applications", path.join(os.homedir(), "Applications")]
    for (const [name, app] of MAC_APPS) {
      if (dirs.some((d) => exists(path.join(d, app)))) return name
    }
    return "Terminal"
  }
  for (const name of ["x-terminal-emulator", "gnome-terminal", "konsole", "kitty", "wezterm", "alacritty", "xterm"]) {
    if (onPath(name, exists)) return name
  }
  return "xterm"
}

export function onPath(name, exists = fs.existsSync) {
  return (process.env.PATH ?? "").split(path.delimiter).some((dir) => dir && exists(path.join(dir, name)))
}

/**
 * argv that opens a new terminal window running `command` (a shell command string).
 * `terminal` is a known name or a custom template containing {cmd} (shell-quoted command).
 */
export function terminalArgv(command, { terminal = "auto", platform = process.platform, shell = process.env.SHELL || "/bin/zsh", exists } = {}) {
  const name = terminal === "auto" ? detectTerminal(platform, exists) : terminal
  if (name.includes("{cmd}")) return ["/bin/sh", "-c", name.replaceAll("{cmd}", shellQuote(command))]
  const inShell = [shell, "-lc", command]
  switch (name.toLowerCase()) {
    case "terminal":
      return [
        "osascript",
        "-e",
        `tell application "Terminal" to do script ${appleScriptString(command)}`,
        "-e",
        `tell application "Terminal" to activate`,
      ]
    case "iterm":
    case "iterm2":
      return [
        "osascript",
        "-e",
        `tell application "iTerm"
  activate
  set newWindow to (create window with default profile)
  tell current session of newWindow to write text ${appleScriptString(command)}
end tell`,
      ]
    case "ghostty":
      return platform === "darwin" ? ["open", "-na", "Ghostty", "--args", "-e", ...inShell] : ["ghostty", "-e", ...inShell]
    case "wezterm":
      return platform === "darwin" ? ["open", "-na", "WezTerm", "--args", "start", "--", ...inShell] : ["wezterm", "start", "--", ...inShell]
    case "kitty":
      return platform === "darwin" ? ["open", "-na", "kitty", "--args", ...inShell] : ["kitty", ...inShell]
    case "alacritty":
      return platform === "darwin" ? ["open", "-na", "Alacritty", "--args", "-e", ...inShell] : ["alacritty", "-e", ...inShell]
    case "gnome-terminal":
      return ["gnome-terminal", "--", ...inShell]
    default:
      return [name, "-e", ...inShell]
  }
}

export function openTerminal(command, options = {}) {
  const [bin, ...args] = terminalArgv(command, options)
  const child = spawn(bin, args, { detached: true, stdio: "ignore" })
  child.on("error", () => {})
  child.unref()
  return [bin, ...args]
}
