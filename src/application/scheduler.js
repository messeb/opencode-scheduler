// Application: the scheduling engine. Fires due jobs, follows their runs, notifies you.
// Ports (injected, so it runs without a server):
//   store     jobs / state / triggers / lock repositories (infrastructure/persistence/store.js)
//   sessions  createSession({ title, directory, agent, model }) -> { id }, prompt({ sessionID, text, skills }),
//             command({ sessionID, command, arguments }), interrupt({ sessionID }), replyPermission({ sessionID, requestID, reply })
//   notifier  notify({ title, subtitle, message, sessionID, directory, open }), dismiss?(sessionID)
// Session events arrive already translated into the run events below (see interfaces/opencode/events.js).
import { buildPrompt, notificationMode, parseModel, promptRefs } from "../domain/job/job.js"
import { evaluateDue, recordFinished, recordLost, recordSkipped, recordStartFailed, recordStarted } from "../domain/run/job-state.js"
import { addToHistory, failedStartRecord, finalStatus, finishedRecord, markResumed, markWaiting, persistableRun, startRun, timeoutReached } from "../domain/run/run.js"
import { parseDuration, parseSchedule } from "../domain/schedule/schedule.js"
import { tickMs } from "../domain/settings.js"

export class Scheduler {
  constructor({ store, sessions, notifier, log = () => {}, now = () => new Date(), pid = process.pid, onChange = () => {} }) {
    this.store = store
    this.sessions = sessions
    this.notifier = notifier
    this.log = log
    this.now = now
    this.pid = pid
    this.onChange = onChange
    this.settings = {}
    this.jobs = new Map()
    this.state = store.state.load()
    this.active = new Map() // root sessionID -> run
    this.children = new Map() // child sessionID -> root sessionID
    this.leader = false
    this.ticking = false
    this.timer = undefined
    // After a plugin hot reload in the same process the runs are still executing: adopt them.
    // Runs from a previous process cannot still be executing here.
    const sameProcess = this.state.leader?.pid === pid
    for (const run of this.state.active) {
      if (sameProcess) {
        this.active.set(run.sessionID, { waitedMs: 0, ...run })
        continue
      }
      this.record({ ...run, status: "lost", finishedAt: run.startedAt })
      recordLost(this.state.jobs[run.jobId], run.sessionID)
    }
    this.state.active = []
  }

  start() {
    if (this.timer) return
    const loop = () => {
      this.tick().catch((error) => this.log("tick error", String(error?.stack ?? error)))
      this.timer = setTimeout(loop, tickMs(this.settings))
      this.timer.unref?.()
    }
    loop()
  }

  stop() {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.leader) this.store.lock.release(this.pid)
    this.leader = false
  }

  jobState(id) {
    return (this.state.jobs[id] ??= { runs: 0 })
  }

  isBusy(jobId) {
    for (const run of this.active.values()) if (run.jobId === jobId) return true
    return false
  }

  runFor(sessionID) {
    if (!sessionID) return undefined
    return this.active.get(sessionID) ?? this.active.get(this.children.get(sessionID))
  }

  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      const wasLeader = this.leader
      this.leader = this.store.lock.acquire(this.pid)
      if (!this.leader) return
      if (!wasLeader) this.log("became scheduler leader", { pid: this.pid })

      const { settings, jobs, errors } = this.store.jobs.load()
      for (const error of errors) this.log("invalid job", error)
      this.settings = settings
      this.jobs = new Map(jobs.map((job) => [job.id, job]))
      const now = this.now()
      const triggers = this.store.triggers.consume()

      for (const job of jobs) await this.consider(job, now, triggers.has(job.id))
      for (const id of triggers) if (!this.jobs.has(id)) this.log("trigger for unknown job", id)

      this.checkTimeouts(now)
      this.persist()
    } finally {
      this.ticking = false
    }
  }

  async consider(job, now, triggered) {
    const st = this.jobState(job.id)
    let schedule
    try {
      schedule = parseSchedule(job.schedule)
    } catch (error) {
      this.log("bad schedule", job.id, String(error))
      return
    }
    const { due, missedMs } = evaluateDue(st, job, schedule, now, { catchUp: this.settings.catchUp, tickMs: tickMs(this.settings) })
    if (missedMs !== undefined) this.log("skipped missed run", job.id, { lateMs: missedMs })
    if (!due && !triggered) return
    if (this.isBusy(job.id)) {
      if (recordSkipped(st, schedule)) this.log("previous run still active, skipping", job.id)
      return
    }
    await this.fire(job, triggered ? "manual" : "schedule")
  }

  async createSession(job, runNo) {
    const stamp = this.now().toISOString().slice(0, 16).replace("T", " ")
    const info = await this.sessions.createSession({
      title: `⏱ ${job.id} #${runNo} · ${stamp}`,
      directory: job.directory,
      agent: promptRefs(job).agent,
      model: parseModel(job.model),
    })
    return info.id
  }

  async send(job, sessionID, runNo) {
    if (job.command) {
      await this.sessions.command({ sessionID, command: job.command, arguments: [job.arguments, job.prompt].filter(Boolean).join("\n") })
    } else {
      const { skills } = promptRefs(job)
      await this.sessions.prompt({ sessionID, text: buildPrompt(job, runNo, this.now()), skills: skills.length ? skills.map((id) => ({ id })) : undefined })
    }
  }

  async fire(job, reason) {
    const st = this.jobState(job.id)
    const runNo = (st.runs ?? 0) + 1
    let sessionID
    try {
      sessionID = job.session === "reuse" ? st.sessionID : undefined
      const reused = Boolean(sessionID)
      if (!sessionID) sessionID = await this.createSession(job, runNo)
      const run = startRun({ job, sessionID, runNo, reason, at: this.now().toISOString() })
      this.active.set(sessionID, run)
      try {
        await this.send(job, sessionID, runNo)
      } catch (error) {
        if (!reused) throw error
        // The reused session is gone; start a fresh one.
        this.active.delete(sessionID)
        sessionID = await this.createSession(job, runNo)
        run.sessionID = sessionID
        this.active.set(sessionID, run)
        await this.send(job, sessionID, runNo)
      }
      recordStarted(st, { run, job, schedule: parseSchedule(job.schedule) })
      this.log("started run", { job: job.id, runNo, reason, sessionID })
    } catch (error) {
      if (sessionID) this.active.delete(sessionID)
      const at = this.now().toISOString()
      recordStartFailed(st, String(error?.message ?? error), at)
      this.log("run failed to start", job.id, st.lastError)
      this.record(failedStartRecord({ job, sessionID, runNo, reason, at, error: st.lastError }))
      this.notifyJob(job, { kind: "error", sessionID, subtitle: "Run failed to start", message: st.lastError })
    }
    this.persist()
  }

  finish(run, outcome, message) {
    const status = finalStatus(run, outcome)
    this.notifier.dismiss?.(run.sessionID)
    this.active.delete(run.sessionID)
    for (const [child, root] of this.children) if (root === run.sessionID) this.children.delete(child)
    const at = this.now().toISOString()
    recordFinished(this.jobState(run.jobId), status, at)
    this.log("run finished", { job: run.jobId, runNo: run.runNo, status, sessionID: run.sessionID })
    this.record(finishedRecord(run, status, at, message))
    const job = this.jobs.get(run.jobId)
    if (job) {
      const kind = status === "succeeded" ? "done" : "error"
      const subtitle = status === "succeeded" ? `Run #${run.runNo} finished` : `Run #${run.runNo} ${status}`
      this.notifyJob(job, { kind, sessionID: run.sessionID, subtitle, message: message ?? "Click to open the session" })
    }
    this.persist()
  }

  setWaiting(run, waiting) {
    const nowMs = this.now().getTime()
    if (waiting) markWaiting(run, nowMs)
    else if (markResumed(run, nowMs)) this.notifier.dismiss?.(run.sessionID)
    this.persist()
  }

  notifyJob(job, { kind, sessionID, subtitle, message }) {
    const open = notificationMode(job, kind, this.settings)
    if (!open || !sessionID) return
    this.notifier.notify({ title: `opencode · ${job.id}`, subtitle, message, sessionID, directory: job.directory, open })
  }

  /** A run event (see interfaces/opencode/events.js). Events for sessions that aren't scheduled runs are ignored. */
  async handle(event) {
    switch (event?.type) {
      case "child-session": {
        const root = this.active.has(event.parentID) ? event.parentID : this.children.get(event.parentID)
        if (root) this.children.set(event.sessionID, root)
        return
      }
      case "question": {
        const run = this.runFor(event.sessionID)
        if (!run) return
        this.setWaiting(run, true)
        const job = this.jobs.get(run.jobId)
        if (job) this.notifyJob(job, { kind: "question", sessionID: run.sessionID, subtitle: "Needs your answer", message: event.message })
        return
      }
      case "permission": {
        const run = this.runFor(event.sessionID)
        if (!run) return
        const job = this.jobs.get(run.jobId)
        if (job?.permissions === "auto") {
          try {
            await this.sessions.replyPermission({ sessionID: event.sessionID, requestID: event.requestID, reply: "once" })
            this.log("auto-approved permission", { job: job.id, action: event.action })
            return
          } catch (error) {
            this.log("auto-approve failed", String(error))
          }
        }
        this.setWaiting(run, true)
        if (job) this.notifyJob(job, { kind: "permission", sessionID: run.sessionID, subtitle: "Needs permission", message: event.message })
        return
      }
      case "answered": {
        const run = this.runFor(event.sessionID)
        if (run) this.setWaiting(run, false)
        return
      }
      case "finished": {
        const run = this.active.get(event.sessionID)
        if (run) this.finish(run, event.outcome, event.message)
        return
      }
    }
  }

  checkTimeouts(now) {
    for (const run of this.active.values()) {
      const job = this.jobs.get(run.jobId)
      if (!job?.timeout || !timeoutReached(run, parseDuration(job.timeout), now)) continue
      run.timedOut = true
      this.log("run timed out, interrupting", { job: job.id, sessionID: run.sessionID })
      this.sessions.interrupt({ sessionID: run.sessionID }).catch((error) => this.log("interrupt failed", String(error)))
    }
  }

  async runNow(id) {
    const job = this.jobs.get(id) ?? this.store.jobs.load().jobs.find((j) => j.id === id)
    if (!job) throw new Error(`no job "${id}"`)
    if (this.isBusy(id)) throw new Error(`job "${id}" is already running`)
    await this.fire(job, "manual")
    return this.jobState(id).lastSessionID
  }

  /** Keep a job's record when it is renamed. */
  renameJob(previousId, id) {
    if (!this.leader || previousId === id || !this.state.jobs[previousId]) return
    this.state.jobs[id] = this.state.jobs[previousId]
    delete this.state.jobs[previousId]
    this.persist()
  }

  clearHistory() {
    this.state.history = []
    this.persist()
  }

  record(entry) {
    this.state.history = addToHistory(this.state.history, entry)
  }

  persist() {
    if (!this.leader) return
    this.state.leader = { pid: this.pid, at: this.now().toISOString() }
    this.state.active = [...this.active.values()].map(persistableRun)
    try {
      this.store.state.save(this.state)
    } catch (error) {
      this.log("save state failed", String(error))
    }
    this.onChange()
  }
}
