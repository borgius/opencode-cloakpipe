import assert from "node:assert/strict"
import test from "node:test"

import { loadConfig, pseudonymizeMessages, pseudonymizeSystem, rehydrateDeep, transformStringLeaves } from "../dist/testing.js"

const client = {
  async pseudonymizeText(text) {
    return text.replaceAll("secret-token", "__CP_TOKEN__").replaceAll("alice@example.com", "__CP_EMAIL__")
  },
  async rehydrateText(text) {
    return text.replaceAll("__CP_TOKEN__", "secret-token").replaceAll("__CP_EMAIL__", "alice@example.com")
  },
}

test("pseudonymizeMessages masks text and historical tool state", async () => {
  const config = loadConfig({}, {})
  const messages = [
    {
      info: { sessionID: "session-1" },
      parts: [
        { type: "text", text: "mail alice@example.com with secret-token", id: "part-id" },
        { type: "text", text: "ignored secret-token", ignored: true },
        {
          type: "tool",
          state: {
            status: "completed",
            input: { command: "echo secret-token", data: "secret-token" },
            output: "read secret-token",
            error: "",
          },
        },
      ],
    },
  ]

  const report = await pseudonymizeMessages(messages, client, config)

  assert.equal(messages[0].parts[0].text, "mail __CP_EMAIL__ with __CP_TOKEN__")
  assert.equal(messages[0].parts[0].id, "part-id")
  assert.equal(messages[0].parts[1].text, "ignored secret-token")
  assert.equal(messages[0].parts[2].state.input.command, "echo __CP_TOKEN__")
  assert.equal(messages[0].parts[2].state.input.data, "secret-token")
  assert.equal(messages[0].parts[2].state.status, "completed")
  assert.equal(messages[0].parts[2].state.output, "read __CP_TOKEN__")
  assert.equal(report.changedStrings, 3)
})

test("pseudonymizeSystem masks each system string", async () => {
  const system = ["Use secret-token", "Contact alice@example.com"]
  const report = await pseudonymizeSystem(system, client)
  assert.deepEqual(system, ["Use __CP_TOKEN__", "Contact __CP_EMAIL__"])
  assert.equal(report.changedStrings, 2)
})

test("rehydrateDeep restores nested tool args and respects skip keys", async () => {
  const config = loadConfig({}, {})
  const args = {
    command: "echo __CP_TOKEN__",
    nested: ["mail __CP_EMAIL__"],
    data: "__CP_TOKEN__",
  }

  const report = await rehydrateDeep(args, client, config)

  assert.equal(args.command, "echo secret-token")
  assert.deepEqual(args.nested, ["mail alice@example.com"])
  assert.equal(args.data, "__CP_TOKEN__")
  assert.equal(report.changedStrings, 2)
})

test("transformStringLeaves handles cycles and skips non-plain objects", async () => {
  class Box {
    value = "secret-token"
  }

  const object = {
    value: "secret-token",
    nested: { value: "secret-token" },
    box: new Box(),
  }
  object.self = object

  await transformStringLeaves(object, async (text) => text.replaceAll("secret-token", "masked"))

  assert.equal(object.value, "masked")
  assert.equal(object.nested.value, "masked")
  assert.equal(object.box.value, "secret-token")
  assert.equal(object.self, object)
})
