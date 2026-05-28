export interface HealthResult {
  readonly ok: boolean
  readonly status?: number
  readonly detail: string
}

export interface PrivacyClientOptions {
  readonly pseudonymizeUrl: string
  readonly rehydrateUrl: string
  readonly healthUrl: string
  readonly timeoutMs: number
  readonly healthTimeoutMs: number
  readonly fetchFn?: typeof fetch
}

export class CloakPipeError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined

  constructor(message: string, options: { readonly status?: number; readonly code?: string; readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "CloakPipeError"
    this.status = options.status
    this.code = options.code
  }
}

export class PrivacyClient {
  readonly pseudonymizeUrl: string
  readonly rehydrateUrl: string
  readonly healthUrl: string
  readonly timeoutMs: number
  readonly healthTimeoutMs: number
  private readonly fetchFn: typeof fetch

  constructor(options: PrivacyClientOptions) {
    this.pseudonymizeUrl = options.pseudonymizeUrl
    this.rehydrateUrl = options.rehydrateUrl
    this.healthUrl = options.healthUrl
    this.timeoutMs = options.timeoutMs
    this.healthTimeoutMs = options.healthTimeoutMs
    this.fetchFn = options.fetchFn ?? globalThis.fetch
  }

  async pseudonymizeText(text: string): Promise<string> {
    if (!text) return text
    const data = await this.postText(this.pseudonymizeUrl, text)
    return extractTextResponse(data, ["text", "result", "output", "pseudonymized"])
  }

  async rehydrateText(text: string): Promise<string> {
    if (!text) return text
    const data = await this.postText(this.rehydrateUrl, text)
    return extractTextResponse(data, ["text", "result", "output", "rehydrated"])
  }

  async health(): Promise<HealthResult> {
    try {
      const response = await fetchWithTimeout(
        this.fetchFn,
        this.healthUrl,
        {
          method: "GET",
          headers: { accept: "application/json" },
        },
        this.healthTimeoutMs,
      )
      if (!response.ok) {
        return { ok: false, status: response.status, detail: `HTTP ${response.status}` }
      }
      return { ok: true, status: response.status, detail: "ok" }
    } catch (error) {
      return { ok: false, detail: safeErrorDetail(error) }
    }
  }

  private async postText(url: string, text: string): Promise<unknown> {
    let response: Response
    try {
      response = await fetchWithTimeout(
        this.fetchFn,
        url,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ text }),
        },
        this.timeoutMs,
      )
    } catch (error) {
      throw new CloakPipeError("CloakPipe request failed", { code: "request_failed", cause: error })
    }

    if (!response.ok) {
      throw new CloakPipeError("CloakPipe returned an error response", {
        status: response.status,
        code: "http_error",
      })
    }

    try {
      return await response.json()
    } catch (error) {
      throw new CloakPipeError("CloakPipe returned invalid JSON", { code: "invalid_json", cause: error })
    }
  }
}

export function extractTextResponse(data: unknown, fields: readonly string[]): string {
  if (!data || typeof data !== "object") {
    throw new CloakPipeError("CloakPipe response was not an object", { code: "invalid_response" })
  }
  const record = data as Record<string, unknown>
  for (const field of fields) {
    const value = record[field]
    if (typeof value === "string") return value
  }
  throw new CloakPipeError("CloakPipe response did not include transformed text", { code: "missing_text" })
}

export function safeErrorDetail(error: unknown): string {
  if (error instanceof CloakPipeError) {
    if (error.status !== undefined) return `${error.code ?? "cloakpipe_error"}: HTTP ${error.status}`
    return error.code ?? "cloakpipe_error"
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout"
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "timeout"
  }
  return "request_failed"
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CloakPipeError("CloakPipe request timed out", { code: "timeout", cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
