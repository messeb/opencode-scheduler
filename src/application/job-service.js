// Application: managing jobs — the use cases behind the agent tools, the desktop GUI and the CLI.
// `scheduler()` returns the running Scheduler in this process, if any; without it, runs are queued for the leader.
import { previewSchedule } from "../domain/schedule/schedule.js"
import { persistableRun } from "../domain/run/run.js"

export function createJobService({ store, scheduler = () => undefined }) {
  const leader = () => (scheduler()?.leader ? scheduler() : undefined)
  const activeRuns = () => (scheduler() ? [...scheduler().active.values()] : store.state.load().active)

  return {
    list: () => store.jobs.load(),

    /** Create or edit a job (previousId = its current id). A renamed job keeps its run record. */
    save(input, previousId) {
      if (previousId && input.id !== previousId && activeRuns().some((run) => run.jobId === previousId)) {
        throw new Error(`"${previousId}" has an active run; rename it after the run finishes`)
      }
      const job = store.jobs.save(input, previousId)
      if (previousId) leader()?.renameJob(previousId, job.id)
      return job
    },

    /** Create or replace by id (agent tool, CLI). */
    upsert: (input) => store.jobs.upsert(input),
    setEnabled: (id, enabled) => store.jobs.patch(id, { enabled }),
    remove: (id) => store.jobs.remove(id),
    saveSettings: (patch) => store.jobs.saveSettings(patch),
    preview: (spec, count) => previewSchedule(spec, count),

    /** Start now when this process runs the scheduler, otherwise queue it for the one that does. */
    async run(id) {
      const running = leader()
      if (running) return { queued: false, sessionID: await running.runNow(id) }
      store.triggers.request(id)
      return { queued: true }
    },

    clearHistory() {
      const running = leader()
      if (running) running.clearHistory()
      else store.state.save({ ...store.state.load(), history: [] })
    },

    /** Read model for overviews: jobs with their run record, active runs, recent finished runs. */
    snapshot() {
      const { settings, jobs, errors } = store.jobs.load()
      const running = leader()
      const state = running ? { ...running.state, active: [...running.active.values()] } : store.state.load()
      return {
        now: new Date().toISOString(),
        leader: store.lock.holder() ?? null,
        settings: { open: settings.open, target: settings.target, terminal: settings.terminal, attachServer: settings.attachServer, catchUp: settings.catchUp, notifier: settings.notifier ?? "" },
        jobs: jobs.map((job) => {
          const st = state.jobs?.[job.id] ?? {}
          return {
            id: job.id,
            schedule: job.schedule,
            enabled: job.enabled,
            skill: job.skill,
            command: job.command,
            prompt: job.prompt,
            directory: job.directory,
            session: job.session,
            permissions: job.permissions,
            agent: job.agent,
            model: job.model,
            open: job.open,
            timeout: job.timeout,
            notify: job.notify,
            nextRunAt: st.nextRunAt ?? null,
            lastRunAt: st.lastRunAt ?? null,
            lastStatus: st.lastStatus ?? null,
            lastError: st.lastError ?? null,
            lastSessionID: st.lastSessionID ?? null,
            runs: st.runs ?? 0,
            skipped: st.skipped ?? 0,
          }
        }),
        active: (state.active ?? []).map(persistableRun),
        history: state.history ?? [],
        errors,
      }
    },
  }
}
