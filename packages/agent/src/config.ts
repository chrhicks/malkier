import { Config, Option, Redacted } from "effect"

export const reasoningEffortValues = ["none", "minimal", "low", "medium", "high"] as const
export type AgentReasoningEffort = (typeof reasoningEffortValues)[number]

export const verbosityValues = ["low", "medium", "high"] as const
export type AgentVerbosity = (typeof verbosityValues)[number]

export type AgentModelControls = {
  readonly temperature?: number
  readonly reasoningEffort?: AgentReasoningEffort
  readonly verbosity?: AgentVerbosity
  readonly maxCompletionTokens?: number
}

export type AgentRuntimeConfig = {
  readonly model: string
  readonly apiUrl: string
  readonly apiKey: Redacted.Redacted
} & AgentModelControls

export type AgentRuntimeConfigOptions = {
  readonly model: Config.Config<string>
  readonly apiUrl: Config.Config<string>
  readonly apiKey: Config.Config<Redacted.Redacted>
  readonly temperature: Config.Config<number | undefined>
  readonly reasoningEffort: Config.Config<AgentReasoningEffort | undefined>
  readonly verbosity: Config.Config<AgentVerbosity | undefined>
  readonly maxCompletionTokens: Config.Config<number | undefined>
}

const optionToUndefined = <A>(option: Option.Option<A>): A | undefined =>
  Option.match(option, {
    onNone: () => undefined,
    onSome: (value) => value
  })

export const agentRuntimeConfigOptions = ({
  defaultModel,
  defaultApiUrl
}: {
  defaultModel: string
  defaultApiUrl: string
}): AgentRuntimeConfigOptions => ({
    model: Config.string("MALKIER_AGENT_MODEL").pipe(
      Config.withDefault(defaultModel)
    ),
    apiUrl: Config.string("MALKIER_AGENT_API_URL").pipe(
      Config.withDefault(defaultApiUrl)
    ),
    apiKey: Config.redacted("OPENCODE_ZEN_API_KEY"),
    temperature: Config.option(Config.number("MALKIER_AGENT_TEMPERATURE")).pipe(Config.map(optionToUndefined)),
    reasoningEffort: Config.option(Config.literal(...reasoningEffortValues)("MALKIER_AGENT_REASONING_EFFORT")).pipe(Config.map(optionToUndefined)),
    verbosity: Config.option(Config.literal(...verbosityValues)("MALKIER_AGENT_VERBOSITY")).pipe(Config.map(optionToUndefined)),
    maxCompletionTokens: Config.option(Config.integer("MALKIER_AGENT_MAX_COMPLETION_TOKENS")).pipe(Config.map(optionToUndefined))
  })

export const agentRuntimeConfig = ({
  defaultModel,
  defaultApiUrl
}: {
  defaultModel: string
  defaultApiUrl: string
}) => Config.all(agentRuntimeConfigOptions({ defaultModel, defaultApiUrl }))
