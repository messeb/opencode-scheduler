// Domain: when a job runs. Schedule specs are value objects; parsing validates, nextRun computes.
import { nextCron, parseCron } from "./cron.js"

const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** "90s", "30m", "2h", "1d", "1h30m" -> milliseconds */
export function parseDuration(input) {
  const text = String(input).trim().toLowerCase()
  if (!/^(\d+\s*[smhd]\s*)+$/.test(text)) throw new Error(`invalid duration "${input}" (use e.g. 30s, 15m, 2h, 1d)`)
  let ms = 0
  for (const [, n, unit] of text.matchAll(/(\d+)\s*([smhd])/g)) ms += Number(n) * UNITS[unit]
  if (ms <= 0) throw new Error(`duration must be positive: "${input}"`)
  return ms
}

/**
 * Schedule specs:
 *   "*\/15 * * * *", "@daily"     cron (local time)
 *   "every 30m"                   fixed interval
 *   "at 2026-11-21 09:00"         one-shot
 *   "continuous" / "continuous 5m" start the next run as soon as the previous one finishes (+ cooldown)
 *   "0 9 * * 1-3; 0 13 * * 1-5"  several of the above, separated by ";" or newlines
 */
export function parseSchedule(spec) {
  const text = String(spec ?? "").trim()
  if (!text) throw new Error("schedule is empty")
  // Several schedules, e.g. "0 9 * * 1-3; 0 13 * * 1-5": the job runs at whichever comes first.
  const parts = text.split(/\s*[;\n]\s*/).filter(Boolean)
  if (parts.length > 1) {
    const schedules = parts.map((part) => parseSchedule(part))
    if (schedules.some((s) => s.kind === "continuous")) throw new Error("continuous can't be combined with other schedules")
    return { kind: "multi", schedules, source: text }
  }

  const lower = text.toLowerCase()

  const every = lower.match(/^every\s+(.+)$/)
  if (every) {
    const ms = parseDuration(every[1])
    if (ms < 60_000) throw new Error("interval must be at least 1m")
    return { kind: "every", ms, source: text }
  }

  const at = text.match(/^at\s+(.+)$/i)
  if (at) {
    const time = new Date(at[1].trim().replace(" ", "T"))
    if (Number.isNaN(time.getTime())) throw new Error(`invalid date in "${text}"`)
    return { kind: "at", time, source: text }
  }

  const continuous = lower.match(/^@?continuous(?:\s+(.+))?$/)
  if (continuous) {
    return { kind: "continuous", cooldown: continuous[1] ? parseDuration(continuous[1]) : 60_000, source: text }
  }

  return { kind: "cron", cron: parseCron(text), source: text }
}

/** Next run strictly after `after`, or null when the schedule has no further runs. */
export function nextRun(schedule, after) {
  switch (schedule.kind) {
    case "cron":
      return nextCron(schedule.cron, after)
    case "every":
      return new Date(after.getTime() + schedule.ms)
    case "at":
      return schedule.time.getTime() > after.getTime() ? schedule.time : null
    case "continuous":
      return new Date(after.getTime() + schedule.cooldown)
    case "multi": {
      const times = schedule.schedules.map((s) => nextRun(s, after)).filter(Boolean)
      return times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : null
    }
  }
  return null
}

/** Preview the next `count` run times. */
export function upcoming(spec, count = 5, from = new Date()) {
  const schedule = typeof spec === "string" ? parseSchedule(spec) : spec
  if (schedule.kind === "continuous") return []
  const out = []
  let cursor = from
  while (out.length < count) {
    const next = nextRun(schedule, cursor)
    if (!next) break
    out.push(next)
    cursor = next
  }
  return out
}

/** Validate a schedule spec and list its next runs. Never throws: editors show the error inline. */
export function previewSchedule(spec, count = 3, from = new Date()) {
  try {
    const schedule = parseSchedule(spec)
    if (schedule.kind === "continuous") return { ok: true, next: [], note: `runs back to back, ${Math.round(schedule.cooldown / 1000)}s apart` }
    return { ok: true, next: upcoming(schedule, count, from).map((d) => d.toISOString()) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}
