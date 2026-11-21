import assert from "node:assert/strict"
import test from "node:test"
import { changelogSection, versionFromRef } from "../scripts/release.mjs"

test("release: version from branch, tag and ref names", () => {
  assert.equal(versionFromRef("release/1.2.3"), "1.2.3")
  assert.equal(versionFromRef("refs/heads/release/1.2.3"), "1.2.3")
  assert.equal(versionFromRef("refs/tags/1.2.3"), "1.2.3")
  assert.equal(versionFromRef("1.2.3"), "1.2.3")
  assert.throws(() => versionFromRef("release/1.2"), /x\.y\.z/)
  assert.throws(() => versionFromRef("v1.2.3"), /x\.y\.z/)
})

test("release: notes are the CHANGELOG section of that version", () => {
  const changelog = "# Changelog\n\n## 1.1.0 — 2026-12-01\n\n- new\n\n## 1.0.0 — unreleased\n\n- first\n"
  assert.equal(changelogSection(changelog, "1.1.0"), "- new")
  assert.equal(changelogSection(changelog, "1.0.0"), "- first")
  assert.equal(changelogSection(changelog, "2.0.0"), undefined)
})
