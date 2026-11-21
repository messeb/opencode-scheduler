// Domain: one execution of a job in an opencode session. Status: running ⇄ waiting (for you) → finished.

export const HISTORY_LIMIT = 100

export function startRun({ job, sessionID, runNo, reason, at }) {
  return { jobId: job.id, sessionID, runNo, reason, directory: job.directory, startedAt: at, status: "running", waitedMs: 0 }
}

/** The agent asked something. Returns true when the run was running. */
export function markWaiting(run, nowMs) {
  if (run.status === "waiting") return false
  run.status = "waiting"
  run.waitingSince = nowMs
  return true
}

/** The question was answered. Time spent waiting doesn't count towards the timeout. */
export function markResumed(run, nowMs) {
  if (run.status !== "waiting") return false
  run.status = "running"
  run.waitedMs += nowMs - (run.waitingSince ?? nowMs)
  delete run.waitingSince
  return true
}

export function timeoutReached(run, timeoutMs, now) {
  if (run.status !== "running" || run.timedOut) return false
  return now.getTime() - Date.parse(run.startedAt) - run.waitedMs >= timeoutMs
}

/** Final status for an outcome reported by the session. */
export function finalStatus(run, outcome) {
  return outcome === "interrupted" && run.timedOut ? "timed out" : outcome
}

/** The history entry for a finished run. */
export function finishedRecord(run, status, finishedAt, message) {
  const { waitingSince, timedOut, ...rest } = run
  return { ...rest, status, finishedAt, ...(message ? { error: message } : {}) }
}

export function failedStartRecord({ job, sessionID, runNo, reason, at, error }) {
  return { jobId: job.id, sessionID, runNo, reason, directory: job.directory, startedAt: at, finishedAt: at, status: "error", error }
}

/** Most recent first, capped. */
export function addToHistory(history, entry) {
  return [entry, ...(history ?? [])].slice(0, HISTORY_LIMIT)
}

/** A run as stored and shown: without in-memory bookkeeping. */
export function persistableRun({ waitingSince, ...run }) {
  return run
}
