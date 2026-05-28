#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"

import { loadConfig } from "./config.js"
import { installLocalPlugin, type InstallOptions } from "./install.js"
import { PrivacyClient } from "./privacy.js"

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "help"
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp()
    return 0
  }

  if (command === "doctor") {
    return doctor()
  }

  if (command === "install") {
    return install(argv.slice(1))
  }

  if (command === "print-config") {
    const config = loadConfig()
    console.log(
      JSON.stringify(
        {
          enabled: config.enabled,
          baseUrl: config.baseUrl,
          pseudonymizeUrl: config.pseudonymizeUrl,
          rehydrateUrl: config.rehydrateUrl,
          healthUrl: config.healthUrl,
          strict: config.strict,
          timeoutMs: config.timeoutMs,
          healthTimeoutMs: config.healthTimeoutMs,
          transformSystem: config.transformSystem,
          restoreAssistantText: config.restoreAssistantText,
          restoreToolArgs: config.restoreToolArgs,
          transformToolDefinitions: config.transformToolDefinitions,
          skipKeys: [...config.skipKeys].sort(),
        },
        null,
        2,
      ),
    )
    return 0
  }

  console.error(`Unknown command: ${command}`)
  printHelp()
  return 2
}

async function install(argv: readonly string[]): Promise<number> {
  let options: InstallOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--global" || arg === "-g") {
      options = { ...options, global: true }
      continue
    }
    if (arg === "--project") {
      options = { ...options, global: false }
      continue
    }
    if (arg === "--force" || arg === "-f") {
      options = { ...options, force: true }
      continue
    }
    if (arg === "--cwd") {
      const value = argv[index + 1]
      if (!value) {
        console.error("install failed: --cwd requires a path")
        return 2
      }
      options = { ...options, cwd: value }
      index += 1
      continue
    }
    if (arg === "--config-dir") {
      const value = argv[index + 1]
      if (!value) {
        console.error("install failed: --config-dir requires a path")
        return 2
      }
      options = { ...options, configDir: value }
      index += 1
      continue
    }
    console.error(`Unknown install option: ${arg}`)
    return 2
  }

  try {
    const result = await installLocalPlugin(options)
    const state = result.changed ? "installed" : "already installed"
    console.log(`${state} ${result.scope} plugin: ${result.pluginFile}`)
    console.log(`points to: ${result.packageEntryUrl}`)
    return 0
  } catch (error) {
    console.error(`install failed: ${error instanceof Error ? error.message : "unknown error"}`)
    return 1
  }
}

async function doctor(): Promise<number> {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    console.error(`fail  config: ${error instanceof Error ? error.message : "invalid config"}`)
    return 1
  }

  console.log(`ok    config: base_url=${config.baseUrl}`)
  const client = new PrivacyClient(config)
  const health = await client.health()
  if (!health.ok) {
    console.error(`fail  cloakpipe: ${health.detail}`)
    return 1
  }
  console.log(`ok    cloakpipe: ${health.detail}`)
  return 0
}

function printHelp(): void {
  console.log(`opencode-cloakpipe

Usage:
  opencode-cloakpipe install      Install a local plugin shim into .opencode/plugins
  opencode-cloakpipe doctor       Check CloakPipe connectivity
  opencode-cloakpipe print-config Print resolved non-secret config
  opencode-cloakpipe --help       Show this help

Install options:
  --global, -g          Install into ~/.config/opencode/plugins
  --project             Install into ./.opencode/plugins (default)
  --config-dir <dir>    Install into a custom OpenCode config directory
  --cwd <dir>           Resolve project/custom paths from another directory
  --force, -f           Replace an existing shim
`)
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : ""
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  main().then((code) => {
    process.exitCode = code
  })
}
