import type { Config } from "./config.js"
import type { PrivacyClient } from "./privacy.js"

export type TextTransform = (text: string) => Promise<string>

export interface TransformReport {
  visitedStrings: number
  changedStrings: number
  skippedKeys: number
}

export interface TransformOptions {
  readonly skipKeys?: ReadonlySet<string>
}

export function emptyReport(): TransformReport {
  return { visitedStrings: 0, changedStrings: 0, skippedKeys: 0 }
}

export function createCachedTextTransform(transform: TextTransform): TextTransform {
  const cache = new Map<string, Promise<string>>()
  return (text: string) => {
    if (!text) return Promise.resolve(text)
    const existing = cache.get(text)
    if (existing) return existing
    const promise = transform(text).catch((error: unknown) => {
      cache.delete(text)
      throw error
    })
    cache.set(text, promise)
    return promise
  }
}

export async function transformStringLeaves(
  value: unknown,
  transform: TextTransform,
  options: TransformOptions = {},
): Promise<TransformReport> {
  const report = emptyReport()
  const seen = new WeakSet<object>()
  const skipKeys = options.skipKeys ?? new Set<string>()

  const visitString = async (text: string): Promise<string> => {
    report.visitedStrings += 1
    if (!text) return text
    const transformed = await transform(text)
    if (transformed !== text) report.changedStrings += 1
    return transformed
  }

  const walk = async (node: unknown): Promise<void> => {
    if (!node || typeof node !== "object") return
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        const item = node[index]
        if (typeof item === "string") {
          node[index] = await visitString(item)
        } else if (item && typeof item === "object") {
          await walk(item)
        }
      }
      return
    }

    if (!isPlainObject(node)) return

    const record = node as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (skipKeys.has(key)) {
        report.skippedKeys += 1
        continue
      }
      const item = record[key]
      if (typeof item === "string") {
        record[key] = await visitString(item)
      } else if (item && typeof item === "object") {
        await walk(item)
      }
    }
  }

  await walk(value)
  return report
}

export async function pseudonymizeMessages(
  messages: unknown,
  client: Pick<PrivacyClient, "pseudonymizeText">,
  config: Pick<Config, "skipKeys">,
): Promise<TransformReport> {
  const report = emptyReport()
  if (!Array.isArray(messages)) return report
  const transform = createCachedTextTransform((text) => client.pseudonymizeText(text))

  for (const message of messages) {
    if (!isPlainObject(message)) continue
    const parts = (message as Record<string, unknown>).parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (!isPlainObject(part)) continue
      if ((part as Record<string, unknown>).ignored === true) continue
      mergeReport(report, await transformStringLeaves(part, transform, { skipKeys: config.skipKeys }))
    }
  }

  return report
}

export async function pseudonymizeSystem(
  system: unknown,
  client: Pick<PrivacyClient, "pseudonymizeText">,
): Promise<TransformReport> {
  const report = emptyReport()
  if (!Array.isArray(system)) return report
  const transform = createCachedTextTransform((text) => client.pseudonymizeText(text))

  for (let index = 0; index < system.length; index += 1) {
    const item = system[index]
    if (typeof item !== "string") continue
    report.visitedStrings += 1
    const transformed = await transform(item)
    if (transformed !== item) report.changedStrings += 1
    system[index] = transformed
  }

  return report
}

export async function rehydrateText(
  text: string,
  client: Pick<PrivacyClient, "rehydrateText">,
): Promise<{ text: string; changed: boolean }> {
  const transformed = await client.rehydrateText(text)
  return { text: transformed, changed: transformed !== text }
}

export async function rehydrateDeep(
  value: unknown,
  client: Pick<PrivacyClient, "rehydrateText">,
  config: Pick<Config, "skipKeys">,
): Promise<TransformReport> {
  const transform = createCachedTextTransform((text) => client.rehydrateText(text))
  return transformStringLeaves(value, transform, { skipKeys: config.skipKeys })
}

export async function pseudonymizeToolDefinition(
  value: unknown,
  client: Pick<PrivacyClient, "pseudonymizeText">,
  config: Pick<Config, "skipKeys">,
): Promise<TransformReport> {
  const transform = createCachedTextTransform((text) => client.pseudonymizeText(text))
  return transformStringLeaves(value, transform, { skipKeys: config.skipKeys })
}

export function mergeReport(target: TransformReport, source: TransformReport): TransformReport {
  target.visitedStrings += source.visitedStrings
  target.changedStrings += source.changedStrings
  target.skippedKeys += source.skippedKeys
  return target
}

export function inferSessionID(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  const first = messages[0]
  if (!isPlainObject(first)) return undefined
  const info = (first as Record<string, unknown>).info
  if (isPlainObject(info)) {
    const sessionID = (info as Record<string, unknown>).sessionID ?? (info as Record<string, unknown>).sessionId
    if (typeof sessionID === "string" && sessionID) return sessionID
  }
  const parts = (first as Record<string, unknown>).parts
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!isPlainObject(part)) continue
      const sessionID = (part as Record<string, unknown>).sessionID ?? (part as Record<string, unknown>).sessionId
      if (typeof sessionID === "string" && sessionID) return sessionID
    }
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
