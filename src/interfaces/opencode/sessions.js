// Interface: the scheduler's session port, implemented with the live opencode plugin context.
import { findAgents } from "../../infrastructure/system/catalog.js"

export function createSessions(context) {
  return {
    createSession: ({ title, directory, agent, model }) => {
      // A subagent can't drive a session; the prompt names it so the main agent delegates to it.
      const usable = agent && findAgents(directory).find((a) => a.id === agent)?.mode !== "subagent" ? agent : undefined
      return context().session.create({ title, location: { directory }, ...(usable ? { agent: usable } : {}), ...(model ? { model } : {}) })
    },
    prompt: ({ sessionID, text, skills }) => context().session.prompt({ sessionID, text, ...(skills ? { skills } : {}) }),
    command: (input) => context().session.command(input),
    interrupt: (input) => context().session.interrupt(input),
    replyPermission: async (input) => {
      const permission = context().permission
      if (typeof permission?.reply !== "function") throw new Error("permission.reply is not available in this opencode version")
      return permission.reply(input)
    },
  }
}
