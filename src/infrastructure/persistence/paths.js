// Infrastructure: where the scheduler keeps its files.
import os from "node:os"
import path from "node:path"

export function paths(env = process.env) {
  const root = env.OPENCODE_SCHEDULER_HOME
  const configDir = root ?? path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode", "scheduler")
  const stateDir = root ?? path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode-scheduler")
  return {
    configDir,
    stateDir,
    jobsFile: path.join(configDir, "jobs.json"),
    stateFile: path.join(stateDir, "state.json"),
    triggerDir: path.join(stateDir, "triggers"),
    lockFile: path.join(stateDir, "lock.json"),
    logFile: path.join(stateDir, "scheduler.log"),
  }
}
