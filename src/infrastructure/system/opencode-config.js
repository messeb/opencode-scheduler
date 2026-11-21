// Infrastructure: opencode's config file (JSONC).
import fs from "node:fs"

/** Strip // and /* *\/ comments and trailing commas from JSONC, leaving string contents alone. */
export function parseJsonc(text) {
  let out = ""
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (inString) {
      out += c
      if (c === "\\") out += text[++i] ?? ""
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
    } else if (c === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1") || "{}")
}

const entryPath = (entry) => (Array.isArray(entry) ? entry[0] : typeof entry === "object" && entry ? entry.package ?? entry.path : entry)

/** Add (or remove) a plugin entry in an opencode config file. Returns true when the file changed. */
export function setPluginEntry(file, spec, enabled) {
  const exists = fs.existsSync(file)
  const text = exists ? fs.readFileSync(file, "utf8") : ""
  const config = text.trim() ? parseJsonc(text) : { $schema: "https://opencode.ai/config.json" }
  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  const has = plugins.some((entry) => entryPath(entry) === spec)
  if (enabled === has) return false
  config.plugin = enabled ? [...plugins, spec] : plugins.filter((entry) => entryPath(entry) !== spec)
  if (config.plugin.length === 0) delete config.plugin
  if (exists && /\/\/|\/\*/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) fs.copyFileSync(file, `${file}.bak`)
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n")
  return true
}
