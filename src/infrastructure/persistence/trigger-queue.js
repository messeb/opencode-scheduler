// Infrastructure: "run now" requests from other processes (CLI, a non-leader server), one file per job.
import fs from "node:fs"
import path from "node:path"

export function createTriggerQueue(dir) {
  return {
    request(id) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, id), new Date().toISOString())
    },
    /** Take all pending requests. */
    consume() {
      let names = []
      try {
        names = fs.readdirSync(dir)
      } catch {
        return new Set()
      }
      const ids = new Set()
      for (const name of names) {
        try {
          fs.unlinkSync(path.join(dir, name))
          ids.add(name)
        } catch {}
      }
      return ids
    },
  }
}
