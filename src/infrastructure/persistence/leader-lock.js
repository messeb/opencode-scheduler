// Infrastructure: single-leader lock file.
import fs from "node:fs"
import path from "node:path"

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

/**
 * Single-leader lock across processes (several opencode servers may load the plugin).
 * Returns true when this process holds the lock.
 */
export function acquireLock(file, pid = process.pid, isAlive = alive) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, "wx")
      fs.writeSync(fd, JSON.stringify({ pid, since: new Date().toISOString() }))
      fs.closeSync(fd)
      return true
    } catch (error) {
      if (error.code !== "EEXIST") throw error
    }
    let holder
    try {
      holder = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      holder = undefined
    }
    if (holder?.pid === pid) return true
    if (holder?.pid && isAlive(holder.pid)) return false
    try {
      fs.unlinkSync(file)
    } catch {}
  }
  return false
}

export function releaseLock(file, pid = process.pid) {
  try {
    const holder = JSON.parse(fs.readFileSync(file, "utf8"))
    if (holder.pid === pid) fs.unlinkSync(file)
  } catch {}
}

export function lockHolder(file) {
  try {
    const holder = JSON.parse(fs.readFileSync(file, "utf8"))
    return alive(holder.pid) ? holder : undefined
  } catch {
    return undefined
  }
}
