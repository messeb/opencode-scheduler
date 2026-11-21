import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { cleanJob } from "../src/domain/job/job.js"
import { previewSchedule } from "../src/domain/schedule/schedule.js"
import { paths } from "../src/infrastructure/persistence/paths.js"
import { fileStore } from "../src/infrastructure/persistence/store.js"
import { findSkills } from "../src/infrastructure/system/catalog.js"

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-manage-"))
  return fileStore(paths({ OPENCODE_SCHEDULER_HOME: dir })).jobs
}

const base = { id: "a", directory: "/tmp/project", schedule: "@daily", skill: "triage" }

test("job repository save creates, edits in place, renames and rejects duplicates", () => {
  const jobs = home()
  jobs.save(base)
  jobs.save({ ...base, id: "b" })
  assert.throws(() => jobs.save(base), /already exists/)

  jobs.save({ ...base, schedule: "every 2h", prompt: "focus" }, "a")
  assert.deepEqual(jobs.load().jobs.map((j) => [j.id, j.schedule]), [["a", "every 2h"], ["b", "@daily"]], "edit keeps position")

  jobs.save({ ...base, id: "a2" }, "a")
  assert.deepEqual(jobs.load().jobs.map((j) => j.id), ["a2", "b"])
  assert.throws(() => jobs.save({ ...base, id: "b" }, "a2"), /already exists/)
  assert.throws(() => jobs.save(base, "missing"), /no job "missing"/)
  assert.throws(() => jobs.save({ ...base, schedule: "every lunch" }, "a2"))
})

test("cleanJob drops empty fields so clearing a field removes it", () => {
  assert.deepEqual(cleanJob({ ...base, prompt: "  ", model: "", timeout: " 2h ", junk: 1 }), { ...base, timeout: "2h" })
})

test("previewSchedule validates without throwing", () => {
  const from = new Date("2026-11-20T10:00:00")
  const ok = previewSchedule("0 9 * * 1-5", 2, from)
  assert.equal(ok.ok, true)
  assert.equal(new Date(ok.next[0]).getDate(), 23, "next weekday after a Friday is Monday")
  assert.equal(previewSchedule("continuous 5m").note, "runs back to back, 300s apart")
  assert.equal(previewSchedule("nonsense").ok, false)
})

test("settings are validated and merged", () => {
  const jobs = home()
  jobs.save(base)
  assert.equal(jobs.saveSettings({ terminal: "iTerm", open: "auto" }).open, "auto")
  assert.throws(() => jobs.saveSettings({ open: "sometimes" }), /invalid value/)
  assert.throws(() => jobs.saveSettings({ evil: 1 }), /unknown setting/)
  const loaded = jobs.load()
  assert.equal(loaded.settings.terminal, "iTerm")
  assert.equal(loaded.jobs.length, 1, "jobs untouched")
})

test("findSkills lists project and global skills with descriptions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-skills-"))
  const repo = path.join(root, "repo")
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true })
  fs.mkdirSync(path.join(repo, ".opencode", "skills", "triage"), { recursive: true })
  fs.writeFileSync(path.join(repo, ".opencode", "skills", "triage", "SKILL.md"), "---\nname: triage\ndescription: Sort new issues\n---\nbody")
  fs.mkdirSync(path.join(root, "home", ".claude", "skills", "release"), { recursive: true })
  fs.writeFileSync(path.join(root, "home", ".claude", "skills", "release", "SKILL.md"), "no front matter")
  fs.mkdirSync(path.join(root, "home", ".claude", "skills", "audit"), { recursive: true })
  fs.writeFileSync(path.join(root, "home", ".claude", "skills", "audit", "SKILL.md"), "---\nname: audit\ndescription: |\n  Checks the\n  build settings\nlicense: MIT\n---\n")
  const saved = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = path.join(root, "config")
  const skills = findSkills(path.join(repo), path.join(root, "home"))
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
  assert.deepEqual(skills.map((s) => [s.id, s.description]), [["audit", "Checks the build settings"], ["release", ""], ["triage", "Sort new issues"]])
})

test("multiple schedules: next run is the earliest of them", async () => {
  const { parseSchedule, nextRun } = await import("../src/domain/schedule/schedule.js")
  const s = parseSchedule("0 9 * * 1,2,3; 0 13 * * 1-5")
  assert.equal(s.kind, "multi")
  const mon = new Date("2026-11-23T08:00:00") // Monday
  assert.equal(nextRun(s, mon).getHours(), 9)
  const thu = new Date("2026-11-26T10:00:00") // Thursday: no 9:00 rule
  assert.deepEqual([nextRun(s, thu).getDate(), nextRun(s, thu).getHours()], [26, 13])
  const fri = new Date("2026-11-27T14:00:00")
  assert.deepEqual([nextRun(s, fri).getDate(), nextRun(s, fri).getHours()], [30, 9], "after Friday 13:00 comes Monday 9:00")
  assert.throws(() => parseSchedule("@daily; continuous"), /continuous/)
})

test("@skill: and @agent: tokens in the prompt", async () => {
  const { promptRefs, buildPrompt } = await import("../src/domain/job/job.js")
  const job = { id: "j", prompt: "Use @skill:triage then @skill:release-notes. Ask @agent:plan first.  Focus on bugs." }
  assert.deepEqual(promptRefs(job), { skills: ["triage", "release-notes"], agent: "plan" })
  const text = buildPrompt(job, 1)
  assert.match(text, /Load the "triage", "release-notes" skills and follow them/)
  assert.match(text, /Use the "triage" skill then the "release-notes" skill\. Ask the "plan" agent first\. Focus on bugs\./)
  assert.doesNotMatch(text, /@agent/)
  assert.match(text, /the "plan" agent/)
  assert.equal(promptRefs({ ...job, agent: "build" }).agent, "build", "explicit agent wins")
})

test("pickDirectory uses the native chooser and handles cancel", async () => {
  const { pickDirectory } = await import("../src/infrastructure/system/directory-picker.js")
  let argv
  const path1 = await pickDirectory({ platform: "darwin", run: async (bin, args) => ((argv = [bin, args]), "/Users/me/app/\n") })
  assert.equal(path1, "/Users/me/app")
  assert.equal(argv[0], "osascript")
  assert.match(argv[1].at(-1), /choose folder/)
  assert.equal(await pickDirectory({ platform: "darwin", run: async () => "\n" }), "")
  await assert.rejects(pickDirectory({ platform: "win32" }), /type the path/)
})
