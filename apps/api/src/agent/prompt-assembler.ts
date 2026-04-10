import { createHash } from "node:crypto"
import { Prompt, Response as EffectResponse } from "@effect/ai"
import { Effect } from "effect"
import { malkierBaseSystemPrompt, malkierBaseSystemPromptSource } from "./prompts/base-system-prompt"
import type { SessionMessageWithMetadata } from "../service/session.service"

export type PromptLayerKind = "base" | "runtime" | "repo" | "mode" | "skill" | "subagent" | "soft-stop"

export type AgentMode = "default" | "review"

export type SubagentContext = {
  readonly source: string
  readonly content: string
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

export const softStopPromptSource = "@malkier/agent/soft-stop"

const softStopPrompt = [
  "You are approaching the maximum number of model rounds for this request.",
  "Do not call any more tools.",
  "Provide the best possible final response using only the information already gathered.",
  "If work remains, clearly summarize what you completed, what remains uncertain, and the best next step."
].join(" ")

const hashContent = (content: string) => createHash("sha256").update(content).digest("hex")

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
  nearSoftStop
}: AssemblePromptInput): AssembledPrompt => {
  const resolvedMode = explicitMode ?? "default"
  const resolvedSkills = [...(selectedSkills ?? [])]
  const layers: Array<PromptLayer> = [
    makePromptLayer("base", malkierBaseSystemPromptSource, malkierBaseSystemPrompt)
  ]

  if (nearSoftStop === true) {
    layers.push(makePromptLayer("soft-stop", softStopPromptSource, softStopPrompt))
  }

  const prompt = Prompt.merge(
    layers.reduce((currentPrompt, layer) => appendSystemLayer(currentPrompt, layer), Prompt.empty),
    collectPrompt(messages)
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
