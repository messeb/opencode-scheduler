// Domain: global scheduler settings and their rules.

export const DEFAULT_SETTINGS = {
  // "auto" | "Terminal" | "iTerm" | "Ghostty" | "WezTerm" | "kitty" | "Alacritty" | custom template with {cmd}
  terminal: "auto",
  // When the agent asks something: "click" = notification you click to attach, "auto" = open terminal at once, "never"
  open: "click",
  // Where a session opens: "app" = the OpenCode desktop app, "terminal" = the TUI in a terminal
  target: "app",
  // Server the attach command connects to; empty = opencode's background service
  attachServer: "",
  // Fire a missed run once after downtime
  catchUp: true,
  tickSeconds: 20,
}

const RULES = {
  terminal: (v) => typeof v === "string" && v.trim() !== "",
  open: (v) => ["click", "auto", "never"].includes(v),
  target: (v) => ["app", "terminal"].includes(v),
  attachServer: (v) => typeof v === "string",
  catchUp: (v) => typeof v === "boolean",
  notifier: (v) => ["", "none", "osascript"].includes(v),
}

export function withDefaults(stored) {
  return { ...DEFAULT_SETTINGS, ...stored }
}

/** Merge a validated patch into the stored settings. Throws on unknown keys or invalid values. */
export function applySettings(stored, patch) {
  const settings = { ...stored }
  for (const [key, value] of Object.entries(patch ?? {})) {
    const valid = RULES[key]
    if (!valid) throw new Error(`unknown setting "${key}"`)
    if (!valid(value)) throw new Error(`invalid value for ${key}: ${JSON.stringify(value)}`)
    if (value === "" && key === "notifier") delete settings[key]
    else settings[key] = typeof value === "string" ? value.trim() : value
  }
  return settings
}

export function tickMs(settings) {
  return Math.max(5, Number(settings.tickSeconds) || 20) * 1000
}
