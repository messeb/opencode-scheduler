// Infrastructure: atomic JSON files.
import fs from "node:fs"
import path from "node:path"

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return fallback
    throw new Error(`cannot read ${file}: ${error.message}`)
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n")
  fs.renameSync(tmp, file)
}
