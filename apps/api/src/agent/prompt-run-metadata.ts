import { Effect, Schema } from "effect"
import { reasoningEffortValues, verbosityValues } from "@malkier/agent"
import type { AssembledPrompt } from "./prompt-assembler"
import { agentModeValues } from "./agent-mode"
import { rootAgentsPromptSource } from "./prompt-assembler"

export const PersistedPromptLayer = Schema.Struct({
  order: Schema.Number,
  id: Schema.String,
  kind: Schema.Literal("base", "runtime", "repo", "mode", "skill", "subagent", "soft-stop"),
  source: Schema.String,
  sha256: Schema.String
})

export type PersistedPromptLayer = Schema.Schema.Type<typeof PersistedPromptLayer>

export const PromptRunLlmSettings = Schema.Struct({
  model: Schema.String,
  apiUrl: Schema.String,
  temperature: Schema.NullOr(Schema.Number),
  reasoningEffort: Schema.NullOr(Schema.Literal(...reasoningEffortValues)),
  verbosity: Schema.NullOr(Schema.Literal(...verbosityValues)),
  maxCompletionTokens: Schema.NullOr(Schema.Number)
})

export type PromptRunLlmSettings = Schema.Schema.Type<typeof PromptRunLlmSettings>

export const PromptRunMetadata = Schema.Struct({
  resolvedMode: Schema.Literal(...agentModeValues),
  selectedSkills: Schema.Array(Schema.String),
  toolLoadedSkills: Schema.Array(Schema.String),
  llmSettings: Schema.NullOr(PromptRunLlmSettings),
  rootAgentsLoaded: Schema.Boolean,
  layers: Schema.Array(PersistedPromptLayer)
})

export type PromptRunMetadata = Schema.Schema.Type<typeof PromptRunMetadata>

export const createPromptRunLlmSettings = ({
  model,
  apiUrl,
  temperature,
  reasoningEffort,
  verbosity,
  maxCompletionTokens
}: {
  readonly model: string
  readonly apiUrl: string
  readonly temperature?: number
  readonly reasoningEffort?: PromptRunLlmSettings["reasoningEffort"] extends infer T ? Exclude<T, null> : never
  readonly verbosity?: PromptRunLlmSettings["verbosity"] extends infer T ? Exclude<T, null> : never
  readonly maxCompletionTokens?: number
}): PromptRunLlmSettings => ({
  model,
  apiUrl,
  temperature: temperature ?? null,
  reasoningEffort: reasoningEffort ?? null,
  verbosity: verbosity ?? null,
  maxCompletionTokens: maxCompletionTokens ?? null
})

export const createPromptRunMetadata = (
  assembledPrompt: AssembledPrompt,
  llmSettings: PromptRunLlmSettings | null = null
): PromptRunMetadata => ({
  resolvedMode: assembledPrompt.resolvedMode,
  selectedSkills: [...assembledPrompt.selectedSkills],
  toolLoadedSkills: [],
  llmSettings,
  rootAgentsLoaded: assembledPrompt.layers.some(
    (layer) => layer.kind === "repo" && layer.source === rootAgentsPromptSource
  ),
  layers: assembledPrompt.layers.map((layer, order) => ({
    order,
    id: layer.id,
    kind: layer.kind,
    source: layer.source,
    sha256: layer.sha256
  }))
})

export const appendToolLoadedSkill = (
  metadata: PromptRunMetadata,
  skillName: string
): PromptRunMetadata => {
  if (metadata.toolLoadedSkills.includes(skillName)) {
    return metadata
  }

  return {
    ...metadata,
    toolLoadedSkills: [...metadata.toolLoadedSkills, skillName]
  }
}

const withPromptRunMetadataDefaults = (metadata: unknown): unknown => {
  if (typeof metadata !== "object" || metadata === null) {
    return metadata
  }

  let nextMetadata: Record<string, unknown> = metadata as Record<string, unknown>

  if (!("toolLoadedSkills" in nextMetadata)) {
    nextMetadata = {
      ...nextMetadata,
      toolLoadedSkills: []
    }
  }

  if (!("llmSettings" in nextMetadata)) {
    nextMetadata = {
      ...nextMetadata,
      llmSettings: null
    }
  }

  return nextMetadata
}

export const decodePromptRunMetadata = (metadata: string) =>
  Effect.try({
    try: () => JSON.parse(metadata),
    catch: (cause) => new Error(`Invalid prompt run metadata JSON: ${String(cause)}`)
  }).pipe(
    Effect.map(withPromptRunMetadataDefaults),
    Effect.flatMap(Schema.decodeUnknown(PromptRunMetadata))
  )
