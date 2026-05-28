import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { installLocalPlugin, renderPluginShim, resolveConfigDir } from "../dist/testing.js"

test("installLocalPlugin writes a project plugin shim", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "opencode-cloakpipe-install-"))
  const packageEntryUrl = "file:///tmp/opencode-cloakpipe/dist/index.js"

  const result = await installLocalPlugin({ cwd, packageEntryUrl })
  const content = await readFile(result.pluginFile, "utf8")

  assert.equal(result.scope, "project")
  assert.equal(result.pluginDir, path.join(cwd, ".opencode", "plugins"))
  assert.equal(result.changed, true)
  assert.equal(content, renderPluginShim(packageEntryUrl))
})

test("installLocalPlugin is idempotent and protects existing shims", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "opencode-cloakpipe-install-"))
  const packageEntryUrl = "file:///tmp/opencode-cloakpipe/dist/index.js"

  const first = await installLocalPlugin({ cwd, packageEntryUrl })
  const second = await installLocalPlugin({ cwd, packageEntryUrl })
  assert.equal(second.changed, false)

  await writeFile(first.pluginFile, "// user file\n", "utf8")
  await assert.rejects(() => installLocalPlugin({ cwd, packageEntryUrl }), /already exists/)

  const replaced = await installLocalPlugin({ cwd, packageEntryUrl, force: true })
  assert.equal(replaced.changed, true)
})

test("resolveConfigDir supports project, global, and custom directories", () => {
  const cwd = "/tmp/example"
  assert.deepEqual(resolveConfigDir(cwd, {}), {
    scope: "project",
    configDir: path.join(cwd, ".opencode"),
  })
  assert.deepEqual(resolveConfigDir(cwd, { global: true }), {
    scope: "global",
    configDir: path.join(os.homedir(), ".config", "opencode"),
  })
  assert.deepEqual(resolveConfigDir(cwd, { configDir: "custom-opencode" }), {
    scope: "custom",
    configDir: path.join(cwd, "custom-opencode"),
  })
})
