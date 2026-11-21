// RPC contract between the server plugin and its desktop GUI (`./rpc` export).
// Plain object: `Rpc.define` from @opencode/plugin/rpc is an identity helper, and this file must also load in plain Node.

const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: true })

export const SchedulerRpc = {
  id: "opencode-scheduler",
  methods: {
    status: {
      input: object(),
      output: object(),
    },
    run: {
      input: object({ id: { type: "string" } }, ["id"]),
      output: object({ sessionID: { type: "string" }, queued: { type: "boolean" } }),
    },
    setEnabled: {
      input: object({ id: { type: "string" }, enabled: { type: "boolean" } }, ["id", "enabled"]),
      output: object(),
    },
    saveJob: {
      // previousId: the id being edited; omit to create. A different job.id renames the job.
      input: object({ job: object(), previousId: { type: "string" } }, ["job"]),
      output: object(),
    },
    deleteJob: {
      input: object({ id: { type: "string" } }, ["id"]),
      output: object(),
    },
    preview: {
      input: object({ schedule: { type: "string" } }, ["schedule"]),
      output: object({ ok: { type: "boolean" } }),
    },
    stopRun: {
      input: object({ sessionID: { type: "string" } }, ["sessionID"]),
      output: object(),
    },
    saveSettings: {
      input: object({ settings: object() }, ["settings"]),
      output: object(),
    },
    agents: {
      input: object({ directory: { type: "string" } }),
      output: object(),
    },
    pickDirectory: {
      input: object({ start: { type: "string" } }),
      output: object({ path: { type: "string" } }),
    },
    clearHistory: {
      input: object(),
      output: object(),
    },
    skills: {
      input: object({ directory: { type: "string" } }),
      output: object(),
    },
    openTerminal: {
      input: object({ sessionID: { type: "string" }, directory: { type: "string" } }, ["sessionID"]),
      output: object(),
    },
    // Open a session in the desktop app: brings the app forward and tells its GUI to open the session tab.
    focusSession: {
      input: object({ sessionID: { type: "string" } }, ["sessionID"]),
      output: object(),
    },
    // An app window takes a "notify" event to show it as a system notification; ok is false if another took it.
    claimNotification: {
      input: object({ id: { type: "string" } }, ["id"]),
      output: object({ ok: { type: "boolean" } }),
    },
  },
  events: {
    changed: { schema: object({ at: { type: "string" } }) },
    open: { schema: object({ sessionID: { type: "string" }, at: { type: "string" } }) },
    notify: {
      schema: object({ id: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" }, message: { type: "string" }, sessionID: { type: "string" } }),
    },
  },
}

export default SchedulerRpc
