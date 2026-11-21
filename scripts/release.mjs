#!/usr/bin/env node
// Release helper for the CI pipelines.
//   node scripts/release.mjs version <ref>   x.y.z from "release/x.y.z", "x.y.z" or "refs/tags/x.y.z"; fails unless it matches package.json
//   node scripts/release.mjs notes <x.y.z>   the CHANGELOG section for that version (release notes)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

export function versionFromRef(ref) {
  const version = String(ref ?? "").replace(/^refs\/(heads|tags)\//, "").replace(/^release\//, "")
  if (!SEMVER.test(version)) throw new Error(`"${ref}" does not name a version x.y.z`)
  return version
}

export function changelogSection(changelog, version) {
  const lines = changelog.split("\n")
  const start = lines.findIndex((line) => line.startsWith("## ") && line.slice(3).split(/\s/)[0] === version)
  if (start === -1) return undefined
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "))
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim()
}

function main([command, arg]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
  if (command === "version") {
    let version
    try {
      version = versionFromRef(arg)
    } catch (error) {
      fail(error.message)
    }
    if (pkg.version !== version) fail(`package.json has version ${pkg.version}, the ref says ${version}. Bump package.json first.`)
    console.log(version)
  } else if (command === "notes") {
    const notes = changelogSection(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), arg)
    if (!notes) fail(`CHANGELOG.md has no "## ${arg}" section`)
    console.log(notes)
  } else {
    fail("usage: release.mjs version <ref> | notes <x.y.z>")
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
