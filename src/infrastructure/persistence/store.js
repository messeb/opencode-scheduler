// Infrastructure: the file-backed store the application layer works against.
import { acquireLock, lockHolder, releaseLock } from "./leader-lock.js"
import { createJobRepository } from "./job-repository.js"
import { paths as defaultPaths } from "./paths.js"
import { createStateRepository } from "./state-repository.js"
import { createTriggerQueue } from "./trigger-queue.js"

export function fileStore(p = defaultPaths()) {
  return {
    paths: p,
    jobs: createJobRepository(p.jobsFile),
    state: createStateRepository(p.stateFile),
    triggers: createTriggerQueue(p.triggerDir),
    lock: {
      acquire: (pid) => acquireLock(p.lockFile, pid),
      release: (pid) => releaseLock(p.lockFile, pid),
      holder: () => lockHolder(p.lockFile),
    },
  }
}
