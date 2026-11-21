// Infrastructure: append-only log file.
import fs from "node:fs"
import path from "node:path"

export function createLogger(file) {
  return (...parts) => {
    const line = `${new Date().toISOString()} ${parts.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, line)
    } catch {}
  }
}
