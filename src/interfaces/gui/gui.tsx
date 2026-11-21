// Desktop app GUI (opencode `./gui-experimental`): a "Schedules" side-panel tab with jobs, active and finished runs.
// Build: `npm run build:gui` -> dist/gui-experimental.cjs
import { Command, MenuItem, Panel, Plugin, Style, TitlebarItem, type Context } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { Rpc } from "@opencode/plugin/rpc"
import { SchedulerRpc } from "../rpc/contract.js"

type Run = {
  jobId: string
  sessionID?: string
  runNo: number
  status: string
  reason?: string
  directory?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

type Job = {
  id: string
  schedule: string
  enabled: boolean
  skill?: string
  command?: string
  prompt?: string
  directory: string
  agent?: string
  model?: string
  session?: string
  permissions?: string
  open?: string
  timeout?: string
  notify?: Partial<Notify>
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  runs: number
  lastSessionID?: string | null
}

type Notify = { question: boolean; permission: boolean; done: boolean; error: boolean }

type Settings = { open: string; target: string; terminal: string; attachServer: string; catchUp: boolean; notifier: string }

type Rule = { days: number[]; hour: string; minute: string }

type Draft = {
  mode: "weekly" | "custom"
  rules: Rule[]
  id: string
  directory: string
  schedule: string
  skill: string
  prompt: string
  command: string
  agent: string
  model: string
  session: string
  permissions: string
  open: string
  timeout: string
  enabled: boolean
  notify: Notify
}

type Preview = { ok: boolean; next?: string[]; note?: string; error?: string }

type Skill = { id: string; description: string }

type Agent = { id: string; description: string; mode: string }

type Snapshot = {
  now: string
  settings?: Settings
  leader: { pid: number; since: string } | null
  jobs: Job[]
  active: Run[]
  history: Run[]
  errors: string[]
  openRequest?: { sessionID: string; at: string } | null
}

const TAB_ID = "schedules"

const PRESETS = [
  ["Every hour", "@hourly"],
  ["Every 30 minutes", "every 30m"],
  ["Continuous (5 min cooldown)", "continuous 5m"],
] as const

const DAYS = [
  [1, "Mo"],
  [2, "Tu"],
  [3, "We"],
  [4, "Th"],
  [5, "Fr"],
  [6, "Sa"],
  [0, "Su"],
] as const

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"))

/** [1,2,3,5] -> "1-3,5"; all days -> "*" */
function dowField(days: number[]) {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return "*"
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let end = i
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++
    parts.push(end - i >= 2 ? `${sorted[i]}-${sorted[end]}` : sorted.slice(i, end + 1).join(","))
    i = end
  }
  return parts.join(",")
}

function rulesToCron(rules: Rule[]) {
  return rules
    .filter((rule) => rule.days.length)
    .map((rule) => `${Number(rule.minute)} ${Number(rule.hour)} * * ${dowField(rule.days)}`)
    .join("; ")
}

/** "0 9 * * 1-3; 0 13 * * 1-5" -> rules, or undefined when the spec is not plain weekly times. */
function cronToRules(spec: string): Rule[] | undefined {
  const parts = spec.split(/\s*[;\n]\s*/).filter(Boolean)
  if (!parts.length) return undefined
  const rules: Rule[] = []
  for (const part of parts) {
    const m = part.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([\d,*-]+)$/)
    if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return undefined
    const days = new Set<number>()
    for (const item of m[3].split(",")) {
      if (item === "*") [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d))
      else {
        const [a, b = a] = item.split("-").map(Number)
        if (!(a >= 0 && b <= 7 && a <= b)) return undefined
        for (let d = a; d <= b; d++) days.add(d % 7)
      }
    }
    rules.push({ days: [...days], hour: m[2].padStart(2, "0"), minute: m[1].padStart(2, "0") })
  }
  return rules
}

function describeRule(rule: Rule) {
  const set = new Set(rule.days)
  const label = set.size === 7 ? "Every day" : [1, 2, 3, 4, 5].every((d) => set.has(d)) && set.size === 5 ? "Mon–Fri" : DAYS.filter(([d]) => set.has(d)).map(([, l]) => l).join(", ")
  return `${label || "no days"} at ${rule.hour}:${rule.minute}`
}

const DEFAULT_NOTIFY: Notify = { question: true, permission: true, done: true, error: true }

function toDraft(job: Job | undefined, directory: string): Draft {
  const schedule = job?.schedule ?? "0 9 * * 1-5"
  const rules = cronToRules(schedule)
  // Older jobs keep skill/agent in their own fields; the editor shows them as tokens in the prompt.
  const tokens = [job?.agent && `@agent:${job.agent}`, job?.skill && `@skill:${job.skill}`].filter(Boolean).join(" ")
  return {
    mode: rules ? "weekly" : "custom",
    rules: rules ?? [{ days: [1, 2, 3, 4, 5], hour: "09", minute: "00" }],
    id: job?.id ?? "",
    directory: job?.directory ?? directory,
    schedule,
    skill: "",
    prompt: [tokens, job?.prompt ?? ""].filter(Boolean).join(" "),
    command: job?.command ?? "",
    agent: "",
    model: job?.model ?? "",
    session: job?.session ?? "new",
    permissions: job?.permissions ?? "ask",
    open: job?.open ?? "",
    timeout: job?.timeout ?? "",
    enabled: job?.enabled ?? true,
    notify: { ...DEFAULT_NOTIFY, ...job?.notify },
  }
}

/** Form state -> job input; the server drops empty strings. */
function fromDraft(draft: Draft) {
  const notify = Object.values(draft.notify).every(Boolean) ? undefined : { ...draft.notify }
  const { mode, rules, ...job } = draft
  return { ...job, schedule: mode === "weekly" ? rulesToCron(rules) : draft.schedule, notify }
}

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

const CSS = `
.ocs { display: flex; flex-direction: column; gap: 18px; padding: 14px 16px 24px; font-size: 13px; line-height: 1.45; color: var(--text-base, inherit); overflow-y: auto; height: 100%; box-sizing: border-box; }
.ocs h3 { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; opacity: .6; display: flex; align-items: center; gap: 8px; }
.ocs-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ocs-status { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .75; }
.ocs-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; }
.ocs-dot.ok { color: #2fa36b; } .ocs-dot.off { color: #b0b0b0; } .ocs-dot.wait { color: #e0a100; } .ocs-dot.err { color: #d9534f; } .ocs-dot.run { color: #3b82f6; }
.ocs-list { display: flex; flex-direction: column; gap: 6px; }
.ocs-card { border: 1px solid var(--border-base, rgba(127,127,127,.25)); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.ocs-card.wait { border-color: #e0a100; background: rgba(224,161,0,.07); }
.ocs-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ocs-row.between { justify-content: space-between; }
.ocs-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ocs-meta { font-size: 12px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ocs-mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
.ocs-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ocs-empty { opacity: .6; font-size: 12px; padding: 4px 0; }
.ocs-error { color: #d9534f; font-size: 12px; white-space: pre-wrap; }
.ocs-hist { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 10px; align-items: center; }
.ocs-hist button { all: unset; cursor: pointer; } .ocs-hist button:hover .ocs-title { text-decoration: underline; }
.ocs-head-actions { display: flex; align-items: center; gap: 4px; }
.ocs-form { display: flex; flex-direction: column; gap: 14px; font-size: 13px; }
.ocs-field { display: flex; flex-direction: column; gap: 5px; }
.ocs-field > label, .ocs-label { font-size: 12px; font-weight: 600; }
.ocs-hint { font-size: 12px; opacity: .65; }
.ocs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.ocs-select, .ocs-textarea { font: inherit; color: inherit; background: var(--surface-base, transparent); border: 1px solid var(--border-base, rgba(127,127,127,.35)); border-radius: 6px; padding: 6px 8px; box-sizing: border-box; width: 100%; }
.ocs-textarea { min-height: 76px; resize: vertical; }
.ocs-select:focus, .ocs-textarea:focus { outline: 2px solid var(--border-focus, #3b82f6); outline-offset: -1px; }
.ocs-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.ocs-chip { font: inherit; font-size: 12px; color: inherit; background: transparent; border: 1px solid var(--border-base, rgba(127,127,127,.35)); border-radius: 999px; padding: 2px 9px; cursor: pointer; }
.ocs-chip:hover { background: rgba(127,127,127,.12); }
.ocs-chip.on { border-color: var(--border-focus, #3b82f6); background: rgba(59,130,246,.12); }
.ocs-preview { font-size: 12px; opacity: .75; }
.ocs-preview.bad { color: #d9534f; opacity: 1; }
.ocs-toggles { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.ocs-toggles label { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.ocs-details summary { cursor: pointer; font-size: 12px; font-weight: 600; opacity: .8; margin-bottom: 10px; }
.ocs-footer { display: flex; align-items: center; gap: 8px; width: 100%; }
.ocs-footer .ocs-spacer { flex: 1; }
.ocs-warn { font-size: 12px; color: #b7791f; }
.ocs-inline { display: flex; gap: 6px; align-items: center; }
.ocs-inline > :first-child { flex: 1; min-width: 0; }
.ocs-rule { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border-base, rgba(127,127,127,.25)); border-radius: 8px; }
.ocs-days { display: flex; gap: 3px; }
.ocs-day { font: inherit; font-size: 12px; width: 30px; height: 26px; border-radius: 6px; border: 1px solid var(--border-base, rgba(127,127,127,.35)); background: transparent; color: inherit; cursor: pointer; }
.ocs-day.on { background: var(--surface-interactive, #3b82f6); border-color: var(--border-focus, #3b82f6); color: #fff; }
.ocs-time { display: flex; align-items: center; gap: 4px; }
.ocs-time .ocs-select { width: auto; padding: 4px 6px; }
.ocs-rules { display: flex; flex-direction: column; gap: 6px; }
.ocs-cron { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; opacity: .8; word-break: break-all; }
.ocs-tabs { display: inline-flex; border: 1px solid var(--border-base, rgba(127,127,127,.35)); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.ocs-tabs button { font: inherit; font-size: 12px; padding: 3px 10px; background: transparent; color: inherit; border: 0; cursor: pointer; }
.ocs-tabs button.on { background: rgba(127,127,127,.18); font-weight: 600; }
.ocs-tokens { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
`

function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "–"
  const diff = Date.parse(iso) - now
  const abs = Math.abs(diff)
  const unit = abs < 60_000 ? [Math.round(abs / 1000), "s"] : abs < 3_600_000 ? [Math.round(abs / 60_000), "m"] : abs < 86_400_000 ? [Math.round(abs / 3_600_000), "h"] : [Math.round(abs / 86_400_000), "d"]
  return diff >= 0 ? `in ${unit[0]}${unit[1]}` : `${unit[0]}${unit[1]} ago`
}

function duration(from?: string, to?: string) {
  if (!from) return ""
  const ms = (to ? Date.parse(to) : Date.now()) - Date.parse(from)
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`
}

function statusDot(status: string | null | undefined) {
  if (status === "waiting") return "wait"
  if (status === "running") return "run"
  if (status === "succeeded") return "ok"
  if (!status) return "off"
  return "err"
}

function project(dir?: string) {
  return dir ? dir.split("/").filter(Boolean).at(-1) ?? dir : ""
}

export default Plugin.define({
  setup(ctx: Context) {
    const [data, setData] = createSignal<Snapshot>()
    const [error, setError] = createSignal<string>()
    const [busy, setBusy] = createSignal<string>()
    const [tick, setTick] = createSignal(Date.now())
    const client = () => ctx.client.rpc(SchedulerRpc as unknown as Rpc.PortableDefinition)
    // The server returns failures as { error } so the message survives the RPC layer.
    const rpc = () =>
      new Proxy(client(), {
        get(target: any, method: string) {
          const value = target[method]
          if (method === "events" || typeof value !== "function") return value
          return async (input: unknown) => {
            const result = await value.call(target, input)
            if (result && typeof result === "object" && typeof (result as any).error === "string") throw new Error((result as any).error)
            return result
          }
        },
      })

    async function refresh() {
      try {
        setData((await rpc().status({})) as Snapshot)
        setError(undefined)
      } catch (e: any) {
        setError(String(e?.message ?? e))
      }
      setTick(Date.now())
    }

    refresh()
    const poll = setInterval(refresh, 15_000)
    ctx.signal.addEventListener("abort", () => clearInterval(poll))
    try {
      rpc().events.on("changed", () => void refresh(), { signal: ctx.signal })
    } catch {}

    const builtinServer = () =>
      ctx.servers
        .list()
        .map((id) => ctx.servers.get(id))
        .find((server) => server?.builtin)

    function openSession(sessionID?: string) {
      const server = builtinServer()
      if (!sessionID || !server) return
      ctx.tabs.open({ server: server.id, id: sessionID }, { focus: true })
    }

    // A notification click asks the server to open a session here: the "open" event while the app runs,
    // or the last request (if recent) when the click just launched the app.
    let openedAt = ""
    function openRequested(request?: { sessionID: string; at: string } | null) {
      if (!request || request.at <= openedAt || Date.now() - Date.parse(request.at) > 60_000) return
      openedAt = request.at
      openSession(request.sessionID)
    }
    try {
      rpc().events.on("open", (event: any) => openRequested(event?.data ?? event), { signal: ctx.signal })
    } catch {}
    createEffect(on(() => data()?.openRequest, (request) => openRequested(request)))

    // The server's notifications, posted from the app so a click lands here (an osascript banner opens Script
    // Editor). Claim first: with several windows only one shows it; without a claim the server uses the system.
    async function showNotification(n?: { id: string; title: string; subtitle?: string; message?: string; sessionID: string }) {
      if (!n?.id || typeof Notification === "undefined") return
      if (Notification.permission === "default") await Notification.requestPermission().catch(() => "denied")
      if (Notification.permission !== "granted") return
      const claim = (await rpc().claimNotification({ id: n.id }).catch(() => undefined)) as { ok?: boolean } | undefined
      if (!claim?.ok) return
      const body = [n.subtitle, n.message].filter((line) => line && line.trim()).join("\n")
      const notification = new Notification(n.title, { body, tag: n.sessionID })
      notification.onclick = () => {
        window.focus()
        openSession(n.sessionID)
      }
    }
    try {
      rpc().events.on("notify", (event: any) => void showNotification(event?.data ?? event), { signal: ctx.signal })
    } catch {}

    async function act(key: string, work: () => Promise<unknown>) {
      setBusy(key)
      try {
        await work()
      } catch (e: any) {
        ctx.toast.show({ title: "Scheduler", description: String(e?.message ?? e), variant: "error" })
      } finally {
        setBusy(undefined)
        refresh()
      }
    }

    const defaultDirectory = () => ctx.sessions.current()?.directory ?? data()?.jobs[0]?.directory ?? ""

    function Select(props: { value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[]; label: string }): JSX.Element {
      return (
        <select class="ocs-select" aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>
          <For each={props.options}>{([value, label]) => <option value={value} selected={value === props.value}>{label}</option>}</For>
        </select>
      )
    }

    function Field(props: { label: string; hint?: JSX.Element; children: JSX.Element }): JSX.Element {
      return (
        <div class="ocs-field">
          <span class="ocs-label">{props.label}</span>
          {props.children}
          <Show when={props.hint}>
            <span class="ocs-hint">{props.hint}</span>
          </Show>
        </div>
      )
    }

    /** Create (no job), edit, or duplicate (copy = true) a schedule. */
    function openEditor(job?: Job, copy = false) {
      const editing = job && !copy ? job.id : undefined
      const initial = toDraft(job, defaultDirectory())
      if (copy) initial.id = `${initial.id}-copy`
      const [draft, setDraft] = createStore<Draft>(initial)
      const [saving, setSaving] = createSignal(false)
      const [problem, setProblem] = createSignal<string>()
      const [preview, setPreview] = createSignal<Preview>()
      const [skills, setSkills] = createSignal<Skill[]>([])
      const [agents, setAgents] = createSignal<Agent[]>([])
      const [picking, setPicking] = createSignal(false)
      let promptRef: HTMLTextAreaElement | undefined
      const [confirmDelete, setConfirmDelete] = createSignal(false)
      const [idTouched, setIdTouched] = createSignal(Boolean(job))
      const timers: ReturnType<typeof setTimeout>[] = []
      const debounce = (fn: () => void, ms: number) => {
        const t = setTimeout(fn, ms)
        timers.push(t)
        return () => clearTimeout(t)
      }

      const handle = ctx.dialogs.open(() => {
        onCleanup(() => timers.forEach(clearTimeout))
        createEffect(
          on(
            () => draft.schedule,
            (schedule) => {
              const cancel = debounce(async () => {
                try {
                  setPreview((await rpc().preview({ schedule })) as Preview)
                } catch (e: any) {
                  setPreview({ ok: false, error: String(e?.message ?? e) })
                }
              }, 250)
              onCleanup(cancel)
            },
          ),
        )
        createEffect(
          on(
            () => draft.directory,
            (directory) => {
              const cancel = debounce(async () => {
                try {
                  setSkills((((await rpc().skills({ directory })) as { skills: Skill[] }).skills ?? []) as Skill[])
                } catch {
                  setSkills([])
                }
                try {
                  setAgents((((await rpc().agents({ directory })) as { agents: Agent[] }).agents ?? []) as Agent[])
                } catch {
                  setAgents([])
                }
              }, 300)
              onCleanup(cancel)
            },
          ),
        )

        // Keep the cron text in step with the weekly rules.
        createEffect(() => {
          if (draft.mode === "weekly") setDraft("schedule", rulesToCron(draft.rules))
        })

        /** Insert @skill:name / @agent:name at the cursor. */
        const insertToken = (token: string) => {
          const text = draft.prompt
          const at = promptRef?.selectionStart ?? text.length
          const before = text.slice(0, at)
          const after = text.slice(at)
          const insert = `${before && !/\s$/.test(before) ? " " : ""}${token}${/^\s/.test(after) ? "" : " "}`
          setDraft("prompt", before + insert + after)
          if (!idTouched() && token.startsWith("@skill:")) setDraft("id", slug(token.slice(7)))
          queueMicrotask(() => {
            promptRef?.focus()
            const caret = before.length + insert.length
            promptRef?.setSelectionRange?.(caret, caret)
          })
        }
        const refs = createMemo(() => [...draft.prompt.matchAll(/@(skill|agent):([A-Za-z0-9](?:[\w.-]*[A-Za-z0-9])?)/g)].map(([, kind, name]) => ({ kind, name })))

        const chooseFolder = async () => {
          setPicking(true)
          try {
            const picked = ((await rpc().pickDirectory({ start: draft.directory })) as { path: string }).path
            if (picked) setDraft("directory", picked)
          } catch (e: any) {
            setProblem(String(e?.message ?? e))
          } finally {
            setPicking(false)
          }
        }
        const updateRule = (index: number, patch: Partial<Rule>) => setDraft("rules", index, (rule) => ({ ...rule, ...patch }))
        const toggleDay = (index: number, day: number) =>
          updateRule(index, { days: draft.rules[index].days.includes(day) ? draft.rules[index].days.filter((d) => d !== day) : [...draft.rules[index].days, day] })

        async function save() {
          setProblem(undefined)
          if (!draft.id) return setProblem("Give the schedule a name.")
          if (!draft.prompt.trim() && !draft.command) return setProblem("Write instructions (add a skill or agent with the buttons), or set a slash command.")
          if (draft.mode === "weekly" && !draft.rules.some((rule) => rule.days.length)) return setProblem("Pick at least one weekday.")
          if (preview() && !preview()!.ok) return setProblem(`Schedule: ${preview()!.error}`)
          setSaving(true)
          try {
            await rpc().saveJob({ job: fromDraft({ ...draft, notify: { ...draft.notify } }), ...(editing ? { previousId: editing } : {}) })
            ctx.toast.show({ title: editing ? `Saved "${draft.id}"` : `Scheduled "${draft.id}"`, variant: "success" })
            handle.close()
            refresh()
          } catch (e: any) {
            setProblem(String(e?.message ?? e))
          } finally {
            setSaving(false)
          }
        }

        async function remove() {
          if (!confirmDelete()) return setConfirmDelete(true)
          setSaving(true)
          try {
            await rpc().deleteJob({ id: editing! })
            ctx.toast.show({ title: `Deleted "${editing}"`, variant: "success" })
            handle.close()
            refresh()
          } catch (e: any) {
            setProblem(String(e?.message ?? e))
          } finally {
            setSaving(false)
          }
        }

        return (
          <ctx.ui.Dialog
            title={editing ? `Edit ${editing}` : "New schedule"}
            description="Runs a skill autonomously on a schedule. When the agent asks a question you get a notification."
            size="large"
            footer={
              <div class="ocs-footer">
                <Show when={editing}>
                  <ctx.ui.Button variant="danger" icon="trash" disabled={saving()} onClick={remove}>
                    {confirmDelete() ? "Really delete?" : "Delete"}
                  </ctx.ui.Button>
                </Show>
                <span class="ocs-spacer" />
                <ctx.ui.Button variant="ghost" onClick={() => handle.close()}>
                  Cancel
                </ctx.ui.Button>
                <ctx.ui.Button variant="contrast" busy={saving()} onClick={save}>
                  {editing ? "Save" : "Create schedule"}
                </ctx.ui.Button>
              </div>
            }
          >
            <div class="ocs-form">
              <div class="ocs-grid">
                <Field label="Name" hint="letters, digits, . _ -">
                  <ctx.ui.TextInput
                    label="Name"
                    size="large"
                    value={draft.id}
                    placeholder="nightly-triage"
                    autofocus={!editing}
                    invalid={Boolean(draft.id) && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(draft.id)}
                    onInput={(v) => {
                      setIdTouched(true)
                      setDraft("id", v)
                    }}
                  />
                </Field>
                <Field label="Enabled">
                  <ctx.ui.Switch checked={draft.enabled} label={draft.enabled ? "Runs on schedule" : "Paused"} onChange={(v) => setDraft("enabled", v)} />
                </Field>
              </div>

              <Field label="Project directory" hint="absolute path; the session runs here">
                <div class="ocs-inline">
                  <ctx.ui.TextInput size="large" label="Project directory" value={draft.directory} placeholder="/Users/me/src/app" onInput={(v) => setDraft("directory", v)} invalid={Boolean(draft.directory) && !draft.directory.startsWith("/")} />
                  <ctx.ui.Button icon="folder" busy={picking()} onClick={chooseFolder}>
                    Choose…
                  </ctx.ui.Button>
                </div>
              </Field>

              <Field
                label="Schedule"
                hint={
                  <span class={`ocs-preview ${preview() && !preview()!.ok ? "bad" : ""}`}>
                    {!preview() ? "…" : !preview()!.ok ? preview()!.error : preview()!.note ?? `next: ${(preview()!.next ?? []).map(when).join(" · ") || "never"}`}
                  </span>
                }
              >
                <div class="ocs-tabs" role="tablist">
                  <button type="button" class={draft.mode === "weekly" ? "on" : ""} onClick={() => setDraft("mode", "weekly")}>
                    Weekdays &amp; times
                  </button>
                  <button type="button" class={draft.mode === "custom" ? "on" : ""} onClick={() => setDraft("mode", "custom")}>
                    Custom
                  </button>
                </div>
                <Show
                  when={draft.mode === "weekly"}
                  fallback={
                    <>
                      <ctx.ui.TextInput size="large" label="Schedule" value={draft.schedule} placeholder="0 9 * * 1-5; every 30m; at 2026-12-01 09:00; continuous 5m" onInput={(v) => setDraft("schedule", v)} invalid={preview() ? !preview()!.ok : false} />
                      <div class="ocs-chips">
                        <For each={PRESETS}>
                          {([label, spec]) => (
                            <button type="button" class={`ocs-chip ${draft.schedule === spec ? "on" : ""}`} onClick={() => setDraft("schedule", spec)}>
                              {label}
                            </button>
                          )}
                        </For>
                      </div>
                    </>
                  }
                >
                  <div class="ocs-rules">
                    <For each={draft.rules}>
                      {(rule, index) => (
                        <div class="ocs-rule" aria-label={describeRule(rule)}>
                          <div class="ocs-days">
                            <For each={DAYS}>
                              {([day, label]) => (
                                <button type="button" class={`ocs-day ${rule.days.includes(day) ? "on" : ""}`} aria-pressed={rule.days.includes(day)} onClick={() => toggleDay(index(), day)}>
                                  {label}
                                </button>
                              )}
                            </For>
                          </div>
                          <div class="ocs-time">
                            <Select label="Hour" value={rule.hour} onChange={(v) => updateRule(index(), { hour: v })} options={HOURS.map((h) => [h, h] as const)} />
                            <span>:</span>
                            <Select
                              label="Minute"
                              value={rule.minute}
                              onChange={(v) => updateRule(index(), { minute: v })}
                              options={(MINUTES.includes(rule.minute) ? MINUTES : [...MINUTES, rule.minute].sort()).map((m) => [m, m] as const)}
                            />
                          </div>
                          <span class="ocs-chips">
                            <button type="button" class="ocs-chip" onClick={() => updateRule(index(), { days: [1, 2, 3, 4, 5] })}>
                              Mon–Fri
                            </button>
                            <button type="button" class="ocs-chip" onClick={() => updateRule(index(), { days: [0, 1, 2, 3, 4, 5, 6] })}>
                              Daily
                            </button>
                          </span>
                          <Show when={draft.rules.length > 1}>
                            <ctx.ui.IconButton icon="close" label={`Remove ${describeRule(rule)}`} onClick={() => setDraft("rules", (rules) => rules.filter((_, i) => i !== index()))} />
                          </Show>
                        </div>
                      )}
                    </For>
                    <div class="ocs-row">
                      <ctx.ui.Button size="small" variant="ghost" icon="plus" onClick={() => setDraft("rules", (rules) => [...rules, { days: [1, 2, 3, 4, 5], hour: "13", minute: "00" }])}>
                        Add time
                      </ctx.ui.Button>
                      <span class="ocs-cron" title="cron">
                        {draft.schedule || "–"}
                      </span>
                    </div>
                  </div>
                </Show>
              </Field>

              <Field
                label="Instructions"
                hint={
                  refs().length
                    ? `uses ${refs().map((r) => `${r.kind} ${r.name}`).join(" · ")}`
                    : "what the agent should do; add skills and agents with the buttons (with a slash command these are its arguments)"
                }
              >
                <textarea
                  ref={promptRef}
                  class="ocs-textarea"
                  aria-label="Instructions"
                  value={draft.prompt}
                  placeholder="Use @skill:triage on new issues and open a PR per fix."
                  onInput={(e) => setDraft("prompt", e.currentTarget.value)}
                />
                <div class="ocs-tokens">
                  <ctx.ui.Menu
                    label="Add skill"
                    trigger="button"
                    icon="plus"
                    items={
                      skills().length
                        ? skills().map((skill) => ({ label: skill.id, onSelect: () => insertToken(`@skill:${skill.id}`) }))
                        : [{ label: "No skills found for this directory", disabled: true, onSelect: () => {} }]
                    }
                  />
                  <ctx.ui.Menu
                    label="Add agent"
                    trigger="button"
                    icon="plus"
                    items={agents().map((agent) => ({ label: agent.mode === "subagent" ? `${agent.id} (subagent)` : agent.id, onSelect: () => insertToken(`@agent:${agent.id}`) }))}
                  />
                </div>
              </Field>

              <details class="ocs-details" open={Boolean(job?.command || job?.model || job?.timeout || job?.session === "reuse" || job?.permissions === "auto" || job?.open)}>
                <summary>Advanced</summary>
                <div class="ocs-form">
                  <div class="ocs-grid">
                    <Field label="Slash command" hint="instead of a skill">
                      <ctx.ui.TextInput size="large" label="Slash command" value={draft.command} placeholder="release-notes" onInput={(v) => setDraft("command", v.replace(/^\//, ""))} />
                    </Field>
                    <Field label="Timeout" hint="waiting for you doesn't count">
                      <ctx.ui.TextInput size="large" label="Timeout" value={draft.timeout} placeholder="2h" onInput={(v) => setDraft("timeout", v)} />
                    </Field>
                    <Field label="Model">
                      <ctx.ui.TextInput size="large" label="Model" value={draft.model} placeholder="provider/model" onInput={(v) => setDraft("model", v)} />
                    </Field>
                  </div>
                  <div class="ocs-grid">
                    <Field label="Session">
                      <Select label="Session" value={draft.session} onChange={(v) => setDraft("session", v)} options={[["new", "New session per run"], ["reuse", "Reuse one session"]]} />
                    </Field>
                    <Field label="Permissions">
                      <Select label="Permissions" value={draft.permissions} onChange={(v) => setDraft("permissions", v)} options={[["ask", "Ask me"], ["auto", "Approve automatically"]]} />
                    </Field>
                    <Field label="On a question">
                      <Select
                        label="On a question"
                        value={draft.open}
                        onChange={(v) => setDraft("open", v)}
                        options={[["", `Default (${data()?.settings?.open ?? "click"})`], ["click", "Notify, click to open"], ["auto", "Open the session at once"], ["never", "Notify only"]]}
                      />
                    </Field>
                  </div>
                  <Show when={draft.permissions === "auto"}>
                    <div class="ocs-warn">Approves every permission the run asks for, including shell commands. Use it only for trusted skills and directories.</div>
                  </Show>
                  <Field label="Notify me when">
                    <div class="ocs-toggles">
                      <For each={[["question", "it asks a question"], ["permission", "it needs a permission"], ["done", "a run finishes"], ["error", "a run fails"]] as const}>
                        {([key, label]) => (
                          <label>
                            <input type="checkbox" checked={draft.notify[key]} onChange={(e) => setDraft("notify", key, e.currentTarget.checked)} />
                            {label}
                          </label>
                        )}
                      </For>
                    </div>
                  </Field>
                </div>
              </details>

              <Show when={problem()}>
                <div class="ocs-error">{problem()}</div>
              </Show>
            </div>
          </ctx.ui.Dialog>
        )
      })
    }

    function openSettings() {
      const current = data()?.settings
      const [form, setForm] = createStore<Settings>({ open: current?.open ?? "click", target: current?.target ?? "app", terminal: current?.terminal ?? "auto", attachServer: current?.attachServer ?? "", catchUp: current?.catchUp ?? true, notifier: current?.notifier ?? "" })
      const [saving, setSaving] = createSignal(false)
      const [problem, setProblem] = createSignal<string>()
      const handle = ctx.dialogs.open(() => (
        <ctx.ui.Dialog
          title="Scheduler settings"
          footer={
            <div class="ocs-footer">
              <span class="ocs-spacer" />
              <ctx.ui.Button variant="ghost" onClick={() => handle.close()}>
                Cancel
              </ctx.ui.Button>
              <ctx.ui.Button
                variant="contrast"
                busy={saving()}
                onClick={async () => {
                  setSaving(true)
                  try {
                    await rpc().saveSettings({ settings: { ...form } })
                    handle.close()
                    refresh()
                  } catch (e: any) {
                    setProblem(String(e?.message ?? e))
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                Save
              </ctx.ui.Button>
            </div>
          }
        >
          <div class="ocs-form">
            <Field label="Open sessions in">
              <Select label="Open sessions in" value={form.target} onChange={(v) => setForm("target", v)} options={[["app", "OpenCode app"], ["terminal", "Terminal"]]} />
            </Field>
            <Field label="Terminal" hint="auto, Ghostty, iTerm, Terminal, WezTerm, kitty, Alacritty, or a command with {cmd}">
              <ctx.ui.TextInput size="large" label="Terminal" value={form.terminal} onInput={(v) => setForm("terminal", v)} />
            </Field>
            <Field label="When the agent asks a question">
              <Select label="When the agent asks a question" value={form.open} onChange={(v) => setForm("open", v)} options={[["click", "Notify, click to open the session"], ["auto", "Open the session at once"], ["never", "Notify only"]]} />
            </Field>
            <Field label="Notifications">
              <Select label="Notifications" value={form.notifier} onChange={(v) => setForm("notifier", v)} options={[["", "From the OpenCode app (system banner as fallback)"], ["osascript", "macOS banner + dialog"], ["none", "Off"]]} />
            </Field>
            <Field label="Attach to server" hint="empty = opencode's background service">
              <ctx.ui.TextInput size="large" label="Attach to server" value={form.attachServer} placeholder="http://127.0.0.1:4096" onInput={(v) => setForm("attachServer", v)} />
            </Field>
            <ctx.ui.Switch checked={form.catchUp} label="Run a missed schedule once after downtime" onChange={(v) => setForm("catchUp", v)} />
            <Show when={problem()}>
              <div class="ocs-error">{problem()}</div>
            </Show>
          </div>
        </ctx.ui.Dialog>
      ))
    }

    const waiting = createMemo(() => data()?.active.filter((r) => r.status === "waiting") ?? [])
    const running = createMemo(() => data()?.active.filter((r) => r.status !== "waiting") ?? [])

    function RunCard(props: { run: Run }): JSX.Element {
      return (
        <div class={`ocs-card ${props.run.status === "waiting" ? "wait" : ""}`}>
          <div class="ocs-row between">
            <div class="ocs-row">
              <span class={`ocs-dot ${statusDot(props.run.status)}`} />
              <span class="ocs-title">
                {props.run.jobId} #{props.run.runNo}
              </span>
            </div>
            <span class="ocs-meta">{props.run.status === "waiting" ? "needs your answer" : `running ${duration(props.run.startedAt)}`}</span>
          </div>
          <div class="ocs-meta">
            {project(props.run.directory)} · started {ago(props.run.startedAt, tick())} · {props.run.reason}
          </div>
          <div class="ocs-actions">
            <ctx.ui.Button size="small" variant={props.run.status === "waiting" ? "contrast" : "neutral"} icon="arrow-up-right" onClick={() => openSession(props.run.sessionID)}>
              {props.run.status === "waiting" ? "Answer" : "Open session"}
            </ctx.ui.Button>
            <ctx.ui.Button
              size="small"
              variant="ghost"
              icon="terminal"
              onClick={() => act(`term:${props.run.sessionID}`, () => rpc().openTerminal({ sessionID: props.run.sessionID!, directory: props.run.directory }))}
            >
              Terminal
            </ctx.ui.Button>
            <ctx.ui.Button
              size="small"
              variant="ghost-muted"
              icon="stop"
              busy={busy() === `stop:${props.run.sessionID}`}
              onClick={() => act(`stop:${props.run.sessionID}`, () => rpc().stopRun({ sessionID: props.run.sessionID! }))}
            >
              Stop
            </ctx.ui.Button>
          </div>
        </div>
      )
    }

    function JobCard(props: { job: Job }): JSX.Element {
      const what = () => [props.job.skill && `skill ${props.job.skill}`, props.job.command && `/${props.job.command}`, !props.job.skill && !props.job.command && "prompt"].filter(Boolean).join(" · ")
      return (
        <div class="ocs-card">
          <div class="ocs-row between">
            <div class="ocs-row">
              <span class={`ocs-dot ${props.job.enabled ? statusDot(props.job.lastStatus) : "off"}`} />
              <span class="ocs-title">{props.job.id}</span>
            </div>
            <ctx.ui.Switch
              checked={props.job.enabled}
              label={props.job.enabled ? "Enabled" : "Paused"}
              hideLabel
              onChange={(enabled) => act(`toggle:${props.job.id}`, () => rpc().setEnabled({ id: props.job.id, enabled }))}
            />
          </div>
          <div class="ocs-meta">
            <span class="ocs-mono">{props.job.schedule}</span> · {what()} · {project(props.job.directory)}
          </div>
          <div class="ocs-meta">
            next {props.job.enabled ? ago(props.job.nextRunAt, tick()) : "paused"} · last {ago(props.job.lastRunAt, tick())}
            {props.job.lastStatus ? ` (${props.job.lastStatus})` : ""} · {props.job.runs} runs
          </div>
          <Show when={props.job.lastError}>
            <div class="ocs-error">{props.job.lastError}</div>
          </Show>
          <div class="ocs-actions">
            <ctx.ui.Button size="small" icon="arrow-right" busy={busy() === `run:${props.job.id}`} onClick={() => act(`run:${props.job.id}`, () => rpc().run({ id: props.job.id }))}>
              Run now
            </ctx.ui.Button>
            <ctx.ui.Button size="small" variant="ghost" icon="edit" onClick={() => openEditor(props.job)}>
              Edit
            </ctx.ui.Button>
            <ctx.ui.Menu
              label={`More actions for ${props.job.id}`}
              icon="dot-grid"
              items={[
                { label: "Duplicate", icon: "copy", onSelect: () => openEditor(props.job, true) },
                { label: "Open last session", icon: "arrow-up-right", disabled: !props.job.lastSessionID, onSelect: () => openSession(props.job.lastSessionID ?? undefined) },
                { type: "separator" },
                { label: "Delete…", icon: "trash", onSelect: () => openEditor(props.job) },
              ]}
            />
          </div>
        </div>
      )
    }

    function Overview(): JSX.Element {
      return (
        <div class="ocs">
          <div class="ocs-head">
            <div class="ocs-status">
              <span class={`ocs-dot ${data()?.leader ? "ok" : "off"}`} />
              {data()?.leader ? `Scheduler running · pid ${data()!.leader!.pid}` : "Scheduler not running"}
            </div>
            <div class="ocs-head-actions">
              <ctx.ui.Button size="small" icon="plus" onClick={() => openEditor()}>
                New schedule
              </ctx.ui.Button>
              <ctx.ui.IconButton icon="settings-gear" label="Scheduler settings" onClick={openSettings} />
              <ctx.ui.IconButton icon="refresh" label="Refresh" onClick={() => refresh()} />
            </div>
          </div>
          <Show when={error()}>
            <div class="ocs-error">Cannot reach the scheduler: {error()}</div>
          </Show>

          <section>
            <h3>
              Active <span>{data()?.active.length ?? 0}</span>
            </h3>
            <div class="ocs-list">
              <For each={[...waiting(), ...running()]} fallback={<div class="ocs-empty">Nothing running right now.</div>}>
                {(run) => <RunCard run={run} />}
              </For>
            </div>
          </section>

          <section>
            <h3>Schedules</h3>
            <div class="ocs-list">
              <For
                each={data()?.jobs ?? []}
                fallback={
                  <div class="ocs-empty">
                    No schedules yet. Click <b>New schedule</b>, or ask the agent ("schedule the triage skill every weekday at 9").
                  </div>
                }
              >
                {(job) => <JobCard job={job} />}
              </For>
            </div>
            <For each={data()?.errors ?? []}>{(e) => <div class="ocs-error">{e}</div>}</For>
          </section>

          <section>
            <div class="ocs-row between">
              <h3>Finished</h3>
              <Show when={(data()?.history ?? []).length > 0}>
                <ctx.ui.Button size="small" variant="ghost-muted" onClick={() => act("clear", () => rpc().clearHistory({}))}>
                  Clear
                </ctx.ui.Button>
              </Show>
            </div>
            <div class="ocs-hist">
              <For each={(data()?.history ?? []).slice(0, 30)} fallback={<div class="ocs-empty">No finished runs yet.</div>}>
                {(run) => (
                  <>
                    <span class={`ocs-dot ${statusDot(run.status)}`} />
                    <button type="button" disabled={!run.sessionID} onClick={() => openSession(run.sessionID)} title={run.error ?? run.status}>
                      <div class="ocs-title">
                        {run.jobId} #{run.runNo}
                      </div>
                      <div class="ocs-meta">
                        {run.status} · {duration(run.startedAt, run.finishedAt)} · {project(run.directory)}
                      </div>
                    </button>
                    <span class="ocs-meta">{ago(run.finishedAt, tick())}</span>
                  </>
                )}
              </For>
            </div>
          </section>
        </div>
      )
    }

    const key = `${ctx.id}:${TAB_ID}`
    const tab = { id: TAB_ID, title: "Schedules" }

    function openOverview() {
      const session = ctx.sessions.current()
      if (session) {
        ctx.layout.open(key, session)
        return
      }
      ctx.dialogs.open(() => (
        <ctx.ui.Dialog title="Schedules" size="large">
          <Overview />
        </ctx.ui.Dialog>
      ))
    }

    ctx.add(Style, CSS)
    ctx.add(Panel, {
      id: TAB_ID,
      region: "side",
      width: 420,
      list: (input) => (input.open.includes(TAB_ID) ? [tab] : []),
      render: () => <Overview />,
    })
    ctx.add(MenuItem, () => ({
      menu: "session.panel" as const,
      id: TAB_ID,
      title: "Schedules",
      icon: "outline-rotate-clockwise" as const,
      description: data()?.active.length ? `${data()!.active.length} active` : undefined,
      run: openOverview,
    }))
    ctx.add(Command, { id: "open", title: "Schedules: show overview", group: "Scheduler", run: openOverview })
    ctx.add(Command, { id: "new", title: "Schedules: new schedule", group: "Scheduler", run: () => openEditor() })
    ctx.add(TitlebarItem, () => {
      const w = waiting().length
      const r = running().length
      return {
        id: TAB_ID,
        label: w ? `${w} waiting` : r ? `${r} running` : "Schedules",
        title: "Scheduled runs",
        icon: w ? ("notifications" as const) : ("outline-rotate-clockwise" as const),
        pressed: w > 0,
        run: openOverview,
      }
    })
  },
})
