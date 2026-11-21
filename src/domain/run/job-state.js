// Domain: a job's running record — next/last run, counters, last outcome — and the rule for when it is due.
import { nextRun } from "../schedule/schedule.js"

/**
 * Decide whether `job` is due at `now` and move its next run forward. Mutates `st`.
 * Returns { due, missedMs } — missedMs is set when a late run was dropped because catch-up is off.
 */
export function evaluateDue(st, job, schedule, now, { catchUp = true, tickMs = 20_000 } = {}) {
  if (st.schedule !== job.schedule) {
    st.schedule = job.schedule
    st.nextRunAt = null
  }
  if (!job.enabled) {
    st.nextRunAt = null
    return { due: false }
  }
  if (schedule.kind === "continuous") {
    const readyAt = (st.lastFinishedAt ? Date.parse(st.lastFinishedAt) : 0) + schedule.cooldown
    st.nextRunAt = new Date(Math.max(readyAt, now.getTime())).toISOString()
    return { due: now.getTime() >= readyAt }
  }
  if (st.nextRunAt == null) st.nextRunAt = nextRun(schedule, now)?.toISOString() ?? null
  if (!st.nextRunAt || now.getTime() < Date.parse(st.nextRunAt)) return { due: false }
  const lateMs = now.getTime() - Date.parse(st.nextRunAt)
  st.nextRunAt = nextRun(schedule, now)?.toISOString() ?? null
  // Without catch-up only a run that is at most a few ticks late still fires.
  const due = catchUp !== false || lateMs <= 3 * tickMs
  return due ? { due } : { due, missedMs: lateMs }
}

/** A due slot passed while the previous run was still active. Continuous jobs just wait. */
export function recordSkipped(st, schedule) {
  if (schedule.kind === "continuous") return false
  st.skipped = (st.skipped ?? 0) + 1
  return true
}

export function recordStarted(st, { run, job, schedule }) {
  if (job.session === "reuse") st.sessionID = run.sessionID
  st.runs = run.runNo
  st.lastRunAt = run.startedAt
  st.lastSessionID = run.sessionID
  st.lastStatus = "running"
  delete st.lastError
  if (schedule.kind === "at" && run.reason === "schedule") st.completed = true
}

export function recordStartFailed(st, error, at) {
  st.lastStatus = "error"
  st.lastError = error
  st.lastFinishedAt = at
}

export function recordFinished(st, status, at) {
  st.lastStatus = status
  st.lastFinishedAt = at
}

/** A run from a process that died can't still be executing. */
export function recordLost(st, sessionID) {
  if (st?.lastSessionID === sessionID && st.lastStatus === "running") st.lastStatus = "lost"
}
