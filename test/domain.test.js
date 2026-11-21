import assert from "node:assert/strict"
import { test } from "node:test"
import { notificationMode } from "../src/domain/job/job.js"
import { patchInList, removeFromList, saveInList, upsertInList } from "../src/domain/job/job-list.js"
import { evaluateDue, recordSkipped } from "../src/domain/run/job-state.js"
import { finalStatus, markResumed, markWaiting, startRun, timeoutReached } from "../src/domain/run/run.js"
import { parseSchedule } from "../src/domain/schedule/schedule.js"
import { applySettings } from "../src/domain/settings.js"
import { translateEvent } from "../src/interfaces/opencode/events.js"

const job = { id: "j", directory: "/tmp/p", schedule: "every 30m", skill: "s", enabled: true }

test("evaluateDue: first look schedules, then fires once the slot passes", () => {
  const st = {}
  const schedule = parseSchedule(job.schedule)
  const t0 = new Date("2026-11-20T10:00:00")
  assert.deepEqual(evaluateDue(st, job, schedule, t0), { due: false })
  assert.equal(st.nextRunAt, new Date("2026-11-20T10:30:00").toISOString())
  assert.equal(evaluateDue(st, job, schedule, new Date("2026-11-20T10:30:00")).due, true)
  assert.equal(st.nextRunAt, new Date("2026-11-20T11:00:00").toISOString())
})

test("evaluateDue: without catch-up a long-missed run is dropped", () => {
  const st = { schedule: job.schedule, nextRunAt: new Date("2026-11-20T08:00:00").toISOString() }
  const result = evaluateDue(st, job, parseSchedule(job.schedule), new Date("2026-11-20T10:00:00"), { catchUp: false, tickMs: 20_000 })
  assert.equal(result.due, false)
  assert.equal(result.missedMs, 2 * 3_600_000)
})

test("evaluateDue: disabled jobs and continuous cooldown", () => {
  const st = { nextRunAt: "x" }
  assert.equal(evaluateDue(st, { ...job, enabled: false }, parseSchedule(job.schedule), new Date()).due, false)
  assert.equal(st.nextRunAt, null)
  const loop = { ...job, schedule: "continuous 5m" }
  const cooling = { schedule: loop.schedule, lastFinishedAt: "2026-11-20T10:00:00.000Z" }
  assert.equal(evaluateDue(cooling, loop, parseSchedule(loop.schedule), new Date("2026-11-20T10:04:00.000Z")).due, false)
  assert.equal(evaluateDue(cooling, loop, parseSchedule(loop.schedule), new Date("2026-11-20T10:05:00.000Z")).due, true)
  assert.equal(recordSkipped({}, parseSchedule(loop.schedule)), false, "continuous jobs wait instead of counting skips")
})

test("run: waiting time doesn't count towards the timeout", () => {
  const run = startRun({ job, sessionID: "ses_1", runNo: 1, reason: "schedule", at: "2026-11-20T10:00:00.000Z" })
  const at = (m) => new Date(Date.parse("2026-11-20T10:00:00.000Z") + m * 60_000)
  assert.equal(markWaiting(run, at(10).getTime()), true)
  assert.equal(markWaiting(run, at(11).getTime()), false)
  assert.equal(timeoutReached(run, 30 * 60_000, at(50)), false, "not while waiting")
  markResumed(run, at(40).getTime())
  assert.equal(run.waitedMs, 30 * 60_000)
  assert.equal(timeoutReached(run, 30 * 60_000, at(59)), false)
  assert.equal(timeoutReached(run, 30 * 60_000, at(60)), true)
  run.timedOut = true
  assert.equal(finalStatus(run, "interrupted"), "timed out")
})

test("notificationMode: only questions and permissions may open anything", () => {
  assert.equal(notificationMode({ ...job, open: "auto" }, "question"), "auto")
  assert.equal(notificationMode(job, "permission", { open: "never" }), "never")
  assert.equal(notificationMode(job, "question"), "click")
  assert.equal(notificationMode({ ...job, open: "auto" }, "done"), "never")
  assert.equal(notificationMode({ ...job, notify: { done: false } }, "done"), null)
})

test("job list: unique ids, position kept, patch and remove", () => {
  let { jobs } = saveInList([], job)
  ;({ jobs } = upsertInList(jobs, { ...job, id: "k" }))
  ;({ jobs } = upsertInList(jobs, { ...job, schedule: "@daily" }))
  assert.deepEqual(jobs.map((j) => [j.id, j.schedule]), [["j", "@daily"], ["k", "every 30m"]])
  assert.equal(patchInList(jobs, "k", { enabled: false }).job.enabled, false)
  assert.throws(() => saveInList(jobs, { ...job, id: "k" }, "j"), /already exists/)
  assert.deepEqual(removeFromList(jobs, "j").map((j) => j.id), ["k"])
  assert.throws(() => removeFromList(jobs, "nope"), /no job/)
})

test("settings rules", () => {
  assert.deepEqual(applySettings({ notifier: "osascript" }, { notifier: "", open: "auto" }), { open: "auto" })
  assert.throws(() => applySettings({}, { catchUp: "yes" }), /invalid value/)
})

test("opencode events translate into run events", () => {
  assert.deepEqual(translateEvent({ type: "session.created", data: { info: { id: "c", parentID: "p" } } }), { type: "child-session", sessionID: "c", parentID: "p" })
  assert.equal(translateEvent({ type: "session.created", data: { info: { id: "root" } } }), undefined)
  assert.deepEqual(translateEvent({ type: "permission.asked", data: { id: "per", sessionID: "s", action: "bash", patterns: ["ls"] } }), {
    type: "permission",
    sessionID: "s",
    requestID: "per",
    action: "bash",
    message: "bash: ls",
  })
  assert.deepEqual(translateEvent({ type: "session.error", properties: { sessionID: "s", error: { data: { message: "boom" } } } }), { type: "finished", sessionID: "s", outcome: "failed", message: "boom" })
  assert.equal(translateEvent({ type: "message.updated", data: {} }), undefined)
})
