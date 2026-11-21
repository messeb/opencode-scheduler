// Interface: the opencode server plugin (v2 API) and composition root — wires the store, scheduler,
// job service, event stream, agent tools and GUI RPC together.
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createJobService } from "../../application/job-service.js"
import { Scheduler } from "../../application/scheduler.js"
import { fileStore } from "../../infrastructure/persistence/store.js"
import { activateApp, focusCommand } from "../../infrastructure/system/desktop-app.js"
import { createLogger } from "../../infrastructure/system/logger.js"
import { createNotifier } from "../../infrastructure/system/notifier.js"
import { translateEvent } from "./events.js"
import { registerRpc } from "./rpc-handlers.js"
import { createSessions } from "./sessions.js"
import { registerTools } from "./tools.js"
import { SchedulerRpc } from "../rpc/contract.js"

const KEY = Symbol.for("opencode-scheduler")
// The plugin used to be called opencode-scheduler-factory; a runtime left over from that name is stopped on load.
const LEGACY_KEY = Symbol.for("opencode-scheduler-factory")
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
// opencode imports the module once per location and again when a file changes. Locations share one runtime;
// a changed source tree (newer mtime) is a reload that replaces the old runtime.
const GENERATION = sourceGeneration()

function sourceGeneration() {
  try {
    const newest = (dir) =>
      Math.max(
        0,
        ...fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
          const file = path.join(dir, entry.name)
          return entry.isDirectory() ? newest(file) : fs.statSync(file).mtimeMs
        }),
      )
    return String(newest(SOURCE_ROOT))
  } catch {
    return "static"
  }
}

function runtime() {
  const legacy = globalThis[LEGACY_KEY]
  if (legacy) {
    legacy.scheduler?.stop()
    legacy.scheduler = undefined
    if (legacy.subscription) legacy.subscription.stopped = true
    legacy.subscription?.iterator?.return?.().catch?.(() => {})
    delete globalThis[LEGACY_KEY]
  }
  const current = globalThis[KEY]
  if (current?.generation === GENERATION) return current
  if (current) {
    current.scheduler?.stop()
    current.scheduler = undefined
    if (current.subscription) current.subscription.stopped = true
    current.subscription?.iterator?.return?.().catch?.(() => {})
    current.log?.("plugin reloaded; replacing scheduler runtime")
  }
  const store = fileStore()
  const rt = { generation: GENERATION, store, log: createLogger(store.paths.logFile), contexts: [], scheduler: undefined, subscription: undefined, rpcs: [], pendingNotifications: new Map() }
  rt.sessions = createSessions(() => liveContext(rt))
  rt.service = createJobService({ store, scheduler: () => rt.scheduler })
  globalThis[KEY] = rt
  return rt
}

function liveContext(rt) {
  const ctx = rt.contexts.at(-1)
  if (!ctx) throw new Error("no live opencode context")
  return ctx
}

/** One event stream per process; moves to another context if its owner goes away. */
function subscribe(rt) {
  if (rt.subscription || rt.contexts.length === 0) return
  const ctx = rt.contexts.at(-1)
  const sub = { ctx, iterator: undefined, stopped: false }
  rt.subscription = sub
  ;(async () => {
    try {
      sub.iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
      while (!sub.stopped) {
        const { value, done } = await sub.iterator.next()
        if (done) break
        try {
          const event = translateEvent(value)
          if (event) await rt.scheduler?.handle(event)
        } catch (error) {
          rt.log("event error", String(error?.stack ?? error))
        }
      }
    } catch (error) {
      if (!sub.stopped) rt.log("event stream error", String(error?.message ?? error))
    } finally {
      if (rt.subscription === sub) rt.subscription = undefined
      if (!sub.stopped) setTimeout(() => subscribe(rt), 2000).unref?.()
    }
  })()
}

function unsubscribe(rt) {
  const sub = rt.subscription
  if (!sub) return
  sub.stopped = true
  rt.subscription = undefined
  sub.iterator?.return?.().catch?.(() => {})
}

/** Tell GUIs to refetch; coalesced so a burst of state writes sends one event. */
function notifyChanged(rt) {
  clearTimeout(rt.changedTimer)
  rt.changedTimer = setTimeout(() => {
    const registration = rt.rpcs.at(-1)
    registration?.events.emit("changed", { at: new Date().toISOString() }).catch((error) => rt.log("rpc emit failed", String(error)))
  }, 250)
  rt.changedTimer.unref?.()
}

/** Open a session in the desktop app: focus the app and ask its GUI (via the "open" event) to show the session. */
function focusInApp(rt, sessionID) {
  rt.openRequest = { sessionID, at: new Date().toISOString() }
  activateApp()
  const registration = rt.rpcs.at(-1)
  if (!registration) rt.log("no GUI connected to open the session", { sessionID })
  registration?.events.emit("open", rt.openRequest).catch((error) => rt.log("rpc emit failed", String(error)))
}

/**
 * Post a notification from the desktop app, so clicking it opens the session there. Resolves true once an app
 * window claimed it (claimNotification); false when none did in time, and the caller falls back to the system.
 */
function notifyInApp(rt, n, timeoutMs = 2000) {
  const registration = rt.rpcs.at(-1)
  if (!registration) return Promise.resolve(false)
  const id = randomUUID()
  return new Promise((resolve) => {
    const settle = (shown) => {
      clearTimeout(timer)
      rt.pendingNotifications.delete(id)
      resolve(shown)
    }
    const timer = setTimeout(() => settle(false), timeoutMs)
    timer.unref?.()
    rt.pendingNotifications.set(id, () => settle(true))
    const data = { id, title: n.title, subtitle: n.subtitle ?? "", message: n.message ?? "", sessionID: n.sessionID }
    registration.events.emit("notify", data).catch((error) => {
      rt.log("rpc emit failed", String(error))
      settle(false)
    })
  })
}

/** First window to claim a notification shows it; later windows and late claims get false. */
function claimNotification(rt, id) {
  const claim = rt.pendingNotifications.get(id)
  claim?.()
  return Boolean(claim)
}

/** RPC for the desktop GUI. Registered per location; all share the one scheduler. */
async function addRpc(ctx, rt) {
  if (typeof ctx.rpc?.register !== "function") return undefined
  const registration = await registerRpc(ctx, {
    service: rt.service,
    sessions: rt.sessions,
    settings: () => rt.scheduler?.settings ?? {},
    focus: (sessionID) => focusInApp(rt, sessionID),
    openRequest: () => rt.openRequest,
    claimNotification: (id) => claimNotification(rt, id),
    log: rt.log,
    changed: () => {
      rt.scheduler?.tick().catch((error) => rt.log("tick failed", String(error)))
      notifyChanged(rt)
    },
  })
  rt.rpcs.push(registration)
  return registration
}

export default {
  id: "opencode-scheduler",
  async setup(ctx) {
    const rt = runtime()
    rt.contexts.push(ctx)
    if (!rt.scheduler) {
      const notifier = createNotifier({
        getSettings: () => rt.scheduler?.settings ?? {},
        log: rt.log,
        openApp: ({ sessionID }) => focusInApp(rt, sessionID),
        appClickCommand: ({ sessionID }) => focusCommand({ sessionID, rpcID: SchedulerRpc.id }),
        appNotify: (n) => notifyInApp(rt, n),
      })
      rt.scheduler = new Scheduler({ store: rt.store, sessions: rt.sessions, notifier, log: rt.log, onChange: () => notifyChanged(rt) })
      rt.scheduler.start()
      rt.log("scheduler started", { pid: process.pid, directory: ctx.location?.directory, version: ctx.app?.version })
    }
    subscribe(rt)
    let tools
    let rpc
    try {
      tools = await registerTools(ctx, { service: rt.service, jobsFile: rt.store.paths.jobsFile })
    } catch (error) {
      rt.log("tool registration failed", String(error))
    }
    try {
      rpc = await addRpc(ctx, rt)
    } catch (error) {
      rt.log("rpc registration failed", String(error?.message ?? error))
    }

    return async () => {
      await tools?.dispose?.().catch?.(() => {})
      rt.rpcs = rt.rpcs.filter((r) => r !== rpc)
      await rpc?.dispose?.().catch?.(() => {})
      rt.contexts = rt.contexts.filter((c) => c !== ctx)
      if (rt.subscription?.ctx === ctx) {
        unsubscribe(rt)
        subscribe(rt)
      }
      if (rt.contexts.length === 0) {
        unsubscribe(rt)
        const wasRunning = Boolean(rt.scheduler)
        rt.scheduler?.stop()
        rt.scheduler = undefined
        // A replaced generation was already stopped by its successor; only report a real shutdown.
        if (wasRunning && globalThis[KEY] === rt) rt.log("scheduler stopped (no live opencode context)")
      }
    }
  },
}
