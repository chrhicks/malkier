import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { ParseResult, Redacted, Schema } from "effect"
import type { Agent, AgentReasoningEffort, AgentVerbosity } from "@malkier/agent"
import { workspaceRoot as defaultWorkspaceRoot } from "../workspace-root"

type AgentOptions = Agent.Options

const ConfigSecretSource = Schema.Union(
  Schema.String,
  Schema.Struct({
    env: Schema.String
  })
)

const AgentModelConfig = Schema.Struct({
  name: Schema.String,
  temperature: Schema.NullOr(Schema.Number),
  reasoningEffort: Schema.NullOr(Schema.Literal("none", "minimal", "low", "medium", "high")),
  verbosity: Schema.NullOr(Schema.Literal("low", "medium", "high")),
  maxCompletionTokens: Schema.NullOr(Schema.Number)
})

const AgentProviderConfig = Schema.Struct({
  apiUrl: Schema.String,
  apiKey: ConfigSecretSource
})

const ApiConfig = Schema.Struct({
  port: Schema.Number,
  idleTimeoutSeconds: Schema.Number
})

const DatabaseConfig = Schema.Struct({
  path: Schema.String,
  migrateOnStartup: Schema.Boolean
})

const ObservabilityConfig = Schema.Struct({
  enabled: Schema.Boolean,
  endpoint: Schema.String,
  serviceName: Schema.String,
  headers: Schema.NullOr(Schema.String),
  apiKey: Schema.NullOr(ConfigSecretSource),
  deploymentEnvironment: Schema.NullOr(Schema.String),
  serviceVersion: Schema.NullOr(Schema.String)
})

const EvalsConfig = Schema.Struct({
  databasePath: Schema.String
})

const MalkierConfigInput = Schema.Struct({
  version: Schema.Literal(1),
  api: ApiConfig,
  database: DatabaseConfig,
  agent: Schema.Struct({
    provider: AgentProviderConfig,
    model: AgentModelConfig
  }),
  observability: ObservabilityConfig,
  evals: EvalsConfig
})

const MalkierConfigOverride = Schema.Struct({
  version: Schema.optional(Schema.Literal(1)),
  api: Schema.optional(Schema.Struct({
    port: Schema.optional(Schema.Number),
    idleTimeoutSeconds: Schema.optional(Schema.Number)
  })),
  database: Schema.optional(Schema.Struct({
    path: Schema.optional(Schema.String),
    migrateOnStartup: Schema.optional(Schema.Boolean)
  })),
  agent: Schema.optional(Schema.Struct({
    provider: Schema.optional(Schema.Struct({
      apiUrl: Schema.optional(Schema.String),
      apiKey: Schema.optional(ConfigSecretSource)
    })),
    model: Schema.optional(Schema.Struct({
      name: Schema.optional(Schema.String),
      temperature: Schema.optional(Schema.NullOr(Schema.Number)),
      reasoningEffort: Schema.optional(Schema.NullOr(Schema.Literal("none", "minimal", "low", "medium", "high"))),
      verbosity: Schema.optional(Schema.NullOr(Schema.Literal("low", "medium", "high"))),
      maxCompletionTokens: Schema.optional(Schema.NullOr(Schema.Number))
    }))
  })),
  observability: Schema.optional(Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
    endpoint: Schema.optional(Schema.String),
    serviceName: Schema.optional(Schema.String),
    headers: Schema.optional(Schema.NullOr(Schema.String)),
    apiKey: Schema.optional(Schema.NullOr(ConfigSecretSource)),
    deploymentEnvironment: Schema.optional(Schema.NullOr(Schema.String)),
    serviceVersion: Schema.optional(Schema.NullOr(Schema.String))
  })),
  evals: Schema.optional(Schema.Struct({
    databasePath: Schema.optional(Schema.String)
  }))
})

export type MalkierConfigInput = Schema.Schema.Type<typeof MalkierConfigInput>
export type MalkierConfigOverride = Schema.Schema.Type<typeof MalkierConfigOverride>

export type MalkierRuntimeConfig = {
  readonly version: 1
  readonly api: {
    readonly port: number
    readonly idleTimeoutSeconds: number
  }
  readonly database: {
    readonly path: string
    readonly migrateOnStartup: boolean
  }
  readonly agent: {
    readonly provider: {
      readonly apiUrl: string
      readonly apiKey: Redacted.Redacted
    }
    readonly model: {
      readonly name: string
      readonly temperature: number | null
      readonly reasoningEffort: AgentReasoningEffort | null
      readonly verbosity: AgentVerbosity | null
      readonly maxCompletionTokens: number | null
    }
  }
  readonly observability: {
    readonly enabled: boolean
    readonly endpoint: string
    readonly serviceName: string
    readonly headers: string | null
    readonly apiKey: Redacted.Redacted | null
    readonly deploymentEnvironment: string | null
    readonly serviceVersion: string | null
  }
  readonly evals: {
    readonly databasePath: string
  }
}

type LoadMalkierConfigOptions = {
  readonly workspaceRootPath?: string
  readonly configFilePath?: string
  readonly env?: Record<string, string | undefined>
}

type SecretSource = Schema.Schema.Type<typeof ConfigSecretSource>

export const defaultMalkierConfig: MalkierConfigInput = {
  version: 1,
  api: {
    port: 8787,
    idleTimeoutSeconds: 30
  },
  database: {
    path: "apps/api/.data/malkier.sqlite",
    migrateOnStartup: true
  },
  agent: {
    provider: {
      apiUrl: "https://opencode.ai/zen/v1",
      apiKey: {
        env: "OPENCODE_ZEN_API_KEY"
      }
    },
    model: {
      name: "gpt-5.3-codex",
      temperature: null,
      reasoningEffort: null,
      verbosity: null,
      maxCompletionTokens: null
    }
  },
  observability: {
    enabled: true,
    endpoint: "https://api.honeycomb.io",
    serviceName: "malkier-api",
    headers: null,
    apiKey: null,
    deploymentEnvironment: null,
    serviceVersion: null
  },
  evals: {
    databasePath: "tool_eval/results/.data/malkier-eval.sqlite"
  }
}

export const defaultMalkierConfigFilePath = resolve(defaultWorkspaceRoot, "malkier.json")

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const formatConfigError = (error: unknown) =>
  ParseResult.isParseError(error)
    ? ParseResult.TreeFormatter.formatErrorSync(error)
    : String(error)

const decodeSync = <A>(schema: Schema.Schema<A, any, never>, value: unknown, label: string): A => {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    throw new Error(`${label} is invalid:\n${formatConfigError(error)}`)
  }
}

const deepMerge = <T>(base: T, override: unknown): T => {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base
  }

  const merged: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue
    }

    merged[key] = key in merged
      ? deepMerge(merged[key], value)
      : value
  }

  return merged as T
}

const readOptionalConfigOverride = (filePath: string): unknown | null => {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${String(error)}`)
  }
}

const resolveSecretSource = (
  source: SecretSource,
  env: Record<string, string | undefined>,
  label: string
): Redacted.Redacted => {
  if (typeof source === "string") {
    return Redacted.make(source)
  }

  const value = env[source.env]

  if (value == null || value.length === 0) {
    throw new Error(`Missing environment variable ${source.env} for ${label}`)
  }

  return Redacted.make(value)
}

const resolveWorkspacePath = (workspaceRootPath: string, path: string) =>
  isAbsolute(path)
    ? path
    : resolve(workspaceRootPath, path)

const hasEntries = (value: Record<string, unknown>) => Object.keys(value).length > 0

export const resolveMalkierPath = (
  path: string,
  workspaceRootPath = defaultWorkspaceRoot
) => resolveWorkspacePath(workspaceRootPath, path)

const buildEnvOverride = (env: Record<string, string | undefined>): MalkierConfigOverride => {
  const override: any = {}
  const apiOverride: Record<string, unknown> = {}
  const databaseOverride: Record<string, unknown> = {}
  const agentProviderOverride: Record<string, unknown> = {}
  const agentModelOverride: Record<string, unknown> = {}
  const observabilityOverride: Record<string, unknown> = {}
  const evalsOverride: Record<string, unknown> = {}

  if (env.PORT !== undefined) {
    apiOverride.port = decodeSync(Schema.NumberFromString, env.PORT, "PORT")
  }

  if (env.MALKIER_DB_PATH !== undefined) {
    databaseOverride.path = env.MALKIER_DB_PATH
  }

  if (env.MALKIER_AGENT_API_URL !== undefined) {
    agentProviderOverride.apiUrl = env.MALKIER_AGENT_API_URL
  }

  if (env.OPENCODE_ZEN_API_KEY !== undefined) {
    agentProviderOverride.apiKey = { env: "OPENCODE_ZEN_API_KEY" }
  }

  if (env.MALKIER_AGENT_MODEL !== undefined) {
    agentModelOverride.name = env.MALKIER_AGENT_MODEL
  }

  if (env.MALKIER_AGENT_TEMPERATURE !== undefined) {
    agentModelOverride.temperature = decodeSync(
      Schema.NumberFromString,
      env.MALKIER_AGENT_TEMPERATURE,
      "MALKIER_AGENT_TEMPERATURE"
    )
  }

  if (env.MALKIER_AGENT_REASONING_EFFORT !== undefined) {
    agentModelOverride.reasoningEffort = decodeSync(
      Schema.Literal("none", "minimal", "low", "medium", "high"),
      env.MALKIER_AGENT_REASONING_EFFORT,
      "MALKIER_AGENT_REASONING_EFFORT"
    )
  }

  if (env.MALKIER_AGENT_VERBOSITY !== undefined) {
    agentModelOverride.verbosity = decodeSync(
      Schema.Literal("low", "medium", "high"),
      env.MALKIER_AGENT_VERBOSITY,
      "MALKIER_AGENT_VERBOSITY"
    )
  }

  if (env.MALKIER_AGENT_MAX_COMPLETION_TOKENS !== undefined) {
    agentModelOverride.maxCompletionTokens = decodeSync(
      Schema.NumberFromString,
      env.MALKIER_AGENT_MAX_COMPLETION_TOKENS,
      "MALKIER_AGENT_MAX_COMPLETION_TOKENS"
    )
  }

  if (hasEntries(agentProviderOverride) || hasEntries(agentModelOverride)) {
    override.agent = {
      ...(hasEntries(agentProviderOverride) ? { provider: agentProviderOverride } : {}),
      ...(hasEntries(agentModelOverride) ? { model: agentModelOverride } : {})
    }
  }

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined) {
    observabilityOverride.endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT
  }

  if (env.OTEL_SERVICE_NAME !== undefined) {
    observabilityOverride.serviceName = env.OTEL_SERVICE_NAME
  }

  if (env.OTEL_EXPORTER_OTLP_HEADERS !== undefined) {
    observabilityOverride.headers = env.OTEL_EXPORTER_OTLP_HEADERS
  }

  if (env.HONEYCOMB_API_KEY !== undefined) {
    observabilityOverride.apiKey = { env: "HONEYCOMB_API_KEY" }
  }

  const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT ?? env.NODE_ENV
  if (deploymentEnvironment !== undefined) {
    observabilityOverride.deploymentEnvironment = deploymentEnvironment
  }

  const serviceVersion = env.OTEL_SERVICE_VERSION ?? env.npm_package_version
  if (serviceVersion !== undefined) {
    observabilityOverride.serviceVersion = serviceVersion
  }

  if (hasEntries(observabilityOverride)) {
    override.observability = observabilityOverride
  }

  if (env.MALKIER_EVAL_DB_PATH !== undefined) {
    evalsOverride.databasePath = env.MALKIER_EVAL_DB_PATH
  }

  if (hasEntries(apiOverride)) {
    override.api = apiOverride
  }

  if (hasEntries(databaseOverride)) {
    override.database = databaseOverride
  }

  if (hasEntries(evalsOverride)) {
    override.evals = evalsOverride
  }

  return override
}

const validateModelCompatibility = (config: MalkierConfigInput): MalkierConfigInput => {
  const { name, temperature } = config.agent.model

  if (name === "gpt-5.3-codex" && temperature !== null) {
    throw new Error(
      "Merged Malkier config is invalid:\nagent.model.temperature is not supported for gpt-5.3-codex. Set it to null or omit it."
    )
  }

  return config
}

const toRuntimeConfig = (
  config: MalkierConfigInput,
  env: Record<string, string | undefined>,
  workspaceRootPath: string
): MalkierRuntimeConfig => ({
  version: config.version,
  api: config.api,
  database: {
    path: resolveWorkspacePath(workspaceRootPath, config.database.path),
    migrateOnStartup: config.database.migrateOnStartup
  },
  agent: {
    provider: {
      apiUrl: config.agent.provider.apiUrl,
      apiKey: resolveSecretSource(config.agent.provider.apiKey, env, "agent.provider.apiKey")
    },
    model: config.agent.model
  },
  observability: {
    enabled: config.observability.enabled,
    endpoint: config.observability.endpoint,
    serviceName: config.observability.serviceName,
    headers: config.observability.headers,
    apiKey: config.observability.apiKey === null
      ? null
      : resolveSecretSource(config.observability.apiKey, env, "observability.apiKey"),
    deploymentEnvironment: config.observability.deploymentEnvironment,
    serviceVersion: config.observability.serviceVersion
  },
  evals: {
    databasePath: resolveWorkspacePath(workspaceRootPath, config.evals.databasePath)
  }
})

let cachedConfig: MalkierRuntimeConfig | undefined
let cachedConfigInput: MalkierConfigInput | undefined

export const loadMalkierConfigInput = ({
  workspaceRootPath = defaultWorkspaceRoot,
  configFilePath = resolve(workspaceRootPath, "malkier.json"),
  env = Bun.env
}: LoadMalkierConfigOptions = {}): MalkierConfigInput => {
  const fileOverrideRaw = readOptionalConfigOverride(configFilePath)
  const fileOverride = fileOverrideRaw == null
    ? {}
    : decodeSync(MalkierConfigOverride, fileOverrideRaw, configFilePath)
  const envOverride = buildEnvOverride(env)

  return validateModelCompatibility(
    decodeSync(
      MalkierConfigInput,
      deepMerge(deepMerge(defaultMalkierConfig, fileOverride), envOverride),
      "Merged Malkier config"
    )
  )
}

export const loadMalkierConfig = ({
  workspaceRootPath = defaultWorkspaceRoot,
  configFilePath = resolve(workspaceRootPath, "malkier.json"),
  env = Bun.env
}: LoadMalkierConfigOptions = {}): MalkierRuntimeConfig => {
  const mergedInput = loadMalkierConfigInput({ workspaceRootPath, configFilePath, env })

  return toRuntimeConfig(mergedInput, env, workspaceRootPath)
}

export const getMalkierConfigInput = (): MalkierConfigInput => {
  if (cachedConfigInput === undefined) {
    cachedConfigInput = loadMalkierConfigInput()
  }

  return cachedConfigInput
}

export const getMalkierConfig = (): MalkierRuntimeConfig => {
  if (cachedConfig === undefined) {
    cachedConfig = loadMalkierConfig()
  }

  return cachedConfig
}

export const resetMalkierConfigCache = () => {
  cachedConfig = undefined
  cachedConfigInput = undefined
}

export const toAgentOptions = (config: MalkierRuntimeConfig["agent"]): AgentOptions => ({
  model: config.model.name,
  apiUrl: config.provider.apiUrl,
  apiKey: config.provider.apiKey,
  temperature: config.model.temperature ?? undefined,
  reasoningEffort: config.model.reasoningEffort ?? undefined,
  verbosity: config.model.verbosity ?? undefined,
  maxCompletionTokens: config.model.maxCompletionTokens ?? undefined
})
