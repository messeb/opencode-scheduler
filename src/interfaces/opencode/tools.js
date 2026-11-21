// Interface: agent tools (scheduler_add / _list / _remove / _enable / _run) on top of the job service.
import { upcoming } from "../../domain/schedule/schedule.js"

const str = (description) => ({ type: "string", description })
const text = (content) => ({ content })

function describeJobs(view, jobsFile) {
  if (view.jobs.length === 0 && view.errors.length === 0) return `No scheduled jobs. Jobs file: ${jobsFile}`
  const lines = view.jobs.map((job) => {
    const active = view.active.find((r) => r.jobId === job.id)
    return [
      `- ${job.id} [${job.enabled ? "enabled" : "disabled"}] ${job.schedule}`,
      `  ${job.skill ? `skill=${job.skill} ` : ""}${job.command ? `command=/${job.command} ` : ""}dir=${job.directory}`,
      `  next=${job.nextRunAt ?? "-"} last=${job.lastRunAt ?? "-"} (${job.lastStatus ?? "never run"}) runs=${job.runs}`,
      active ? `  ACTIVE: session ${active.sessionID} (${active.status})` : undefined,
    ]
      .filter(Boolean)
      .join("\n")
  })
  return [...lines, ...view.errors.map((e) => `! ${e}`)].join("\n")
}

export function registerTools(ctx, { service, jobsFile }) {
  const tools = [
    {
      name: "scheduler_add",
      description:
        "Create or replace a scheduled job that runs a skill (or prompt / slash command) autonomously in its own opencode session. " +
        'Schedules: 5-field cron ("0 9 * * 1-5"), "@daily", "every 30m", "at 2026-11-21 09:00", or "continuous 5m" (back-to-back runs with a cooldown). ' +
        "When the running agent asks a question the user gets a desktop notification and can attach to the session.",
      input: {
        type: "object",
        properties: {
          id: str("Short unique job id, e.g. nightly-triage"),
          schedule: str("When to run (see description)"),
          skill: str("Skill to run"),
          prompt: str("Extra instructions (or the whole task when no skill is given)"),
          command: str("Slash command to run instead of a skill, without the leading /"),
          directory: str("Absolute project directory; defaults to the current project"),
          agent: str("Agent to use, e.g. build"),
          model: str("provider/model to use"),
          session: { type: "string", enum: ["new", "reuse"], description: "new = fresh session per run, reuse = one long-lived session" },
          permissions: { type: "string", enum: ["ask", "auto"], description: "auto approves permission requests of scheduled runs" },
          open: { type: "string", enum: ["click", "auto", "never"], description: "How to bring you into the session when the agent asks something" },
          timeout: str("Interrupt runs after this long, e.g. 2h"),
          enabled: { type: "boolean" },
        },
        required: ["id", "schedule"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const directory = input.directory || ctx.location?.directory
        const job = service.upsert({ ...input, directory })
        const next = upcoming(job.schedule, 3).map((d) => d.toLocaleString())
        return text(`Saved job "${job.id}" (${job.schedule}) in ${directory}.${next.length ? `\nNext runs: ${next.join(", ")}` : ""}`)
      },
    },
    {
      name: "scheduler_list",
      description: "List scheduled jobs with their next/last run and active sessions.",
      input: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => text(describeJobs(service.snapshot(), jobsFile)),
    },
    {
      name: "scheduler_remove",
      description: "Delete a scheduled job.",
      input: { type: "object", properties: { id: str("Job id") }, required: ["id"], additionalProperties: false },
      execute: async ({ id }) => {
        service.remove(id)
        return text(`Removed job "${id}".`)
      },
    },
    {
      name: "scheduler_enable",
      description: "Pause or resume a scheduled job.",
      input: {
        type: "object",
        properties: { id: str("Job id"), enabled: { type: "boolean" } },
        required: ["id", "enabled"],
        additionalProperties: false,
      },
      execute: async ({ id, enabled }) => {
        service.setEnabled(id, enabled)
        return text(`Job "${id}" ${enabled ? "enabled" : "paused"}.`)
      },
    },
    {
      name: "scheduler_run",
      description: "Start a scheduled job right now (outside its schedule).",
      input: { type: "object", properties: { id: str("Job id") }, required: ["id"], additionalProperties: false },
      execute: async ({ id }) => {
        const result = await service.run(id)
        return text(result.queued ? `Queued job "${id}"; the scheduler starts it within its next tick.` : `Started job "${id}" in session ${result.sessionID}.`)
      },
    },
  ]
  return ctx.tool?.transform?.((draft) => {
    for (const tool of tools) draft.add(tool)
  })
}
