// Interface: RPC handlers for the desktop GUI (contract: interfaces/rpc/contract.js).
import { findAgents, findSkills } from "../../infrastructure/system/catalog.js"
import { pickDirectory } from "../../infrastructure/system/directory-picker.js"
import { attachCommand, openTerminal } from "../../infrastructure/system/terminal.js"
import { SchedulerRpc } from "../rpc/contract.js"

/**
 * service   the job service
 * changed   called after a write: re-tick the scheduler and tell GUIs to refetch
 * sessions  live session access (interrupt)
 * settings  current global settings
 * focus     open a session in the desktop app; openRequest() is the latest such request
 * claimNotification  an app window takes a pending notification to show it; false if another one already did
 */
export function registerRpc(ctx, { service, changed, sessions, settings, focus, openRequest, claimNotification, log }) {
  // RPC values must be plain JSON (no undefined).
  const plain = (value = {}) => JSON.parse(JSON.stringify(value))
  const write = (result) => {
    changed()
    return plain(result)
  }
  // opencode turns thrown errors into a generic "RPC call failed"; return the message as data instead.
  const guard = (handler) => async (input) => {
    try {
      return await handler(input)
    } catch (error) {
      log("rpc error", String(error?.message ?? error))
      return { error: String(error?.message ?? error) }
    }
  }

  return ctx.rpc.register(SchedulerRpc, {
    // openRequest lets a GUI that just started open the session a notification click asked for.
    status: async () => plain({ ...service.snapshot(), openRequest: openRequest() ?? null }),
    run: guard(async ({ id }) => plain(await service.run(id))),
    setEnabled: guard(async ({ id, enabled }) => {
      service.setEnabled(id, enabled)
      return write()
    }),
    saveJob: guard(async ({ job, previousId }) => write({ job: service.save(job, previousId) })),
    deleteJob: guard(async ({ id }) => {
      service.remove(id)
      return write()
    }),
    preview: async ({ schedule }) => service.preview(schedule),
    clearHistory: guard(async () => {
      service.clearHistory()
      return write()
    }),
    stopRun: guard(async ({ sessionID }) => {
      await sessions.interrupt({ sessionID })
      return {}
    }),
    saveSettings: guard(async ({ settings: patch }) => write({ settings: service.saveSettings(patch) })),
    agents: async ({ directory }) => ({ agents: findAgents(directory) }),
    pickDirectory: guard(async ({ start }) => ({ path: await pickDirectory({ start }) })),
    skills: async ({ directory }) => ({ skills: findSkills(directory).map(({ id, description }) => ({ id, description })) }),
    focusSession: guard(async ({ sessionID }) => {
      focus(sessionID)
      return {}
    }),
    claimNotification: async ({ id }) => ({ ok: claimNotification(id) }),
    openTerminal: guard(async ({ sessionID, directory }) => {
      const current = settings()
      openTerminal(attachCommand({ sessionID, directory, server: current.attachServer || undefined }), { terminal: current.terminal ?? "auto" })
      return {}
    }),
  })
}
