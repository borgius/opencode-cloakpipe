import type { Config } from "./config.js"

export type LogLevel = "debug" | "info" | "warn" | "error"

type LogClient = {
  app?: {
    log?: (input: {
      body: {
        service: string
        level: LogLevel
        message: string
        extra?: Record<string, unknown>
      }
    }) => Promise<unknown>
  }
}

export async function logSafe(
  client: unknown,
  config: Pick<Config, "debug">,
  level: LogLevel,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const safeExtra = sanitizeRecord(extra)
  const logClient = client as LogClient
  const body: {
    service: string
    level: LogLevel
    message: string
    extra?: Record<string, unknown>
  } = {
    service: "opencode-cloakpipe",
    level,
    message,
  }
  if (Object.keys(safeExtra).length > 0) {
    body.extra = safeExtra
  }

  try {
    if (typeof logClient.app?.log === "function") {
      await logClient.app.log({ body })
      return
    }
  } catch {
    // Logging must never break privacy hooks.
  }

  if (config.debug || level === "warn" || level === "error") {
    const payload = Object.keys(safeExtra).length > 0 ? ` ${JSON.stringify(safeExtra)}` : ""
    const line = `[opencode-cloakpipe] ${level}: ${message}${payload}`
    if (level === "error") console.error(line)
    else if (level === "warn") console.warn(line)
    else console.log(line)
  }
}

export async function debugSafe(
  client: unknown,
  config: Pick<Config, "debug">,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!config.debug) return
  await logSafe(client, config, "debug", message, extra)
}

function sanitizeRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const safe = sanitizeValue(value, 0)
    if (safe !== undefined) output[key] = safe
  }
  return output
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null) return null
  if (typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return sanitizeString(value)
  if (depth >= 2) return undefined
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined)
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const safe = sanitizeValue(nested, depth + 1)
      if (safe !== undefined) output[key] = safe
    }
    return output
  }
  return undefined
}

function sanitizeString(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 240)
}
