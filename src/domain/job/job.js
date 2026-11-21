// Domain: a scheduled job — what to run, where, when, and how to reach you. Pure: no I/O.
import path from "node:path"
import { parseDuration, parseSchedule } from "../schedule/schedule.js"

export const DEFAULT_NOTIFY = { question: true, permission: true, done: true, error: true }

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const FIELDS = ["id", "directory", "schedule", "skill", "prompt", "command", "agent", "model", "session", "permissions", "open", "timeout", "notify", "enabled"]

/** Keep known fields, trim strings and drop empty ones, so an emptied form field removes the setting. */
export function cleanJob(input) {
  const job = {}
  for (const key of FIELDS) {
    let value = input[key]
    if (typeof value === "string") value = value.trim()
    if (value === "" || value === undefined || value === null) continue
    job[key] = value
  }
  return job
}

/** Validate and fill defaults. Throws on invalid input. */
export function normalizeJob(input) {
  const job = { ...input }
  if (!job.id || !ID_PATTERN.test(job.id)) throw new Error(`invalid job id "${job.id}" (letters, digits, . _ -)`)
  if (!job.directory || !path.isAbsolute(job.directory)) throw new Error(`job ${job.id}: directory must be an absolute path`)
  parseSchedule(job.schedule)
  if (!job.skill && !job.prompt && !job.command) throw new Error(`job ${job.id}: needs a skill, a prompt or a command`)
  if (job.timeout) parseDuration(job.timeout)
  job.session = job.session ?? "new"
  if (!["new", "reuse"].includes(job.session)) throw new Error(`job ${job.id}: session must be "new" or "reuse"`)
  job.permissions = job.permissions ?? "ask"
  if (!["ask", "auto"].includes(job.permissions)) throw new Error(`job ${job.id}: permissions must be "ask" or "auto"`)
  if (job.open && !["click", "auto", "never"].includes(job.open)) throw new Error(`job ${job.id}: open must be click, auto or never`)
  job.enabled = job.enabled ?? true
  return job
}

export function parseModel(value) {
  if (!value) return undefined
  const [ref, variant] = String(value).split("#")
  const slash = ref.indexOf("/")
  if (slash <= 0) throw new Error(`model must look like provider/model, got "${value}"`)
  return { providerID: ref.slice(0, slash), id: ref.slice(slash + 1), ...(variant ? { variant } : {}) }
}

const TOKEN = /@(skill|agent):([A-Za-z0-9](?:[\w.-]*[A-Za-z0-9])?)/g

/** Skills and agent referenced in the prompt as @skill:name / @agent:name, plus the job's own fields. */
export function promptRefs(job) {
  const skills = job.skill ? [job.skill] : []
  let agent = job.agent
  for (const [, kind, name] of String(job.prompt ?? "").matchAll(TOKEN)) {
    if (kind === "skill" && !skills.includes(name)) skills.push(name)
    if (kind === "agent" && !agent) agent = name
  }
  return { skills, agent }
}

export function buildPrompt(job, runNo, now = new Date()) {
  const lines = [
    `You are running unattended as the scheduled job "${job.id}" (run #${runNo}, ${now.toISOString()}).`,
    "Work autonomously and finish the task without waiting for confirmation.",
    "If you truly need a human decision, ask it with the question tool: the user gets a desktop notification and can attach to this session to answer. Do not ask for trivial confirmations.",
  ]
  const { skills } = promptRefs(job)
  if (skills.length) lines.push("", `Load the ${skills.map((s) => `"${s}"`).join(", ")} skill${skills.length > 1 ? "s" : ""} and follow ${skills.length > 1 ? "them" : "it"}.`)
  const text = String(job.prompt ?? "")
    .replace(TOKEN, (_, kind, name) => (kind === "skill" ? `the "${name}" skill` : `the "${name}" agent`))
    .replace(/[ \t]{2,}/g, " ")
    .trim()
  if (text) lines.push("", text)
  return lines.join("\n")
}

/**
 * How a notification of `kind` reaches you for this job, or null when the job doesn't want it.
 * Only questions and permission requests may open a dialog or terminal; finished runs get a banner.
 */
export function notificationMode(job, kind, settings = {}) {
  if (!{ ...DEFAULT_NOTIFY, ...job.notify }[kind]) return null
  if (kind !== "question" && kind !== "permission") return "never"
  return job.open ?? settings.open ?? "click"
}
