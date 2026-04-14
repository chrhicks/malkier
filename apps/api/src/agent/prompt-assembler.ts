import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Prompt, Response as EffectResponse } from "@effect/ai"
import { Effect } from "effect"
import type { AgentMode } from "./agent-mode"
import {
  availableSkillsPromptSource,
  loadAvailableSkillsPrompt,
  loadSelectedSkills
} from "./skill-catalog"
import { malkierBaseSystemPrompt, malkierBaseSystemPromptSource } from "./prompts/base-system-prompt"
import { reviewModePrompt, reviewModePromptSource } from "./prompts/review-mode-prompt"
import type { SessionMessageWithMetadata } from "../service/session.service"
import { workspaceRoot } from "../workspace-root"

export type PromptLayerKind = "base" | "runtime" | "repo" | "mode" | "skill" | "subagent" | "soft-stop"

export type SubagentContext = {
  readonly role: string
  readonly brief: string
  readonly outputContract: string
  readonly inheritedMode?: AgentMode | null
  readonly inheritedSkills?: ReadonlyArray<string>
}

export type PromptLayer = {
  readonly id: string
  readonly kind: PromptLayerKind
  readonly role: "system"
  readonly source: string
  readonly content: string
  readonly sha256: string
}

export type AssemblePromptInput = {
  readonly messages: ReadonlyArray<SessionMessageWithMetadata>
  readonly explicitMode?: AgentMode
  readonly selectedSkills?: ReadonlyArray<string>
  readonly nearSoftStop?: boolean
  readonly subagentContext?: SubagentContext | null
}

export type AssembledPrompt = {
  readonly prompt: Prompt.RawInput
  readonly layers: ReadonlyArray<PromptLayer>
  readonly resolvedMode: AgentMode
  readonly selectedSkills: ReadonlyArray<string>
}

type AssemblePromptOptions = {
  readonly rootAgentsLayer?: PromptLayer | null
}

const rootAgentsPromptFile = resolve(workspaceRoot, "AGENTS.md")

export const rootAgentsPromptSource = "AGENTS.md"
export const softStopPromptSource = "@malkier/agent/soft-stop"

const reviewModePattern = /\breview\b/i

const softStopPrompt = [
  "You are approaching the maximum number of model rounds for this request.",
  "Do not call any more tools.",
  "Provide the best possible final response using only the information already gathered.",
  "If work remains, clearly summarize what you completed, what remains uncertain, and the best next step."
].join(" ")

const hashContent = (content: string) => createHash("sha256").update(content).digest("hex")

const isMissingFileError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT"

const makePromptLayer = (kind: PromptLayerKind, source: string, content: string): PromptLayer => {
  const sha256 = hashContent(content)

  return {
    id: `${kind}:${sha256.slice(0, 12)}`,
    kind,
    role: "system",
    source,
    content,
    sha256
  }
}

const appendSystemLayer = (prompt: Prompt.Prompt, layer: PromptLayer): Prompt.Prompt =>
  Prompt.merge(
    prompt,
    Prompt.fromMessages([
      Prompt.makeMessage(layer.role, {
        content: layer.content
      })
    ])
  )

const readPromptFileIfPresent = (filePath: string): string | null => {
  try {
    return readFileSync(filePath, "utf8").trim()
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }
}

export const loadRootAgentsPromptLayer = (filePath = rootAgentsPromptFile): PromptLayer | null => {
  const content = readPromptFileIfPresent(filePath)

  if (content == null || content.length === 0) {
    return null
  }

  return makePromptLayer("repo", rootAgentsPromptSource, content)
}

const subagentPromptSource = (role: string) => `subagent:${role}`

export const loadAvailableSkillSummaryLayer = (): PromptLayer | null => {
  const content = loadAvailableSkillsPrompt()

  if (content == null) {
    return null
  }

  return makePromptLayer("runtime", availableSkillsPromptSource, content)
}

export const loadSelectedSkillPromptLayers = (
  selectedSkills: ReadonlyArray<string>
): ReadonlyArray<PromptLayer> => loadSelectedSkills(selectedSkills).map((skill) =>
  makePromptLayer("skill", skill.source, skill.content)
)

const resolveMode = ({
  messages,
  explicitMode,
  subagentContext
}: Pick<AssemblePromptInput, "messages" | "explicitMode" | "subagentContext">): AgentMode => {
  if (explicitMode !== undefined) {
    return explicitMode
  }

  if (subagentContext != null) {
    return subagentContext.inheritedMode ?? "default"
  }

  return inferModeFromMessages(messages)
}

const resolveSelectedSkills = ({
  selectedSkills,
  subagentContext
}: Pick<AssemblePromptInput, "selectedSkills" | "subagentContext">): ReadonlyArray<string> => {
  if (selectedSkills !== undefined) {
    return [...selectedSkills]
  }

  return [...(subagentContext?.inheritedSkills ?? [])]
}

const makeSubagentOverlayContent = (subagentContext: SubagentContext) => [
  "## Subagent Delegation",
  "",
  "- You are acting as a bounded subagent for the parent agent.",
  `- Your delegated role is: ${subagentContext.role}.`,
  "- Work only from the delegated brief provided below.",
  "- Do not assume access to the full parent transcript.",
  "- Return a compact artifact to the parent instead of a final user-facing answer.",
  "",
  "Required output contract:",
  subagentContext.outputContract
].join("\n")

const makeSubagentPromptLayer = (subagentContext: SubagentContext): PromptLayer =>
  makePromptLayer("subagent", subagentPromptSource(subagentContext.role), makeSubagentOverlayContent(subagentContext))

const makeSubagentBriefPrompt = (subagentContext: SubagentContext): Prompt.Prompt =>
  Prompt.fromMessages([
    Prompt.makeMessage("user", {
      content: [
        Prompt.makePart("text", {
          text: [
            "Delegated task brief from the parent agent:",
            subagentContext.brief
          ].join("\n\n")
        })
      ]
    })
  ])

const inferModeFromMessages = (messages: ReadonlyArray<SessionMessageWithMetadata>): AgentMode => {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")

  if (latestUserMessage == null) {
    return "default"
  }

  return reviewModePattern.test(latestUserMessage.content) ? "review" : "default"
}

export const collectPrompt = (messages: ReadonlyArray<SessionMessageWithMetadata>): Prompt.Prompt => {
  let prompt = Prompt.empty
  let responseParts: EffectResponse.AnyPart[] = []

  const flushResponseParts = () => {
    if (responseParts.length === 0) return

    prompt = Prompt.merge(prompt, Prompt.fromResponseParts(responseParts))
    responseParts = []
  }

  for (const msg of messages) {
    if (msg.metadata?.kind === "tool-call") {
      responseParts.push(EffectResponse.makePart("tool-call", {
        id: msg.metadata.id,
        name: msg.metadata.name,
        params: msg.metadata.params,
        providerExecuted: false
      }))
      continue
    }

    if (msg.metadata?.kind === "tool-result") {
      responseParts.push(EffectResponse.makePart("tool-result", {
        id: msg.metadata.id,
        name: msg.metadata.name,
        result: msg.metadata.result,
        encodedResult: msg.metadata.result,
        isFailure: msg.metadata.isFailure,
        providerExecuted: false
      }))
      continue
    }

    if (msg.role === "assistant" && responseParts.length > 0) {
      responseParts.push(EffectResponse.makePart("text", { text: msg.content }))
      continue
    }

    flushResponseParts()

    prompt = Prompt.merge(
      prompt,
      Prompt.fromMessages([
        Prompt.makeMessage(msg.role, {
          content: [Prompt.makePart("text", { text: msg.content })]
        })
      ])
    )
  }

  flushResponseParts()

  return prompt
}

export const assemblePrompt = ({
  messages,
  explicitMode,
  selectedSkills,
  nearSoftStop,
  subagentContext
}: AssemblePromptInput, options: AssemblePromptOptions = {}): AssembledPrompt => {
  const resolvedMode = resolveMode({ messages, explicitMode, subagentContext })
  const resolvedSkills = resolveSelectedSkills({ selectedSkills, subagentContext })
  const rootAgentsLayer = options.rootAgentsLayer === undefined
    ? loadRootAgentsPromptLayer()
    : options.rootAgentsLayer
  const availableSkillSummaryLayer = loadAvailableSkillSummaryLayer()
  const layers: Array<PromptLayer> = [
    makePromptLayer("base", malkierBaseSystemPromptSource, malkierBaseSystemPrompt)
  ]

  if (rootAgentsLayer !== null) {
    layers.push(rootAgentsLayer)
  }

  if (availableSkillSummaryLayer !== null) {
    layers.push(availableSkillSummaryLayer)
  }

  if (resolvedMode === "review") {
    layers.push(makePromptLayer("mode", reviewModePromptSource, reviewModePrompt))
  }

  layers.push(...loadSelectedSkillPromptLayers(resolvedSkills))

  if (subagentContext != null) {
    layers.push(makeSubagentPromptLayer(subagentContext))
  }

  if (nearSoftStop === true) {
    layers.push(makePromptLayer("soft-stop", softStopPromptSource, softStopPrompt))
  }

  // Subagent runs consume a bounded delegated brief instead of replaying the
  // full parent transcript. The parent must summarize any relevant context.
  const conversationPrompt = subagentContext == null
    ? collectPrompt(messages)
    : makeSubagentBriefPrompt(subagentContext)

  const prompt = Prompt.merge(
    layers.reduce((currentPrompt, layer) => appendSystemLayer(currentPrompt, layer), Prompt.empty),
    conversationPrompt
  )

  return {
    prompt,
    layers,
    resolvedMode,
    selectedSkills: resolvedSkills
  }
}

export class PromptAssembler extends Effect.Service<PromptAssembler>()("PromptAssembler", {
  accessors: true,
  effect: Effect.succeed({
    assemble: Effect.fn("PromptAssembler.assemble")(function* (input: AssemblePromptInput) {
      return assemblePrompt(input)
    })
  })
}) {}
