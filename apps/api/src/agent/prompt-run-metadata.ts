import { Effect, Schema } from "effect"
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

export const PromptRunMetadata = Schema.Struct({
  resolvedMode: Schema.Literal(...agentModeValues),
  selectedSkills: Schema.Array(Schema.String),
  toolLoadedSkills: Schema.Array(Schema.String),
  rootAgentsLoaded: Schema.Boolean,
  layers: Schema.Array(PersistedPromptLayer)
})

export type PromptRunMetadata = Schema.Schema.Type<typeof PromptRunMetadata>

export const createPromptRunMetadata = (assembledPrompt: AssembledPrompt): PromptRunMetadata => ({
  resolvedMode: assembledPrompt.resolvedMode,
  selectedSkills: [...assembledPrompt.selectedSkills],
  toolLoadedSkills: [],
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

  if ("toolLoadedSkills" in metadata) {
    return metadata
  }

  return {
    ...metadata,
    toolLoadedSkills: []
  }
}

export const decodePromptRunMetadata = (metadata: string) =>
  Effect.try({
    try: () => JSON.parse(metadata),
    catch: (cause) => new Error(`Invalid prompt run metadata JSON: ${String(cause)}`)
  }).pipe(
    Effect.map(withPromptRunMetadataDefaults),
    Effect.flatMap(Schema.decodeUnknown(PromptRunMetadata))
  )
