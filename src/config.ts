export type PluginOptions = Record<string, unknown>

export interface Config {
  readonly enabled: boolean
  readonly baseUrl: string
  readonly pseudonymizeUrl: string
  readonly rehydrateUrl: string
  readonly healthUrl: string
  readonly strict: boolean
  readonly timeoutMs: number
  readonly healthTimeoutMs: number
  readonly debug: boolean
  readonly transformSystem: boolean
  readonly restoreAssistantText: boolean
  readonly restoreToolArgs: boolean
  readonly transformToolDefinitions: boolean
  readonly skipKeys: ReadonlySet<string>
}

export const DEFAULT_BASE_URL = "http://127.0.0.1:3100/v1"
export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_HEALTH_TIMEOUT_MS = 3_000

export const DEFAULT_SKIP_KEYS = new Set([
  "id",
  "sessionID",
  "sessionId",
  "messageID",
  "messageId",
  "partID",
  "partId",
  "toolCallID",
  "toolCallId",
  "tool_use_id",
  "callID",
  "callId",
  "type",
  "role",
  "model",
  "providerID",
  "providerId",
  "name",
  "status",
  "agent",
  "kind",
  "mime",
  "mediaType",
  "media_type",
  "url",
  "uri",
  "fileID",
  "fileId",
  "file_id",
  "data",
  "bytes",
  "base64",
  "signature",
  "hash",
  "checksum",
  "encrypted_content",
  "encryptedContent",
  "cache_control",
  "cacheControl",
])

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"])
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"])

export function loadConfig(
  options: unknown = {},
  env: NodeJS.ProcessEnv = process.env,
  _cwd: string = process.cwd(),
): Config {
  const pluginOptions = asOptions(options)
  const urls = deriveServiceUrls(
    pickString(pluginOptions, "baseUrl") ??
      pickEnvString(env, "OPENCODE_CLOAKPIPE_BASE_URL") ??
      pickEnvString(env, "CLOAKPIPE_BASE_URL") ??
      DEFAULT_BASE_URL,
  )

  const skipKeys = new Set(DEFAULT_SKIP_KEYS)
  for (const key of parseStringList(pickEnvString(env, "OPENCODE_CLOAKPIPE_EXTRA_SKIP_KEYS"))) {
    skipKeys.add(key)
  }
  for (const key of parseStringList(pluginOptions.extraSkipKeys)) {
    skipKeys.add(key)
  }
  for (const key of parseStringList(pluginOptions.skipKeys)) {
    skipKeys.add(key)
  }

  return {
    enabled: pickBoolean(pluginOptions, "enabled", env, "OPENCODE_CLOAKPIPE_ENABLED", true),
    ...urls,
    strict: pickBoolean(pluginOptions, "strict", env, "OPENCODE_CLOAKPIPE_STRICT", true),
    timeoutMs: pickPositiveInteger(
      pluginOptions,
      "timeoutMs",
      env,
      "OPENCODE_CLOAKPIPE_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
    ),
    healthTimeoutMs: pickPositiveInteger(
      pluginOptions,
      "healthTimeoutMs",
      env,
      "OPENCODE_CLOAKPIPE_HEALTH_TIMEOUT_MS",
      DEFAULT_HEALTH_TIMEOUT_MS,
    ),
    debug: pickBoolean(pluginOptions, "debug", env, "OPENCODE_CLOAKPIPE_DEBUG", false),
    transformSystem: pickBoolean(
      pluginOptions,
      "transformSystem",
      env,
      "OPENCODE_CLOAKPIPE_TRANSFORM_SYSTEM",
      true,
    ),
    restoreAssistantText: pickBoolean(
      pluginOptions,
      "restoreAssistantText",
      env,
      "OPENCODE_CLOAKPIPE_RESTORE_ASSISTANT_TEXT",
      true,
    ),
    restoreToolArgs: pickBoolean(
      pluginOptions,
      "restoreToolArgs",
      env,
      "OPENCODE_CLOAKPIPE_RESTORE_TOOL_ARGS",
      true,
    ),
    transformToolDefinitions: pickBoolean(
      pluginOptions,
      "transformToolDefinitions",
      env,
      "OPENCODE_CLOAKPIPE_TRANSFORM_TOOL_DEFINITIONS",
      false,
    ),
    skipKeys,
  }
}

export function deriveServiceUrls(input: string): Pick<
  Config,
  "baseUrl" | "pseudonymizeUrl" | "rehydrateUrl" | "healthUrl"
> {
  const baseUrl = normalizeBaseUrl(input)
  return {
    baseUrl,
    pseudonymizeUrl: joinUrl(baseUrl, "pseudonymize"),
    rehydrateUrl: joinUrl(baseUrl, "rehydrate"),
    healthUrl: deriveHealthUrl(baseUrl),
  }
}

export function normalizeBaseUrl(input: string): string {
  let raw = String(input ?? "").trim()
  if (!raw) {
    throw new Error("CloakPipe base URL is empty")
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    raw = `http://${raw}`
  }
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported CloakPipe URL protocol: ${url.protocol}`)
  }
  url.hash = ""
  url.search = ""
  url.pathname = trimTrailingSlashes(url.pathname)
  return trimTrailingSlashes(url.toString())
}

export function deriveHealthUrl(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl))
  let pathname = trimTrailingSlashes(url.pathname)
  if (pathname === "/v1") {
    pathname = ""
  } else if (pathname.endsWith("/v1")) {
    pathname = pathname.slice(0, -3)
  }
  url.pathname = `${trimTrailingSlashes(pathname)}/health`
  return trimTrailingSlashes(url.toString())
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value !== "string") return fallback
  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

export function parsePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed)
  }
  return fallback
}

function asOptions(value: unknown): PluginOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as PluginOptions
}

function pickString(options: PluginOptions, key: string): string | undefined {
  const value = options[key]
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function pickEnvString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function pickBoolean(
  options: PluginOptions,
  optionKey: string,
  env: NodeJS.ProcessEnv,
  envKey: string,
  fallback: boolean,
): boolean {
  if (options[optionKey] !== undefined) {
    return parseBoolean(options[optionKey], fallback)
  }
  if (env[envKey] !== undefined) {
    return parseBoolean(env[envKey], fallback)
  }
  return fallback
}

function pickPositiveInteger(
  options: PluginOptions,
  optionKey: string,
  env: NodeJS.ProcessEnv,
  envKey: string,
  fallback: number,
): number {
  if (options[optionKey] !== undefined) {
    return parsePositiveInteger(options[optionKey], fallback)
  }
  if (env[envKey] !== undefined) {
    return parsePositiveInteger(env[envKey], fallback)
  }
  return fallback
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function joinUrl(baseUrl: string, segment: string): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/`)
  const basePath = trimTrailingSlashes(url.pathname)
  url.pathname = `${basePath}/${segment.replace(/^\/+/, "")}`
  return trimTrailingSlashes(url.toString())
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "")
}
