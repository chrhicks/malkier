import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Redacted } from "effect"
import { agentRuntimeConfig, reasoningEffortValues, verbosityValues } from "./config"

const loadConfig = (values: Record<string, string>) =>
  Effect.runPromise(
    ConfigProvider.fromMap(new Map(Object.entries(values))).load(
      agentRuntimeConfig({
        defaultModel: "gpt-5.3-codex",
        defaultApiUrl: "https://opencode.ai/zen/v1"
      })
    )
  )

describe("agentRuntimeConfig", () => {
  test("uses defaults when optional controls are unset", async () => {
    const config = await loadConfig({
      OPENCODE_ZEN_API_KEY: "secret"
    })

    expect(config.model).toBe("gpt-5.3-codex")
    expect(config.apiUrl).toBe("https://opencode.ai/zen/v1")
    expect(Redacted.value(config.apiKey)).toBe("secret")
    expect(config.temperature).toBeUndefined()
    expect(config.reasoningEffort).toBeUndefined()
    expect(config.verbosity).toBeUndefined()
    expect(config.maxCompletionTokens).toBeUndefined()
  })

  test("loads supported LLM controls from env", async () => {
    const config = await loadConfig({
      OPENCODE_ZEN_API_KEY: "secret",
      MALKIER_AGENT_TEMPERATURE: "0.2",
      MALKIER_AGENT_REASONING_EFFORT: "high",
      MALKIER_AGENT_VERBOSITY: "low",
      MALKIER_AGENT_MAX_COMPLETION_TOKENS: "4096"
    })

    expect(config.temperature).toBe(0.2)
    expect(config.reasoningEffort).toBe("high")
    expect(config.verbosity).toBe("low")
    expect(config.maxCompletionTokens).toBe(4096)
  })

  test("rejects unsupported enum values", async () => {
    await expect(
      loadConfig({
        OPENCODE_ZEN_API_KEY: "secret",
        MALKIER_AGENT_REASONING_EFFORT: "max"
      })
    ).rejects.toThrow()

    await expect(
      loadConfig({
        OPENCODE_ZEN_API_KEY: "secret",
        MALKIER_AGENT_VERBOSITY: "verbose"
      })
    ).rejects.toThrow()
  })

  test("exports the supported enum values explicitly", () => {
    expect(reasoningEffortValues).toEqual(["none", "minimal", "low", "medium", "high"])
    expect(verbosityValues).toEqual(["low", "medium", "high"])
  })
})
