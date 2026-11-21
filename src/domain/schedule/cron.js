// Domain: minimal 5-field cron parser (minute hour day-of-month month day-of-week), local time.
// Supports: *, lists (1,2), ranges (1-5), steps (*/15, 1-30/5, 10/5), month/day names, @macros.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dom", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTHS, offset: 1 },
  { name: "dow", min: 0, max: 7, names: DAYS, offset: 0 },
]

const MACROS = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
}

function parseValue(raw, field) {
  const lower = raw.toLowerCase()
  if (field.names) {
    const idx = field.names.indexOf(lower)
    if (idx !== -1) return idx + field.offset
  }
  if (!/^\d+$/.test(raw)) throw new Error(`invalid ${field.name} value "${raw}"`)
  const n = Number(raw)
  if (n < field.min || n > field.max) throw new Error(`${field.name} value ${n} out of range ${field.min}-${field.max}`)
  return n
}

function parseField(expr, field) {
  const values = new Set()
  for (const part of expr.split(",")) {
    if (!part) throw new Error(`empty ${field.name} list item`)
    const [rangePart, stepPart, extra] = part.split("/")
    if (extra !== undefined) throw new Error(`invalid ${field.name} step "${part}"`)
    let step = 1
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) throw new Error(`invalid ${field.name} step "${part}"`)
      step = Number(stepPart)
    }
    let start
    let end
    if (rangePart === "*") {
      start = field.min
      end = field.max
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-")
      start = parseValue(a, field)
      end = parseValue(b, field)
      if (start > end) throw new Error(`invalid ${field.name} range "${rangePart}"`)
    } else {
      start = parseValue(rangePart, field)
      // "10/5" means every 5 starting at 10
      end = stepPart !== undefined ? field.max : start
    }
    for (let v = start; v <= end; v += step) values.add(v)
  }
  if (field.name === "dow" && values.has(7)) {
    values.delete(7)
    values.add(0)
  }
  return values
}

export function parseCron(expression) {
  const source = String(expression).trim()
  const expanded = MACROS[source.toLowerCase()] ?? source
  const parts = expanded.split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron expression needs 5 fields, got ${parts.length}: "${source}"`)
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]))
  return {
    source,
    minute,
    hour,
    dom,
    month,
    dow,
    domStar: parts[2] === "*",
    dowStar: parts[4] === "*",
  }
}

function dayMatches(cron, d) {
  const domMatch = cron.dom.has(d.getDate())
  const dowMatch = cron.dow.has(d.getDay())
  if (cron.domStar && cron.dowStar) return true
  if (cron.domStar) return dowMatch
  if (cron.dowStar) return domMatch
  // Vixie cron semantics: when both are restricted, either may match.
  return domMatch || dowMatch
}

/** First matching minute strictly after `after`. Returns null if none within ~5 years. */
export function nextCron(cron, after) {
  const d = new Date(after.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = after.getTime() + 5 * 366 * 24 * 60 * 60 * 1000
  while (d.getTime() <= limit) {
    if (!cron.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!dayMatches(cron, d)) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!cron.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!cron.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d
  }
  return null
}
