// Infrastructure: skills and agents opencode can use in a directory, read from their folders and config.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseJsonc } from "./opencode-config.js"

/** Skills opencode can load for a directory: project skill folders up to the git root, then global ones. */
export function findSkills(directory, home = os.homedir()) {
  const roots = []
  if (directory && path.isAbsolute(directory)) {
    let dir = directory
    while (true) {
      roots.push(path.join(dir, ".opencode", "skills"), path.join(dir, ".opencode", "skill"), path.join(dir, ".claude", "skills"), path.join(dir, ".agents", "skills"))
      if (fs.existsSync(path.join(dir, ".git")) || path.dirname(dir) === dir || dir === home) break
      dir = path.dirname(dir)
    }
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
  roots.push(path.join(config, "opencode", "skills"), path.join(config, "opencode", "skill"), path.join(home, ".claude", "skills"), path.join(home, ".agents", "skills"))

  const found = new Map()
  for (const root of roots) {
    let entries = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (found.has(entry.name)) continue
      const file = path.join(root, entry.name, "SKILL.md")
      if (!fs.existsSync(file)) continue
      found.set(entry.name, { id: entry.name, description: skillDescription(file), path: file })
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function skillDescription(file) {
  try {
    const head = fs.readFileSync(file, "utf8").slice(0, 4000)
    const front = head.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!front) return ""
    const lines = front[1].split(/\r?\n/)
    const index = lines.findIndex((line) => /^description:/.test(line))
    if (index === -1) return ""
    let value = lines[index].replace(/^description:\s*/, "").trim()
    if (/^[|>][-+]?$/.test(value) || value === "") {
      // YAML block scalar: the indented lines that follow
      const block = []
      for (const line of lines.slice(index + 1)) {
        if (line.trim() && !/^\s/.test(line)) break
        block.push(line.trim())
      }
      value = block.join(" ").trim()
    }
    return value.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").slice(0, 160)
  } catch {
    return ""
  }
}

const BUILTIN_AGENTS = [
  { id: "build", description: "Default agent with all tools", mode: "primary" },
  { id: "plan", description: "Plans without changing files", mode: "primary" },
  { id: "general", description: "General-purpose subagent", mode: "subagent" },
  { id: "explore", description: "Fast read-only codebase search", mode: "subagent" },
]

/** Agents for a directory: built-ins, markdown agents (project, then global) and agents from opencode.json(c). */
export function findAgents(directory, home = os.homedir()) {
  const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
  const dirs = []
  if (directory && path.isAbsolute(directory)) dirs.push(path.join(directory, ".opencode"))
  dirs.push(path.join(config, "opencode"))
  const found = new Map(BUILTIN_AGENTS.map((agent) => [agent.id, agent]))
  for (const dir of dirs) {
    for (const sub of ["agent", "agents"]) {
      let entries = []
      try {
        entries = fs.readdirSync(path.join(dir, sub))
      } catch {
        continue
      }
      for (const name of entries) {
        if (!name.endsWith(".md")) continue
        const id = name.slice(0, -3)
        const head = readHead(path.join(dir, sub, name))
        found.set(id, { id, description: frontMatterValue(head, "description"), mode: frontMatterValue(head, "mode") || "all" })
      }
    }
    for (const file of ["opencode.jsonc", "opencode.json"]) {
      try {
        const agents = parseJsonc(fs.readFileSync(path.join(dir, file), "utf8")).agent ?? {}
        for (const [id, value] of Object.entries(agents)) {
          if (value?.disable) found.delete(id)
          else found.set(id, { id, description: value?.description ?? found.get(id)?.description ?? "", mode: value?.mode ?? found.get(id)?.mode ?? "all" })
        }
      } catch {}
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function readHead(file) {
  try {
    return fs.readFileSync(file, "utf8").slice(0, 4000)
  } catch {
    return ""
  }
}

function frontMatterValue(head, key) {
  const front = head.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const line = front?.[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`))
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : ""
}
