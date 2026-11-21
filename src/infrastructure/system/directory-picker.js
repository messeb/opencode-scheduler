// Infrastructure: the native folder chooser on the machine running opencode.
import { execFile } from "node:child_process"
import fs from "node:fs"

/** Native folder chooser on the machine running opencode. Resolves to a path, or "" when cancelled. */
export function pickDirectory({ start, platform = process.platform, run = execFileText } = {}) {
  if (platform === "darwin") {
    const from = start && fs.existsSync(start) ? ` default location (POSIX file ${JSON.stringify(start)})` : ""
    const script = `try\nPOSIX path of (choose folder with prompt "Project directory for the schedule"${from})\non error number -128\nreturn ""\nend try`
    return run("osascript", ["-e", 'tell application "System Events" to activate', "-e", script]).then((out) => out.trim().replace(/(.)\/$/, "$1"))
  }
  if (platform === "linux") {
    return run("zenity", ["--file-selection", "--directory", "--title=Project directory", ...(start ? [`--filename=${start}/`] : [])]).then((out) => out.trim(), () => "")
  }
  return Promise.reject(new Error(`no folder picker on ${platform}; type the path instead`))
}

function execFileText(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 10 * 60_000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))))
  })
}
