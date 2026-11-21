import assert from "node:assert/strict"
import { test } from "node:test"
import { nextCron, parseCron } from "../src/domain/schedule/cron.js"
import { nextRun, parseDuration, parseSchedule, upcoming } from "../src/domain/schedule/schedule.js"

const at = (s) => new Date(s)

test("cron: every 15 minutes", () => {
  const cron = parseCron("*/15 * * * *")
  assert.deepEqual(nextCron(cron, at("2026-11-20T10:07:30")), at("2026-11-20T10:15:00"))
  assert.deepEqual(nextCron(cron, at("2026-11-20T10:45:00")), at("2026-11-20T11:00:00"))
})

test("cron: weekdays at 9:00 skips the weekend", () => {
  const cron = parseCron("0 9 * * mon-fri")
  // 2026-11-20 is a Friday
  assert.deepEqual(nextCron(cron, at("2026-11-20T09:00:00")), at("2026-11-23T09:00:00"))
  assert.deepEqual(nextCron(cron, at("2026-11-20T08:59:00")), at("2026-11-20T09:00:00"))
})

test("cron: macros, lists, steps and names", () => {
  assert.deepEqual(nextCron(parseCron("@daily"), at("2026-11-20T10:00")), at("2026-11-21T00:00"))
  assert.deepEqual(nextCron(parseCron("@monthly"), at("2026-11-20T10:00")), at("2026-12-01T00:00"))
  assert.deepEqual(nextCron(parseCron("30 8,18 * * *"), at("2026-11-20T09:00")), at("2026-11-20T18:30"))
  assert.deepEqual(nextCron(parseCron("0 0 1 jan *"), at("2026-11-20T09:00")), at("2027-01-01T00:00"))
  assert.deepEqual(nextCron(parseCron("10/20 * * * *"), at("2026-11-20T09:31")), at("2026-11-20T09:50"))
  assert.deepEqual(nextCron(parseCron("0 12 * * 7"), at("2026-11-20T09:00")), at("2026-11-22T12:00"))
})

test("cron: day-of-month OR day-of-week when both are restricted", () => {
  const cron = parseCron("0 0 1 * mon")
  assert.deepEqual(nextCron(cron, at("2026-11-20T09:00")), at("2026-11-23T00:00"))
})

test("cron: rejects invalid expressions", () => {
  assert.throws(() => parseCron("* * * *"), /5 fields/)
  assert.throws(() => parseCron("61 * * * *"), /out of range/)
  assert.throws(() => parseCron("*/0 * * * *"), /step/)
  assert.throws(() => parseCron("5-1 * * * *"), /range/)
  assert.throws(() => parseCron("x * * * *"), /invalid/)
})

test("durations", () => {
  assert.equal(parseDuration("90s"), 90_000)
  assert.equal(parseDuration("1h30m"), 5_400_000)
  assert.throws(() => parseDuration("soon"))
})

test("schedule specs", () => {
  assert.equal(parseSchedule("every 30m").ms, 1_800_000)
  assert.throws(() => parseSchedule("every 10s"), /at least 1m/)
  assert.equal(parseSchedule("continuous").cooldown, 60_000)
  assert.equal(parseSchedule("continuous 5m").cooldown, 300_000)
  assert.equal(parseSchedule("@hourly").kind, "cron")
  const once = parseSchedule("at 2026-11-21 09:00")
  assert.equal(nextRun(once, at("2026-11-20T00:00")).getTime(), at("2026-11-21T09:00").getTime())
  assert.equal(nextRun(once, at("2026-11-22T00:00")), null)
  assert.throws(() => parseSchedule(""), /empty/)
})

test("upcoming previews", () => {
  const list = upcoming("every 2h", 3, at("2026-11-20T10:00"))
  assert.deepEqual(list, [at("2026-11-20T12:00"), at("2026-11-20T14:00"), at("2026-11-20T16:00")])
  assert.deepEqual(upcoming("continuous"), [])
})
