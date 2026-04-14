import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Redacted } from "effect"
import {
  defaultMalkierConfig,
  loadMalkierConfig,
  resetMalkierConfigCache,
  toAgentOptions
} from "./malkier-config"

const tempRoots: string[] = []

const makeWorkspaceRoot = () => {
  const root = mkdtempSync(join(Bun.env.TMPDIR ?? "/tmp", "malkier-config-"))
  tempRoots.push(root)
  return root
}

const writeConfigFile = (workspaceRootPath: string, value: unknown) => {
  writeFileSync(join(workspaceRootPath, "malkier.json"), JSON.stringify(value, null, 2))
}

afterEach(() => {
  resetMalkierConfigCache()

  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!
    rmSync(root, { recursive: true, force: true })
  }
})

describe("malkier config", () => {
  test("uses built-in defaults when malkier.json is absent", () => {
    const workspaceRootPath = makeWorkspaceRoot()
    mkdirSync(join(workspaceRootPath, "apps/api/.data"), { recursive: true })

    const config = loadMalkierConfig({
      workspaceRootPath,
      env: {
        OPENCODE_ZEN_API_KEY: "secret"
      }
    })

    expect(config.api.port).toBe(defaultMalkierConfig.api.port)
    expect(config.database.path).toBe(join(workspaceRootPath, "apps/api/.data/malkier.sqlite"))
    expect(config.evals.databasePath).toBe(join(workspaceRootPath, "tool_eval/results/.data/malkier-eval.sqlite"))
    expect(Redacted.value(config.agent.provider.apiKey)).toBe("secret")
  })

  test("merges sparse malkier.json overrides into defaults", () => {
    const workspaceRootPath = makeWorkspaceRoot()
    writeConfigFile(workspaceRootPath, {
      agent: {
        model: {
          reasoningEffort: "high",
          verbosity: "medium"
        }
      },
      database: {
        path: "custom.sqlite"
      }
    })

    const config = loadMalkierConfig({
      workspaceRootPath,
      env: {
        OPENCODE_ZEN_API_KEY: "secret"
      }
    })

    expect(config.agent.model.name).toBe(defaultMalkierConfig.agent.model.name)
    expect(config.agent.model.reasoningEffort).toBe("high")
    expect(config.agent.model.verbosity).toBe("medium")
    expect(config.database.path).toBe(join(workspaceRootPath, "custom.sqlite"))
  })

  test("env overrides beat malkier.json", () => {
    const workspaceRootPath = makeWorkspaceRoot()
    writeConfigFile(workspaceRootPath, {
      api: {
        port: 3001
      },
      agent: {
        model: {
          name: "file-model"
        }
      }
    })

    const config = loadMalkierConfig({
      workspaceRootPath,
      env: {
        PORT: "9999",
        MALKIER_AGENT_MODEL: "env-model",
        OPENCODE_ZEN_API_KEY: "secret"
      }
    })

    expect(config.api.port).toBe(9999)
    expect(config.agent.model.name).toBe("env-model")
  })

  test("fails gracefully when required secret env is missing", () => {
    const workspaceRootPath = makeWorkspaceRoot()

    expect(() => loadMalkierConfig({ workspaceRootPath, env: {} })).toThrow(
      "Missing environment variable OPENCODE_ZEN_API_KEY"
    )
  })

  test("fails fast for unsupported model settings", () => {
    const workspaceRootPath = makeWorkspaceRoot()
    writeConfigFile(workspaceRootPath, {
      agent: {
        model: {
          temperature: 0.2
        }
      }
    })

    expect(() =>
      loadMalkierConfig({
        workspaceRootPath,
        env: {
          OPENCODE_ZEN_API_KEY: "secret"
        }
      })
    ).toThrow("agent.model.temperature is not supported for gpt-5.3-codex")
  })

  test("converts agent config into Agent.Options", () => {
    const workspaceRootPath = makeWorkspaceRoot()
    writeConfigFile(workspaceRootPath, {
      agent: {
        model: {
          reasoningEffort: "high",
          verbosity: "low",
          maxCompletionTokens: 4096
        }
      }
    })

    const config = loadMalkierConfig({
      workspaceRootPath,
      env: {
        OPENCODE_ZEN_API_KEY: "secret"
      }
    })

    expect(toAgentOptions(config.agent)).toEqual({
      model: "gpt-5.3-codex",
      apiUrl: "https://opencode.ai/zen/v1",
      apiKey: config.agent.provider.apiKey,
      temperature: undefined,
      reasoningEffort: "high",
      verbosity: "low",
      maxCompletionTokens: 4096
    })
  })
})
