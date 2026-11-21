// Interface (anti-corruption layer): translate opencode's session events into the scheduler's run events.
//   { type: "child-session", sessionID, parentID }
//   { type: "question", sessionID, message }
//   { type: "permission", sessionID, requestID, action, message }
//   { type: "answered", sessionID }
//   { type: "finished", sessionID, outcome: "succeeded" | "failed" | "interrupted", message? }
// Returns undefined for events the scheduler doesn't care about.

function summarizeForm(form) {
  const fields = form?.fields ?? []
  const first = fields[0]
  const question = first?.description || first?.title || form?.title || "The agent has a question"
  const options = (first?.options ?? []).map((o) => o.label ?? o.value).filter(Boolean)
  const more = fields.length > 1 ? ` (+${fields.length - 1} more)` : ""
  return options.length ? `${question}${more}\n${options.join(" / ")}` : `${question}${more}`
}

export function translateEvent(event) {
  const data = event?.data ?? event?.properties ?? {}
  switch (event?.type) {
    case "session.created": {
      const info = data.info ?? data
      return info.parentID ? { type: "child-session", sessionID: info.sessionID ?? info.id, parentID: info.parentID } : undefined
    }
    case "form.created": {
      const form = data.form ?? data
      return { type: "question", sessionID: form.sessionID, message: summarizeForm(form) }
    }
    case "question.asked":
      return { type: "question", sessionID: data.sessionID, message: data.questions?.[0]?.question ?? "The agent has a question" }
    case "permission.asked": {
      const action = data.action ?? data.permission
      const what = [action, (data.resources ?? data.patterns ?? []).join(", ")].filter(Boolean).join(": ")
      return { type: "permission", sessionID: data.sessionID, requestID: data.id, action, message: what || "The agent is waiting for a permission" }
    }
    case "form.replied":
    case "form.cancelled":
    case "question.replied":
    case "question.rejected":
    case "permission.replied":
      return { type: "answered", sessionID: data.sessionID ?? data.form?.sessionID }
    case "session.execution.succeeded":
    case "session.idle":
      return { type: "finished", sessionID: data.sessionID, outcome: "succeeded" }
    case "session.execution.failed":
    case "session.error":
      return { type: "finished", sessionID: data.sessionID, outcome: "failed", message: data.error?.message ?? data.error?.data?.message ?? data.message }
    case "session.execution.interrupted":
      return { type: "finished", sessionID: data.sessionID, outcome: "interrupted" }
  }
  return undefined
}
