// Infrastructure: bringing the OpenCode desktop app to the front.
import { spawn } from "node:child_process"
import { opencodeBinary, shellQuote } from "./terminal.js"

export const APP_BUNDLE_ID = "ai.opencode.desktop"

function fire(bin, args) {
  const child = spawn(bin, args, { detached: true, stdio: "ignore" })
  child.on("error", () => {})
  child.unref()
}

/** Launch or focus the desktop app. Returns false where that isn't supported. */
export function activateApp({ platform = process.platform, run = fire } = {}) {
  if (platform !== "darwin") return false
  run("open", ["-b", APP_BUNDLE_ID])
  return true
}

/**
 * Shell command for a notification click (terminal-notifier runs it outside this process):
 * asks the plugin to open the session in the app, then focuses the app.
 */
export function focusCommand({ sessionID, rpcID, bin = opencodeBinary() }) {
  const input = JSON.stringify({ input: { sessionID } })
  const call = [bin, "api", "rpc.call", "--param", `rpcID=${rpcID}`, "--param", "method=focusSession", "-d", input].map(shellQuote).join(" ")
  return `${call} >/dev/null 2>&1; open -b ${APP_BUNDLE_ID}`
}
