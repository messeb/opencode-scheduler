import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { parseJsonc, setPluginEntry } from "../src/infrastructure/system/opencode-config.js"

test("jsonc parsing keeps URLs in strings", () => {
  const value = parseJsonc(`{
    // comment
    "$schema": "https://opencode.ai/config.json", /* block */
    "plugin": ["a",],
  }`)
  assert.deepEqual(value, { $schema: "https://opencode.ai/config.json", plugin: ["a"] })
})

test("add and remove plugin entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-cfg-"))
  const file = path.join(dir, "opencode.jsonc")
  fs.writeFileSync(file, `{\n  // mine\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": ["other"]\n}\n`)
  assert.equal(setPluginEntry(file, "/x/pkg", true), true)
  assert.deepEqual(parseJsonc(fs.readFileSync(file, "utf8")).plugin, ["other", "/x/pkg"])
  assert.ok(fs.existsSync(`${file}.bak`), "commented file is backed up")
  assert.equal(setPluginEntry(file, "/x/pkg", true), false, "idempotent")
  assert.equal(setPluginEntry(file, "/x/pkg", false), true)
  assert.deepEqual(parseJsonc(fs.readFileSync(file, "utf8")).plugin, ["other"])
})
