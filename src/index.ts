import type { Plugin } from "@opencode-ai/plugin"

import { loadConfig, type Config } from "./config.js"
import { logSafe, debugSafe } from "./log.js"
import { PrivacyClient, safeErrorDetail } from "./privacy.js"
import {
  inferSessionID,
  pseudonymizeMessages,
  pseudonymizeSystem,
  pseudonymizeToolDefinition,
  rehydrateDeep,
  rehydrateText,
  type TransformReport,
} from "./transforms.js"

export const OpencodeCloakPipe: Plugin = async (ctx, options) => {
  const config = loadConfig(options, process.env, ctx.directory)
  if (!config.enabled) {
    await logSafe(ctx.client, config, "info", "plugin disabled")
    return {}
  }

  const privacy = new PrivacyClient(config)

  await logSafe(ctx.client, config, "info", "plugin initialized", {
    baseUrl: config.baseUrl,
    strict: config.strict,
    transformSystem: config.transformSystem,
    restoreAssistantText: config.restoreAssistantText,
    restoreToolArgs: config.restoreToolArgs,
  })

  const ensureCloakPipe = async (hook: string): Promise<boolean> => {
    const health = await privacy.health()
    if (health.ok) return true
    await logSafe(ctx.client, config, config.strict ? "error" : "warn", "cloakpipe unavailable", {
      hook,
      status: health.status ?? null,
      detail: health.detail,
    })
    if (config.strict) {
      throw new Error(`${hook}: CloakPipe is unavailable (${health.detail})`)
    }
    return false
  }

  const runHook = async (hook: string, action: () => Promise<TransformReport | void>): Promise<void> => {
    if (!(await ensureCloakPipe(hook))) return
    try {
      const report = await action()
      if (report) {
        await debugSafe(ctx.client, config, "hook transformed text", {
          hook,
          visitedStrings: report.visitedStrings,
          changedStrings: report.changedStrings,
          skippedKeys: report.skippedKeys,
        })
      }
    } catch (error) {
      await logSafe(ctx.client, config, config.strict ? "error" : "warn", "cloakpipe transform failed", {
        hook,
        detail: safeErrorDetail(error),
      })
      if (config.strict) {
        throw new Error(`${hook}: CloakPipe transform failed (${safeErrorDetail(error)})`)
      }
    }
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      await runHook("experimental.chat.messages.transform", async () => {
        const sessionID = inferSessionID(output.messages)
        const report = await pseudonymizeMessages(output.messages, privacy, config)
        await debugSafe(ctx.client, config, "provider-bound messages pseudonymized", {
          sessionID: sessionID ?? "unknown",
          changedStrings: report.changedStrings,
        })
        return report
      })
    },

    "experimental.chat.system.transform": async (_input, output) => {
      if (!config.transformSystem) return
      await runHook("experimental.chat.system.transform", async () => pseudonymizeSystem(output.system, privacy))
    },

    "experimental.text.complete": async (_input, output) => {
      if (!config.restoreAssistantText || typeof output.text !== "string" || !output.text) return
      await runHook("experimental.text.complete", async () => {
        const restored = await rehydrateText(output.text, privacy)
        output.text = restored.text
        return {
          visitedStrings: 1,
          changedStrings: restored.changed ? 1 : 0,
          skippedKeys: 0,
        }
      })
    },

    "tool.execute.before": async (_input, output) => {
      if (!config.restoreToolArgs) return
      await runHook("tool.execute.before", async () => rehydrateDeep(output.args, privacy, config))
    },

    "tool.definition": async (_input, output) => {
      if (!config.transformToolDefinitions) return
      await runHook("tool.definition", async () => pseudonymizeToolDefinition(output, privacy, config))
    },
  }
}

export default OpencodeCloakPipe
export type { Config }
