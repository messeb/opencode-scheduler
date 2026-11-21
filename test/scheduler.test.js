import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { Scheduler } from "../src/application/scheduler.js"
import { buildPrompt, parseModel } from "../src/domain/job/job.js"
import { acquireLock, releaseLock } from "../src/infrastructure/persistence/leader-lock.js"
import { paths } from "../src/infrastructure/persistence/paths.js"
import { fileStore } from "../src/infrastructure/persistence/store.js"
import { translateEvent } from "../src/interfaces/opencode/events.js"

function setup({ jobs = [], settings = {}, start = "2026-11-20T10:00:00" } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oc-sched-"))
  const p = paths({ OPENCODE_SCHEDULER_HOME: home })
  const store = fileStore(p)
  fs.writeFileSync(p.jobsFile, JSON.stringify({ settings, jobs }))
  const clock = { now: new Date(start) }
  const calls = []
  const notifications = []
  let seq = 0
  const api = {
    createSession: async (input) => {
      calls.push(["create", input])
      return { id: `ses_${++seq}` }
    },
    prompt: async (input) => calls.push(["prompt", input]),
    command: async (input) => calls.push(["command", input]),
    interrupt: async (input) => calls.push(["interrupt", input]),
    replyPermission: async (input) => calls.push(["reply", input]),
  }
  const scheduler = new Scheduler({
    store,
    sessions: api,
    notifier: { notify: (n) => notifications.push(n) },
    now: () => clock.now,
    pid: process.pid,
  })
  const advance = (ms) => (clock.now = new Date(clock.now.getTime() + ms))
  // Raw opencode events go through the same translation as in the plugin.
  const event = (raw) => scheduler.handle(translateEvent(raw))
  return { scheduler, calls, notifications, clock, advance, p, store, home, event }
}

const job = (extra = {}) => ({ id: "triage", directory: "/tmp/project", schedule: "every 30m", skill: "triage", ...extra })

test("fires on schedule with the skill attached, and not again while busy", async () => {
  const t = setup({ jobs: [job()] })
  await t.scheduler.tick()
  assert.equal(t.calls.length, 0, "first tick only computes next run")
  t.advance(30 * 60_000)
  await t.scheduler.tick()
  const [create, prompt] = t.calls
  assert.equal(create[0], "create")
  assert.equal(create[1].directory, "/tmp/project")
  assert.match(create[1].title, /triage #1/)
  assert.equal(prompt[0], "prompt")
  assert.deepEqual(prompt[1].skills, [{ id: "triage" }])
  assert.match(prompt[1].text, /scheduled job "triage"/)

  t.advance(30 * 60_000)
  await t.scheduler.tick()
  assert.equal(t.calls.length, 2, "skips while previous run is active")
  assert.equal(t.scheduler.jobState("triage").skipped, 1)
  releaseLock(t.p.lockFile)
})

test("question -> notification, answer -> running, success -> done notification", async () => {
  const t = setup({ jobs: [job({ open: "auto" })] })
  await t.scheduler.tick()
  t.advance(30 * 60_000)
  await t.scheduler.tick()

  await t.event({
    type: "form.created",
    data: { form: { id: "frm_1", sessionID: "ses_1", title: "Questions", fields: [{ key: "q0", title: "Color", description: "Red or blue?", options: [{ value: "Red", label: "Red" }, { value: "Blue", label: "Blue" }] }] } },
  })
  assert.equal(t.scheduler.active.get("ses_1").status, "waiting")
  const q = t.notifications[0]
  assert.equal(q.sessionID, "ses_1")
  assert.equal(q.open, "auto")
  assert.equal(q.directory, "/tmp/project")
  assert.match(q.message, /Red or blue\?\nRed \/ Blue/)

  t.advance(60_000)
  await t.event({ type: "form.replied", data: { id: "frm_1", sessionID: "ses_1", answer: {} } })
  assert.equal(t.scheduler.active.get("ses_1").status, "running")
  assert.equal(t.scheduler.active.get("ses_1").waitedMs, 60_000)

  await t.event({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
  assert.equal(t.scheduler.active.size, 0)
  assert.equal(t.scheduler.jobState("triage").lastStatus, "succeeded")
  const done = t.notifications[1]
  assert.match(done.subtitle, /finished/)
  assert.equal(done.open, "never", "finished runs get a banner only, no dialog or terminal")

  const persisted = t.store.state.load()
  assert.equal(persisted.jobs.triage.lastStatus, "succeeded")
  releaseLock(t.p.lockFile)
})

test("questions from sub-agent sessions are routed to the root run", async () => {
  const t = setup({ jobs: [job()] })
  await t.scheduler.tick()
  await t.scheduler.runNow("triage")
  await t.event({ type: "session.created", data: { sessionID: "ses_child", parentID: "ses_1" } })
  await t.event({ type: "form.created", data: { form: { sessionID: "ses_child", fields: [] } } })
  assert.equal(t.notifications.at(-1).sessionID, "ses_1")
  // child completion does not finish the root run
  await t.event({ type: "session.execution.succeeded", data: { sessionID: "ses_child" } })
  assert.equal(t.scheduler.active.size, 1)
  releaseLock(t.p.lockFile)
})

test("permissions: auto-approve or notify", async () => {
  const t = setup({ jobs: [job({ id: "auto", permissions: "auto" }), job({ id: "ask", schedule: "every 1h" })] })
  await t.scheduler.tick()
  await t.scheduler.runNow("auto")
  await t.scheduler.runNow("ask")
  await t.event({ type: "permission.asked", data: { id: "per_1", sessionID: "ses_1", action: "bash", resources: ["rm -rf build"] } })
  assert.deepEqual(t.calls.find((c) => c[0] === "reply")[1], { sessionID: "ses_1", requestID: "per_1", reply: "once" })
  assert.equal(t.notifications.length, 0)
  await t.event({ type: "permission.asked", data: { id: "per_2", sessionID: "ses_2", action: "edit", resources: ["src/a.ts"] } })
  assert.equal(t.notifications[0].subtitle, "Needs permission")
  assert.match(t.notifications[0].message, /edit: src\/a.ts/)
  releaseLock(t.p.lockFile)
})

test("manual triggers from the CLI run disabled jobs too", async () => {
  const t = setup({ jobs: [job({ enabled: false })] })
  t.store.triggers.request("triage")
  await t.scheduler.tick()
  assert.equal(t.calls[0][0], "create")
  releaseLock(t.p.lockFile)
})

test("reuse session keeps one session and recovers when it was deleted", async () => {
  const t = setup({ jobs: [job({ session: "reuse" })] })
  await t.scheduler.tick()
  await t.scheduler.runNow("triage")
  await t.event({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
  await t.scheduler.runNow("triage")
  assert.equal(t.calls.filter((c) => c[0] === "create").length, 1)
  await t.event({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } })

  let failOnce = true
  const prompt = t.scheduler.sessions.prompt
  t.scheduler.sessions.prompt = async (input) => {
    if (failOnce && input.sessionID === "ses_1") {
      failOnce = false
      throw new Error("session not found")
    }
    return prompt(input)
  }
  await t.scheduler.runNow("triage")
  assert.equal(t.scheduler.jobState("triage").sessionID, "ses_2")
  releaseLock(t.p.lockFile)
})

test("continuous jobs restart after cooldown", async () => {
  const t = setup({ jobs: [job({ schedule: "continuous 5m" })] })
  await t.scheduler.tick()
  assert.equal(t.calls.filter((c) => c[0] === "create").length, 1, "starts immediately")
  await t.event({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
  t.advance(60_000)
  await t.scheduler.tick()
  assert.equal(t.calls.filter((c) => c[0] === "create").length, 1, "cooldown not over")
  t.advance(5 * 60_000)
  await t.scheduler.tick()
  assert.equal(t.calls.filter((c) => c[0] === "create").length, 2)
  releaseLock(t.p.lockFile)
})

test("timeouts interrupt runs, not counting time spent waiting for the human", async () => {
  const t = setup({ jobs: [job({ timeout: "10m" })] })
  await t.scheduler.tick()
  await t.scheduler.runNow("triage")
  await t.event({ type: "form.created", data: { form: { sessionID: "ses_1", fields: [] } } })
  t.advance(30 * 60_000)
  await t.event({ type: "form.replied", data: { sessionID: "ses_1" } })
  await t.scheduler.tick()
  assert.equal(t.calls.some((c) => c[0] === "interrupt"), false)
  t.advance(11 * 60_000)
  await t.scheduler.tick()
  assert.equal(t.calls.some((c) => c[0] === "interrupt"), true)
  await t.event({ type: "session.execution.interrupted", data: { sessionID: "ses_1" } })
  assert.equal(t.scheduler.jobState("triage").lastStatus, "timed out")
  releaseLock(t.p.lockFile)
})

test("start failures are reported", async () => {
  const t = setup({ jobs: [job()] })
  t.scheduler.sessions.createSession = async () => {
    throw new Error("boom")
  }
  await t.scheduler.tick()
  await t.scheduler.runNow("triage")
  assert.equal(t.scheduler.jobState("triage").lastStatus, "error")
  assert.equal(t.scheduler.active.size, 0)
  releaseLock(t.p.lockFile)
})

test("only one leader across processes", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oc-lock-"))
  const file = path.join(home, "lock.json")
  assert.equal(acquireLock(file, 111, () => true), true)
  assert.equal(acquireLock(file, 222, () => true), false, "live holder keeps the lock")
  assert.equal(acquireLock(file, 222, () => false), true, "stale holder is replaced")
})

test("job validation and helpers", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oc-store-"))
  const p = paths({ OPENCODE_SCHEDULER_HOME: home })
  assert.throws(() => fileStore(p).jobs.upsert({ id: "x", directory: "relative", schedule: "@daily", skill: "s" }), /absolute/)
  assert.throws(() => fileStore(p).jobs.upsert({ id: "x", directory: "/tmp", schedule: "@daily" }), /skill, a prompt or a command/)
  assert.throws(() => fileStore(p).jobs.upsert({ id: "bad id", directory: "/tmp", schedule: "@daily", skill: "s" }), /invalid job id/)
  assert.equal(fileStore(p).jobs.upsert({ id: "x", directory: "/tmp", schedule: "@daily", skill: "s" }).session, "new")
  assert.deepEqual(parseModel("anthropic/claude-sonnet-5-5#high"), { providerID: "anthropic", id: "claude-sonnet-5-5", variant: "high" })
  assert.match(buildPrompt({ id: "j", skill: "s", prompt: "focus on bugs" }, 3), /run #3[\s\S]*"s" skill[\s\S]*focus on bugs/)
})

test("a hot reload in the same process adopts active runs; a new process marks them lost", async () => {
  const t = setup({ jobs: [job()] })
  await t.scheduler.tick()
  await t.scheduler.runNow("triage")
  const reloaded = new Scheduler({ store: t.store, sessions: t.scheduler.sessions, notifier: { notify() {} }, now: () => t.clock.now, pid: process.pid })
  assert.equal(reloaded.active.get("ses_1")?.jobId, "triage")
  const other = new Scheduler({ store: t.store, sessions: t.scheduler.sessions, notifier: { notify() {} }, now: () => t.clock.now, pid: 999999 })
  assert.equal(other.active.size, 0)
  assert.equal(other.state.history[0].status, "lost")
  assert.equal(other.state.jobs.triage.lastStatus, "lost")
  releaseLock(t.p.lockFile)
})
