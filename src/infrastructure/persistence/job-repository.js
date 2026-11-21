// Infrastructure: the jobs file (jobs + settings), re-read on every access so hand edits apply at once.
import { normalizeJob } from "../../domain/job/job.js"
import { patchInList, removeFromList, saveInList, upsertInList } from "../../domain/job/job-list.js"
import { applySettings, withDefaults } from "../../domain/settings.js"
import { readJson, writeJson } from "./json-file.js"

export function createJobRepository(file) {
  const read = () => {
    const raw = readJson(file, { settings: {}, jobs: [] })
    return { settings: raw.settings ?? {}, jobs: raw.jobs ?? [] }
  }
  const write = (raw) => writeJson(file, raw)
  const change = (fn) => {
    const raw = read()
    const { jobs, job } = fn(raw.jobs)
    write({ ...raw, jobs })
    return job
  }

  return {
    file,
    /** Valid jobs with defaults, settings with defaults, and messages for entries that don't validate. */
    load() {
      const raw = read()
      const errors = []
      const jobs = []
      for (const entry of raw.jobs) {
        try {
          jobs.push(normalizeJob(entry))
        } catch (error) {
          errors.push(error.message)
        }
      }
      return { settings: withDefaults(raw.settings), jobs, errors }
    },
    save: (input, previousId) => change((list) => saveInList(list, input, previousId)),
    upsert: (input) => change((list) => upsertInList(list, input)),
    patch: (id, patch) => change((list) => patchInList(list, id, patch)),
    remove: (id) => change((list) => ({ jobs: removeFromList(list, id) })),
    saveSettings(patch) {
      const raw = read()
      const settings = applySettings(raw.settings, patch)
      write({ ...raw, settings })
      return withDefaults(settings)
    },
  }
}
