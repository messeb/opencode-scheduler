// Infrastructure: run state (per-job records, active runs, history, current leader).
import { readJson, writeJson } from "./json-file.js"

export function createStateRepository(file) {
  return {
    load() {
      const state = readJson(file, {})
      return { jobs: state.jobs ?? {}, active: state.active ?? [], history: state.history ?? [], leader: state.leader }
    },
    save: (state) => writeJson(file, state),
  }
}
