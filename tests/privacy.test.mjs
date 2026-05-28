import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"

import { PrivacyClient, extractTextResponse } from "../dist/testing.js"

test("PrivacyClient calls CloakPipe endpoints", async (t) => {
  const { server, baseUrl, requests } = await startFakeCloakPipe()
  t.after(() => server.close())

  const client = new PrivacyClient({
    pseudonymizeUrl: `${baseUrl}/pseudonymize`,
    rehydrateUrl: `${baseUrl}/rehydrate`,
    healthUrl: baseUrl.replace(/\/v1$/, "/health"),
    timeoutMs: 1_000,
    healthTimeoutMs: 1_000,
  })

  assert.deepEqual(await client.health(), { ok: true, status: 200, detail: "ok" })
  assert.equal(await client.pseudonymizeText("secret-token"), "__CP_TOKEN__")
  assert.equal(await client.rehydrateText("__CP_TOKEN__"), "secret-token")
  assert.deepEqual(requests.map((request) => request.path), ["/health", "/v1/pseudonymize", "/v1/rehydrate"])
})

test("extractTextResponse accepts CloakPipe-compatible field names", () => {
  assert.equal(extractTextResponse({ text: "a" }, ["text"]), "a")
  assert.equal(extractTextResponse({ result: "b" }, ["text", "result"]), "b")
  assert.equal(extractTextResponse({ output: "c" }, ["text", "output"]), "c")
  assert.throws(() => extractTextResponse({ value: "x" }, ["text"]), /transformed text/)
})

async function startFakeCloakPipe() {
  const requests = []
  const server = createServer(async (req, res) => {
    const body = await readBody(req)
    requests.push({ method: req.method, path: req.url, body })

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { status: "ok" })
      return
    }

    if (req.method === "POST" && req.url === "/v1/pseudonymize") {
      sendJson(res, 200, { pseudonymized: body.text.replaceAll("secret-token", "__CP_TOKEN__") })
      return
    }

    if (req.method === "POST" && req.url === "/v1/rehydrate") {
      sendJson(res, 200, { rehydrated: body.text.replaceAll("__CP_TOKEN__", "secret-token") })
      return
    }

    sendJson(res, 404, { error: "not found" })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, requests }
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
