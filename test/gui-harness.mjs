// Loads the built desktop GUI bundle in a simulated host (jsdom + real Solid) and checks what it registers and renders.
// Run: npm run test:gui   (needs `npm run build:gui` first)
import assert from "node:assert/strict"
import Module from "node:module"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>")
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "MouseEvent", "Event"]) globalThis[key] = dom.window[key]

const require = Module.createRequire(import.meta.url)
const { render, insert } = require("solid-js/web")
const { createRenderEffect } = require("solid-js")

const registry = (id) => ({ kind: "registry", id })
const host = {
  Plugin: { define: (definition) => definition },
  Command: registry("command"),
  MenuItem: registry("menu"),
  Panel: registry("panel"),
  TitlebarItem: registry("titlebar"),
  Style: registry("style"),
}
const load = Module._load
Module._load = function (request, ...rest) {
  if (request === "@opencode/plugin/gui") return host
  return load.call(this, request, ...rest)
}

const now = Date.now()
const iso = (offset) => new Date(now + offset).toISOString()
const snapshot = {
  now: iso(0),
  leader: { pid: 4242, since: iso(-3_600_000) },
  jobs: [
    { id: "nightly-triage", schedule: "0 9 * * 1-5", enabled: true, skill: "triage", directory: "/repo/app", nextRunAt: iso(3_600_000), lastRunAt: iso(-600_000), lastStatus: "succeeded", lastError: null, runs: 7 },
    { id: "deps", schedule: "@weekly", enabled: false, command: "update-deps", directory: "/repo/lib", nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null, runs: 0 },
  ],
  active: [
    { jobId: "nightly-triage", sessionID: "ses_wait", runNo: 8, status: "waiting", reason: "schedule", directory: "/repo/app", startedAt: iso(-120_000) },
    { jobId: "next-ticket", sessionID: "ses_run", runNo: 3, status: "running", reason: "manual", directory: "/repo/app", startedAt: iso(-30_000) },
  ],
  history: [{ jobId: "nightly-triage", sessionID: "ses_old", runNo: 7, status: "succeeded", directory: "/repo/app", startedAt: iso(-900_000), finishedAt: iso(-600_000) }],
  errors: [],
}

const controller = new AbortController()
setTimeout(() => {
  console.error("gui harness: timed out")
  process.exit(1)
}, 20_000).unref()
const calls = []
const listeners = {}
const added = []
const ctx = {
  id: "opencode-scheduler",
  signal: controller.signal,
  client: {
    rpc: () => ({
      status: async () => snapshot,
      run: async (input) => (calls.push(["run", input]), { queued: false }),
      setEnabled: async (input) => (calls.push(["setEnabled", input]), {}),
      openTerminal: async (input) => (calls.push(["openTerminal", input]), {}),
      preview: async ({ schedule }) => (schedule === "bogus" ? { ok: false, error: "bad schedule" } : { ok: true, next: [iso(3_600_000)] }),
      agents: async () => ({ agents: [{ id: "build", description: "", mode: "primary" }, { id: "explore", description: "", mode: "subagent" }] }),
      pickDirectory: async () => ({ path: "/picked/project" }),
      skills: async () => ({ skills: [{ id: "triage", description: "Sort new issues" }, { id: "release", description: "" }] }),
      saveJob: async (input) => (input.job.id === "dup" ? { error: 'a job named "dup" already exists' } : (calls.push(["saveJob", input]), { job: input.job })),
      deleteJob: async (input) => (calls.push(["deleteJob", input]), {}),
      clearHistory: async () => (calls.push(["clearHistory"]), {}),
      stopRun: async (input) => (calls.push(["stopRun", input]), {}),
      saveSettings: async (input) => (calls.push(["saveSettings", input]), {}),
      claimNotification: async (input) => (calls.push(["claimNotification", input]), { ok: input.id !== "taken" }),
      events: { on: (name, handler) => ((listeners[name] = handler), () => {}) },
    }),
  },
  servers: { list: () => ["sidecar"], get: (id) => ({ id, builtin: true }) },
  tabs: { open: (session, options) => calls.push(["tab", session, options]) },
  sessions: { current: () => ({ id: "ses_current", directory: "/repo/current" }) },
  layout: { open: (key) => calls.push(["layout", key]) },
  dialogs: {
    open: (renderDialog) => {
      calls.push(["dialog"])
      const host = document.createElement("div")
      host.className = "dialog-host"
      document.body.appendChild(host)
      let dispose
      const handle = {
        close: () => {
          calls.push(["dialog-close"])
          dispose?.()
          host.remove()
        },
      }
      dispose = render(() => renderDialog(handle), host)
      return handle
    },
  },
  toast: { show: (t) => calls.push(["toast", t]) },
  ui: {
    Button: (props) => {
      const el = document.createElement("button")
      el.addEventListener("click", (e) => props.onClick?.(e))
      insert(el, () => props.children)
      return el
    },
    IconButton: (props) => {
      const el = document.createElement("button")
      el.setAttribute("aria-label", props.label)
      el.addEventListener("click", (e) => props.onClick?.(e))
      return el
    },
    Switch: (props) => {
      const el = document.createElement("input")
      el.type = "checkbox"
      el.checked = props.checked
      el.setAttribute("aria-label", props.label)
      el.addEventListener("change", () => props.onChange(el.checked))
      return el
    },
    Dialog: (props) => {
      const el = document.createElement("div")
      el.className = "dialog"
      el.setAttribute("data-title", props.title)
      insert(el, () => props.children)
      const footer = document.createElement("div")
      insert(footer, () => props.footer)
      el.appendChild(footer)
      return el
    },
    TextInput: (props) => {
      const el = document.createElement("input")
      el.setAttribute("aria-label", props.label)
      el.addEventListener("input", () => props.onInput(el.value))
      createRenderEffect(() => (el.value = props.value ?? "")) // controlled, like the real control
      return el
    },
    Menu: (props) => {
      const el = document.createElement("div")
      el.setAttribute("aria-label", props.label)
      createRenderEffect(() => {
      el.replaceChildren()
      for (const item of props.items) {
        if (item.type === "separator") continue
        const b = document.createElement("button")
        b.className = "menu-item"
        b.dataset.menu = props.label
        b.textContent = item.label
        b.addEventListener("click", () => item.onSelect())
        el.appendChild(b)
      }
      })
      return el
    },
  },
  add: (reg, item) => added.push([reg.id, item]),
}

const plugin = require("../dist/gui-experimental.cjs").default
plugin.setup(ctx)
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))
await flush()

const kinds = added.map(([id]) => id)
for (const kind of ["style", "panel", "menu", "command", "titlebar"]) assert.ok(kinds.includes(kind), `registers ${kind}`)

const resolve = (item) => (typeof item === "function" ? item() : item)
const titlebar = resolve(added.find(([id]) => id === "titlebar")[1])
assert.equal(titlebar.label, "1 waiting", "titlebar shows waiting runs")
const menu = resolve(added.find(([id]) => id === "menu")[1])
assert.equal(menu.menu, "session.panel")
assert.equal(menu.description, "2 active")

const panel = added.find(([id]) => id === "panel")[1]
assert.deepEqual(panel.list({ open: ["schedules"] }).map((t) => t.id), ["schedules"])
assert.deepEqual(panel.list({ open: [] }), [])

render(() => panel.render({}), document.body)
await flush()
const text = document.body.textContent
for (const expected of ["Scheduler running · pid 4242", "nightly-triage #8", "needs your answer", "next-ticket #3", "0 9 * * 1-5", "skill triage", "/update-deps", "paused", "nightly-triage #7", "succeeded"]) {
  assert.ok(text.includes(expected), `panel shows "${expected}"`)
}

const button = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label)
button("Answer").click()
assert.deepEqual(calls.at(-1), ["tab", { server: "sidecar", id: "ses_wait" }, { focus: true }], "Answer opens the waiting session as a tab")
button("Run now").click()
await flush()
assert.deepEqual(calls.find((c) => c[0] === "run"), ["run", { id: "nightly-triage" }])
document.querySelector('input[aria-label="Paused"]').click()
await flush()
assert.deepEqual(calls.find((c) => c[0] === "setEnabled"), ["setEnabled", { id: "deps", enabled: true }])
button("Terminal").click()
await flush()
assert.deepEqual(calls.find((c) => c[0] === "openTerminal"), ["openTerminal", { sessionID: "ses_wait", directory: "/repo/app" }])

// --- management ---
const input = (label, root = document) => root.querySelector(`input[aria-label="${label}"]`)
const type = (el, value) => {
  el.value = value
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
}
const dialog = () => document.querySelector(".dialog-host:last-of-type .dialog")
const inDialog = (label) => [...dialog().querySelectorAll("button")].find((b) => b.textContent.trim() === label)

// create
const menuItem = (menu, label) => [...dialog().querySelectorAll(`.menu-item[data-menu="${menu}"]`)].find((b) => b.textContent === label)
const select = (label, value, root) => {
  const el = root.querySelector(`select[aria-label="${label}"]`)
  el.value = value
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
}
const cron = () => dialog().querySelector(".ocs-cron").textContent.trim()

button("New schedule").click()
await flush()
assert.equal(dialog().getAttribute("data-title"), "New schedule")
await new Promise((r) => setTimeout(r, 400)) // preview + skills/agents debounce
assert.ok(dialog().textContent.includes("next:"), "schedule preview shows next run")
assert.equal(input("Project directory", dialog()).value, "/repo/current", "directory defaults to the current session")
assert.ok(!input("Skill", dialog()), "no separate skill field")
assert.equal(cron(), "0 9 * * 1-5", "default: weekdays at 09:00")

// folder picker
inDialog("Choose…").click()
await flush()
assert.equal(input("Project directory", dialog()).value, "/picked/project")

// Mon, Tue, Wed at 09:00 + Mon–Fri at 13:00
const rules = () => [...dialog().querySelectorAll(".ocs-rule")]
const day = (rule, label) => [...rule.querySelectorAll(".ocs-day")].find((b) => b.textContent === label)
day(rules()[0], "Th").click()
day(rules()[0], "Fr").click()
await flush()
inDialog("Add time").click()
await flush()
assert.equal(rules().length, 2)
assert.equal(cron(), "0 9 * * 1-3; 0 13 * * 1-5")
select("Minute", "30", rules()[1])
await flush()
assert.equal(cron(), "0 9 * * 1-3; 30 13 * * 1-5", "time dropdowns update the cron")
select("Minute", "00", rules()[1])
day(rules()[1], "Sa").click()
await flush()
assert.equal(cron(), "0 9 * * 1-3; 0 13 * * 1-6")
day(rules()[1], "Sa").click()
await flush()

// skill and agent go into the instructions
menuItem("Add skill", "triage").click()
await flush()
menuItem("Add agent", "explore (subagent)").click()
await flush()
const prompt = dialog().querySelector('textarea[aria-label="Instructions"]')
prompt.value = prompt.value + "focus on new bugs"
prompt.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
await flush()
assert.equal(input("Name", dialog()).value, "triage", "adding a skill suggests the name")
assert.ok(dialog().textContent.includes("uses skill triage · agent explore"))
inDialog("Create schedule").click()
await flush()
const created = calls.find((c) => c[0] === "saveJob")[1]
assert.equal(created.previousId, undefined)
assert.deepEqual(
  { id: created.job.id, directory: created.job.directory, schedule: created.job.schedule, prompt: created.job.prompt, enabled: created.job.enabled },
  { id: "triage", directory: "/picked/project", schedule: "0 9 * * 1-3; 0 13 * * 1-5", prompt: "@skill:triage @agent:explore focus on new bugs", enabled: true },
)
assert.equal(created.job.skill, "", "skill now lives in the prompt")
assert.equal(created.job.notify, undefined, "default notifications are not written out")
assert.ok(!document.querySelector(".dialog-host"), "dialog closes after saving")

// custom schedules; invalid ones block saving
button("New schedule").click()
await flush()
inDialog("Custom").click()
await flush()
inDialog("Every hour").click()
await flush()
assert.equal(input("Schedule", dialog()).value, "@hourly")
type(input("Schedule", dialog()), "bogus")
type(input("Name", dialog()), "x")
type(dialog().querySelector('textarea[aria-label="Instructions"]'), "do it")
await new Promise((r) => setTimeout(r, 400))
assert.ok(dialog().textContent.includes("bad schedule"))
const saves = calls.filter((c) => c[0] === "saveJob").length
inDialog("Create schedule").click()
await flush()
assert.equal(calls.filter((c) => c[0] === "saveJob").length, saves, "no save with an invalid schedule")
inDialog("Cancel").click()
await flush()

// server errors stay in the dialog
button("New schedule").click()
await flush()
type(input("Name", dialog()), "dup")
type(dialog().querySelector('textarea[aria-label="Instructions"]'), "do it")
inDialog("Create schedule").click()
await flush()
assert.ok(dialog().textContent.includes('a job named "dup" already exists'), "duplicate name error is shown")
inDialog("Cancel").click()
await flush()

// edit (rename): weekly cron opens in the weekday editor, the old skill field shows as a token
button("Edit").click()
await flush()
assert.equal(dialog().getAttribute("data-title"), "Edit nightly-triage")
assert.equal(cron(), "0 9 * * 1-5")
assert.equal(dialog().querySelector('textarea[aria-label="Instructions"]').value, "@skill:triage")
type(input("Name", dialog()), "morning-triage")
await new Promise((r) => setTimeout(r, 300))
inDialog("Save").click()
await flush()
const edited = calls.filter((c) => c[0] === "saveJob").at(-1)[1]
assert.equal(edited.previousId, "nightly-triage")
assert.equal(edited.job.id, "morning-triage")
assert.equal(edited.job.schedule, "0 9 * * 1-5")

// delete needs a second click
button("Edit").click()
await flush()
inDialog("Delete").click()
await flush()
assert.ok(!calls.some((c) => c[0] === "deleteJob"), "first click only asks")
inDialog("Really delete?").click()
await flush()
assert.deepEqual(calls.find((c) => c[0] === "deleteJob"), ["deleteJob", { id: "nightly-triage" }])

// duplicate from the menu
;[...document.querySelectorAll(".menu-item")].find((b) => b.textContent === "Duplicate").click()
await flush()
assert.equal(input("Name", dialog()).value, "nightly-triage-copy")
assert.equal(dialog().getAttribute("data-title"), "New schedule")
inDialog("Cancel").click()
await flush()

// stop a run
button("Stop").click()
await flush()
assert.deepEqual(calls.find((c) => c[0] === "stopRun"), ["stopRun", { sessionID: "ses_wait" }])

button("Clear").click()
await flush()
assert.ok(calls.some((c) => c[0] === "clearHistory"))

// settings
document.querySelector('button[aria-label="Scheduler settings"]').click()
await flush()
type(input("Terminal", dialog()), "iTerm")
inDialog("Save").click()
await flush()
assert.equal(calls.find((c) => c[0] === "saveSettings")[1].settings.terminal, "iTerm")

titlebar.run()
assert.deepEqual(calls.at(-1), ["layout", "opencode-scheduler:schedules"], "titlebar opens the side panel tab")

// A notification click on the server side sends "open"; the GUI opens that session as a tab, once.
listeners.open({ type: "open", data: { sessionID: "ses_clicked", at: new Date().toISOString() } })
assert.deepEqual(calls.at(-1), ["tab", { server: "sidecar", id: "ses_clicked" }, { focus: true }], "open event opens the session")
const tabs = calls.filter((c) => c[0] === "tab").length
listeners.open({ type: "open", data: { sessionID: "ses_old", at: new Date(Date.now() - 120_000).toISOString() } })
assert.equal(calls.filter((c) => c[0] === "tab").length, tabs, "stale open requests are ignored")

// The server's "notify" event becomes an app notification (once claimed); clicking it opens the session.
const notifications = []
globalThis.Notification = class {
  static permission = "granted"
  constructor(title, options) {
    Object.assign(this, { title, ...options })
    notifications.push(this)
  }
}
globalThis.window.focus = () => {}
listeners.notify({ type: "notify", data: { id: "n1", title: "Scheduler: triage", subtitle: "asks a question", message: "Which?", sessionID: "ses_q" } })
await flush()
assert.equal(notifications.length, 1, "claimed notification is shown")
assert.equal(notifications[0].body, "asks a question\nWhich?")
notifications[0].onclick()
assert.deepEqual(calls.at(-1), ["tab", { server: "sidecar", id: "ses_q" }, { focus: true }], "notification click opens the session")
listeners.notify({ type: "notify", data: { id: "taken", title: "t", sessionID: "ses_x" } })
await flush()
assert.equal(notifications.length, 1, "a notification another window claimed is not shown")

controller.abort()
console.log("gui harness: all checks passed")
process.exit(0)
