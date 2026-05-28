import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"

import { OpencodeCloakPipe } from "../dist/index.js"

test("plugin masks provider-bound context and restores local content", async (t) => {
  const { server, baseUrl } = await startFakeCloakPipe()
  t.after(() => server.close())

  const hooks = await OpencodeCloakPipe(makeContext(), {
    baseUrl,
    strict: true,
    healthTimeoutMs: 1_000,
    timeoutMs: 1_000,
    transformSystem: true,
  })

  const messagesOutput = {
    messages: [
      {
        info: { sessionID: "session-1" },
        parts: [
          { type: "text", text: "send secret-token to alice@example.com" },
          { type: "tool", state: { status: "completed", input: { command: "echo secret-token" }, output: "saw secret-token" } },
        ],
      },
    ],
  }

  await hooks["experimental.chat.messages.transform"]?.({}, messagesOutput)
  assert.equal(messagesOutput.messages[0].parts[0].text, "send __CP_TOKEN__ to __CP_EMAIL__")
  assert.equal(messagesOutput.messages[0].parts[1].state.input.command, "echo __CP_TOKEN__")
  assert.equal(messagesOutput.messages[0].parts[1].state.output, "saw __CP_TOKEN__")

  const systemOutput = { system: ["System knows secret-token"] }
  await hooks["experimental.chat.system.transform"]?.({}, systemOutput)
  assert.deepEqual(systemOutput.system, ["System knows __CP_TOKEN__"])

  const textOutput = { text: "Assistant mentions __CP_TOKEN__ and __CP_EMAIL__" }
  await hooks["experimental.text.complete"]?.({ sessionID: "session-1", messageID: "m", partID: "p" }, textOutput)
  assert.equal(textOutput.text, "Assistant mentions secret-token and alice@example.com")

  const toolOutput = { args: { command: "echo __CP_TOKEN__", nested: { email: "__CP_EMAIL__" } } }
  await hooks["tool.execute.before"]?.({ tool: "bash", sessionID: "session-1", callID: "call-1" }, toolOutput)
  assert.deepEqual(toolOutput.args, { command: "echo secret-token", nested: { email: "alice@example.com" } })
})

test("strict mode throws when CloakPipe is unavailable", async () => {
  const hooks = await OpencodeCloakPipe(makeContext(), {
    baseUrl: "http://127.0.0.1:1/v1",
    strict: true,
    healthTimeoutMs: 50,
    timeoutMs: 50,
  })

  await assert.rejects(
    () => hooks["experimental.chat.system.transform"]?.({}, { system: ["secret-token"] }),
    /CloakPipe is unavailable/,
  )
})

function makeContext() {
  return {
    directory: process.cwd(),
    worktree: process.cwd(),
    project: {},
    serverUrl: new URL("http://127.0.0.1:4096"),
    client: { app: { async log() {} } },
    $: undefined,
    experimental_workspace: { register() {} },
  }
}

async function startFakeCloakPipe() {
  const server = createServer(async (req, res) => {
    const body = await readBody(req)

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { status: "ok" })
      return
    }

    if (req.method === "POST" && req.url === "/v1/pseudonymize") {
      sendJson(res, 200, { text: pseudonymize(body.text) })
      return
    }

    if (req.method === "POST" && req.url === "/v1/rehydrate") {
      sendJson(res, 200, { text: rehydrate(body.text) })
      return
    }

    sendJson(res, 404, { error: "not found" })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` }
}

function pseudonymize(text) {
  return String(text).replaceAll("secret-token", "__CP_TOKEN__").replaceAll("alice@example.com", "__CP_EMAIL__")
}

function rehydrate(text) {
  return String(text).replaceAll("__CP_TOKEN__", "secret-token").replaceAll("__CP_EMAIL__", "alice@example.com")
}

async function readBody(req) {
  let raw = ""
  req.setEncoding("utf8")
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}
