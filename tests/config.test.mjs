import assert from "node:assert/strict"
import test from "node:test"

import { DEFAULT_SKIP_KEYS, deriveHealthUrl, deriveServiceUrls, loadConfig, normalizeBaseUrl } from "../dist/testing.js"

test("normalizes CloakPipe URLs and derives service endpoints", () => {
  assert.equal(normalizeBaseUrl("127.0.0.1:3100/v1/"), "http://127.0.0.1:3100/v1")
  assert.deepEqual(deriveServiceUrls("http://127.0.0.1:3100/v1/"), {
    baseUrl: "http://127.0.0.1:3100/v1",
    pseudonymizeUrl: "http://127.0.0.1:3100/v1/pseudonymize",
    rehydrateUrl: "http://127.0.0.1:3100/v1/rehydrate",
    healthUrl: "http://127.0.0.1:3100/health",
  })
  assert.equal(deriveHealthUrl("http://127.0.0.1:3100/private/v1"), "http://127.0.0.1:3100/private/health")
})

test("plugin options override env vars", () => {
  const config = loadConfig(
    {
      baseUrl: "http://options.example.test:1234/v1",
      strict: true,
      timeoutMs: 42,
      transformToolDefinitions: true,
    },
    {
      OPENCODE_CLOAKPIPE_BASE_URL: "http://env.example.test:9999/v1",
      OPENCODE_CLOAKPIPE_STRICT: "0",
      OPENCODE_CLOAKPIPE_TIMEOUT_MS: "1000",
      OPENCODE_CLOAKPIPE_TRANSFORM_TOOL_DEFINITIONS: "0",
    },
  )

  assert.equal(config.baseUrl, "http://options.example.test:1234/v1")
  assert.equal(config.strict, true)
  assert.equal(config.timeoutMs, 42)
  assert.equal(config.transformToolDefinitions, true)
})

test("env vars fill defaults when options are absent", () => {
  const config = loadConfig(
    {},
    {
      CLOAKPIPE_BASE_URL: "localhost:3101/v1",
      OPENCODE_CLOAKPIPE_STRICT: "off",
      OPENCODE_CLOAKPIPE_RESTORE_TOOL_ARGS: "no",
      OPENCODE_CLOAKPIPE_EXTRA_SKIP_KEYS: "privatePayload, rawBytes",
    },
  )

  assert.equal(config.baseUrl, "http://localhost:3101/v1")
  assert.equal(config.strict, false)
  assert.equal(config.restoreToolArgs, false)
  assert.equal(config.skipKeys.has("privatePayload"), true)
  assert.equal(config.skipKeys.has("rawBytes"), true)
})

test("default skip keys include structural and binary fields", () => {
  for (const key of ["id", "sessionID", "type", "role", "status", "url", "data", "signature"]) {
    assert.equal(DEFAULT_SKIP_KEYS.has(key), true)
  }
})
