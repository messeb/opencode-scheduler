#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createJobService } from "../src/application/job-service.js"
import { upcoming } from "../src/domain/schedule/schedule.js"
import { fileStore } from "../src/infrastructure/persistence/store.js"
import { createNotifier } from "../src/infrastructure/system/notifier.js"
import { setPluginEntry } from "../src/infrastructure/system/opencode-config.js"
import { attachCommand, onPath, openTerminal } from "../src/infrastructure/system/terminal.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
// Installed from npm: opencode resolves the package by name. A checkout: it loads the folder.
const PLUGIN_SPEC = ROOT.split(path.sep).includes("node_modules") ? PACKAGE.name : ROOT
const store = fileStore()
const service = createJobService({ store })
const OPENCODE_CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
const LEGACY_SHIM = path.join(OPENCODE_CONFIG_DIR, "plugins", "opencode-scheduler.js")
const LAUNCHD_LABEL = "dev.opencode-scheduler.wake"
const LAUNCHD_PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)

const HELP = `opencode-scheduler — run opencode skills on a schedule, autonomously

Jobs
  add <id> --schedule <spec> [--skill s] [--prompt text] [--command c] [--dir path]
           [--agent a] [--model provider/model] [--session new|reuse]
           [--permissions ask|auto] [--open click|auto|never] [--timeout 2h] [--disabled]
  list | status                 jobs, next/last run, active sessions
  remove <id>
  enable <id> | disable <id>
  run <id>                      start now (picked up by the scheduler within one tick)
  next <spec> [count]           preview a schedule

Sessions
  attach <id|ses_...>           open the job's latest session in this terminal
  open <id|ses_...>             open it in a new terminal window
  logs [-f]                     scheduler log

Setup
  install [--launchd]           add the plugin to your global opencode config
                                (+ keep the service awake via launchd on macOS)
  uninstall
  wake                          make sure the opencode service runs and the plugin is loaded
  notify-test [--open]          send a test notification (and open a test terminal)

Schedules: "0 9 * * 1-5", "@hourly", "every 30m", "at 2026-11-21 09:00", "continuous 5m"`

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2)
      if (inline !== undefined) flags[key] = inline
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[key] = argv[++i]
      else flags[key] = true
    } else if (arg === "-f") flags.follow = true
    else positional.push(arg)
  }
  return { positional, flags }
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

function opencodeBin() {
  for (const candidate of [path.join(os.homedir(), ".opencode", "bin", "opencode")]) if (fs.existsSync(candidate)) return candidate
  return "opencode"
}

function resolveSession(ref) {
  const p = store.paths
  if (!ref) fail("missing job id or session id")
  const { jobs } = store.jobs.load()
  if (ref.startsWith("ses_")) {
    const state = store.state.load()
    const run = state.active.find((r) => r.sessionID === ref)
    const job = jobs.find((j) => j.id === run?.jobId)
    return { sessionID: ref, directory: job?.directory ?? process.cwd() }
  }
  const job = jobs.find((j) => j.id === ref)
  if (!job) fail(`no job "${ref}"`)
  const state = store.state.load()
  const active = state.active.find((r) => r.jobId === ref)
  const sessionID = active?.sessionID ?? state.jobs[ref]?.lastSessionID
  if (!sessionID) fail(`job "${ref}" has not run yet`)
  return { sessionID, directory: job.directory }
}

function printStatus() {
  const p = store.paths
  const { jobs, errors, settings } = store.jobs.load()
  const state = store.state.load()
  const leader = store.lock.holder()
  console.log(`scheduler: ${leader ? `running (pid ${leader.pid}, since ${leader.since})` : "not running — start opencode or run `opencode-scheduler wake`"}`)
  console.log(`jobs file: ${p.jobsFile}`)
  console.log(`terminal:  ${settings.terminal}, open on question: ${settings.open}\n`)
  if (jobs.length === 0) console.log("no jobs yet — add one with `opencode-scheduler add`")
  for (const job of jobs) {
    const st = state.jobs[job.id] ?? {}
    const active = state.active.find((r) => r.jobId === job.id)
    console.log(`${job.enabled ? "●" : "○"} ${job.id}  ${job.schedule}`)
    console.log(`    ${[job.skill && `skill=${job.skill}`, job.command && `command=/${job.command}`, job.prompt && "prompt=…"].filter(Boolean).join(" ")}  dir=${job.directory}`)
    console.log(`    next: ${st.nextRunAt ? new Date(st.nextRunAt).toLocaleString() : "-"}   last: ${st.lastRunAt ? new Date(st.lastRunAt).toLocaleString() : "-"} ${st.lastStatus ? `(${st.lastStatus})` : ""}   runs: ${st.runs ?? 0}`)
    if (st.lastError) console.log(`    error: ${st.lastError}`)
    if (active) console.log(`    ACTIVE ${active.status.toUpperCase()}: ${active.sessionID}   → opencode-scheduler attach ${job.id}`)
  }
  for (const error of errors) console.log(`! ${error}`)
}

function launchdPlist() {
  const node = process.execPath
  const cli = path.join(ROOT, "bin", "cli.js")
  const envPath = [path.dirname(opencodeBin()), path.dirname(node), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${node}</string><string>${cli}</string><string>wake</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${envPath}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>${path.join(store.paths.stateDir, "wake.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(store.paths.stateDir, "wake.log")}</string>
</dict>
</plist>
`
}

function globalConfigFile() {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const file = path.join(OPENCODE_CONFIG_DIR, name)
    if (fs.existsSync(file)) return file
  }
  return path.join(OPENCODE_CONFIG_DIR, "opencode.jsonc")
}

function wake() {
  const bin = opencodeBin()
  const status = spawnSync(bin, ["service", "status"], { encoding: "utf8" })
  if (status.status !== 0 || !/http/.test(status.stdout)) {
    console.log("starting opencode service")
    spawnSync(bin, ["service", "start"], { stdio: "inherit" })
  }
  const { jobs } = store.jobs.load()
  const dirs = [...new Set(jobs.filter((j) => j.enabled).map((j) => j.directory))]
  // Any request for a directory boots its location, which loads the plugin (one scheduler per process).
  for (const dir of dirs.slice(0, 1)) {
    if (!fs.existsSync(dir)) continue
    const r = spawnSync(bin, ["session", "list"], { cwd: dir, encoding: "utf8", timeout: 60_000 })
    console.log(`${new Date().toISOString()} woke ${dir} (exit ${r.status})`)
  }
  const leader = store.lock.holder()
  console.log(leader ? `scheduler running (pid ${leader.pid})` : dirs.length ? "scheduler not running yet" : "no enabled jobs")
}

const { positional, flags } = parseArgs(process.argv.slice(2))
const [command, ...rest] = positional

try {
  switch (command) {
    case "add": {
      const id = rest[0] ?? flags.id
      if (!flags.schedule) fail("--schedule is required")
      const job = service.upsert({
        id,
        schedule: flags.schedule,
        directory: path.resolve(flags.dir ?? process.cwd()),
        ...(flags.skill && { skill: flags.skill }),
        ...(flags.prompt && { prompt: flags.prompt }),
        ...(flags.command && { command: String(flags.command).replace(/^\//, "") }),
        ...(flags.agent && { agent: flags.agent }),
        ...(flags.model && { model: flags.model }),
        ...(flags.session && { session: flags.session }),
        ...(flags.permissions && { permissions: flags.permissions }),
        ...(flags.open && { open: flags.open }),
        ...(flags.timeout && { timeout: flags.timeout }),
        enabled: !flags.disabled,
      })
      console.log(`saved job "${job.id}"`)
      for (const d of upcoming(job.schedule, 3)) console.log(`  next: ${d.toLocaleString()}`)
      if (!store.lock.holder()) console.log("note: the scheduler is not running. Run `opencode-scheduler install` (once) and `opencode-scheduler wake`.")
      break
    }
    case "list":
    case "status":
      printStatus()
      break
    case "remove":
      service.remove(rest[0])
      console.log(`removed "${rest[0]}"`)
      break
    case "enable":
    case "disable":
      service.setEnabled(rest[0], command === "enable")
      console.log(`${command}d "${rest[0]}"`)
      break
    case "run":
      if (!store.jobs.load().jobs.some((j) => j.id === rest[0])) fail(`no job "${rest[0]}"`)
      store.triggers.request(rest[0])
      console.log(`queued "${rest[0]}"${store.lock.holder() ? "" : " (scheduler not running — run `opencode-scheduler wake`)"}`)
      break
    case "next": {
      const dates = upcoming(rest[0], Number(rest[1] ?? 5))
      if (dates.length === 0) console.log("no fixed run times (continuous or in the past)")
      for (const d of dates) console.log(d.toLocaleString())
      break
    }
    case "attach": {
      const { sessionID, directory } = resolveSession(rest[0])
      const settings = store.jobs.load().settings
      const args = [...(settings.attachServer ? ["--server", settings.attachServer] : []), "--session", sessionID]
      const child = spawn(opencodeBin(), args, { cwd: directory, stdio: "inherit" })
      child.on("exit", (code) => process.exit(code ?? 0))
      break
    }
    case "open": {
      const { sessionID, directory } = resolveSession(rest[0])
      const settings = store.jobs.load().settings
      openTerminal(attachCommand({ sessionID, directory, server: settings.attachServer || undefined, bin: opencodeBin() }), { terminal: settings.terminal })
      console.log(`opened ${sessionID}`)
      break
    }
    case "logs": {
      const file = store.paths.logFile
      if (!fs.existsSync(file)) fail(`no log yet at ${file}`)
      spawn("tail", flags.follow ? ["-n", "50", "-f", file] : ["-n", "50", file], { stdio: "inherit" })
      break
    }
    case "install": {
      const configFile = globalConfigFile()
      const changed = setPluginEntry(configFile, PLUGIN_SPEC, true)
      fs.rmSync(LEGACY_SHIM, { force: true })
      console.log(`${changed ? "added" : "already in"} ${configFile}: "plugin": [..., ${JSON.stringify(PLUGIN_SPEC)}]`)
      if (!fs.existsSync(path.join(ROOT, "dist", "gui-experimental.cjs"))) {
        console.log("note: desktop GUI bundle missing — run `npm run build:gui` in the plugin folder for the Schedules tab")
      }
      if (flags.launchd) {
        if (process.platform !== "darwin") fail("--launchd is macOS only; use a systemd user timer running `opencode-scheduler wake`")
        fs.mkdirSync(path.dirname(LAUNCHD_PLIST), { recursive: true })
        fs.writeFileSync(LAUNCHD_PLIST, launchdPlist())
        spawnSync("launchctl", ["unload", LAUNCHD_PLIST], { stdio: "ignore" })
        spawnSync("launchctl", ["load", LAUNCHD_PLIST], { stdio: "inherit" })
        console.log(`launchd agent loaded: ${LAUNCHD_PLIST} (runs \`wake\` every 5 minutes)`)
      }
      if (process.platform === "darwin" && !onPath("terminal-notifier")) {
        console.log("tip: notifications come from the OpenCode app while it runs; otherwise `brew install terminal-notifier` makes them clickable (without it: a banner plus an \"Open session\" dialog).")
      }
      console.log("load it: opencode service restart   (the desktop app shows a Schedules tab after it reconnects)")
      break
    }
    case "uninstall": {
      const configFile = globalConfigFile()
      setPluginEntry(configFile, ROOT, false)
      setPluginEntry(configFile, PACKAGE.name, false)
      fs.rmSync(LEGACY_SHIM, { force: true })
      if (fs.existsSync(LAUNCHD_PLIST)) {
        spawnSync("launchctl", ["unload", LAUNCHD_PLIST], { stdio: "ignore" })
        fs.rmSync(LAUNCHD_PLIST, { force: true })
      }
      console.log(`removed the plugin from ${configFile} and the launchd agent (jobs file kept)`)
      break
    }
    case "wake":
      wake()
      break
    case "notify-test": {
      const settings = store.jobs.load().settings
      const notifier = createNotifier({
        getSettings: () => settings,
        terminal: (_cmd, options) => openTerminal(`echo "opencode-scheduler: terminal launch works"; exec "$SHELL" -l`, options),
      })
      notifier.notify({
        title: "opencode · notify-test",
        subtitle: "Needs your answer",
        message: "This is what a question from a scheduled run looks like.",
        sessionID: "notify-test",
        directory: os.homedir(),
        open: flags.open ? "auto" : "click",
      })
      console.log("notification sent")
      break
    }
    default:
      console.log(HELP)
      if (command && command !== "help") process.exit(1)
  }
} catch (error) {
  fail(error.message)
}
