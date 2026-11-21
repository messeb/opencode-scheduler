// Domain: the ordered list of jobs (the aggregate root of the jobs file). Ids are unique; edits keep a job's position.
import { cleanJob, normalizeJob } from "./job.js"

/**
 * Create a job (no previousId) or edit one (previousId = its current id; a different job.id renames it).
 * Returns the new list and the saved job.
 */
export function saveInList(list, input, previousId) {
  const job = normalizeJob(cleanJob(input))
  const index = previousId ? list.findIndex((j) => j.id === previousId) : -1
  if (previousId && index === -1) throw new Error(`no job "${previousId}"`)
  if (list.some((j, i) => j.id === job.id && i !== index)) throw new Error(`a job named "${job.id}" already exists`)
  const jobs = [...list]
  if (index === -1) jobs.push(job)
  else jobs[index] = job
  return { jobs, job }
}

/** Insert or replace by id. */
export function upsertInList(list, input) {
  const existing = list.some((j) => j.id === input.id)
  return saveInList(list, input, existing ? input.id : undefined)
}

export function patchInList(list, id, patch) {
  const existing = list.find((j) => j.id === id)
  if (!existing) throw new Error(`no job "${id}"`)
  return saveInList(list, { ...existing, ...patch }, id)
}

export function removeFromList(list, id) {
  if (!list.some((j) => j.id === id)) throw new Error(`no job "${id}"`)
  return list.filter((j) => j.id !== id)
}
