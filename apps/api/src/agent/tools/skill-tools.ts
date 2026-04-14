import { Tool, Toolkit } from "@effect/ai"
import { Effect, Schema } from "effect"
import { listAvailableSkills, loadSkillByName } from "../skill-catalog"

const SkillToolFailure = Schema.Struct({
  kind: Schema.Literal("not-found", "internal"),
  message: Schema.String
})

const SkillSummary = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  source: Schema.String
})

const ListSkills = Tool.make("list_skills", {
  description: "List the available workspace skills with a short description of when to use them",
  success: Schema.Array(SkillSummary),
  failure: SkillToolFailure,
  failureMode: "return"
})

const LoadSkill = Tool.make("load_skill", {
  description: "Load the full instructions for a named workspace skill when it is relevant to the current task",
  parameters: {
    name: Schema.String
  },
  success: SkillSummary.pipe(Schema.extend(Schema.Struct({
    content: Schema.String
  }))),
  failure: SkillToolFailure,
  failureMode: "return"
})

export const SkillToolkit = Toolkit.make(ListSkills, LoadSkill)

export const makeSkillToolkitLayer = () =>
  SkillToolkit.toLayer({
    list_skills: () =>
      Effect.try({
        try: () => [...listAvailableSkills()],
        catch: () => ({ kind: "internal" as const, message: "Unable to list workspace skills right now." })
      }),

    load_skill: ({ name }) =>
      Effect.try({
        try: () => loadSkillByName(name),
        catch: () => ({ kind: "internal" as const, message: `Unable to load skill ${name} right now.` })
      }).pipe(
        Effect.flatMap((skill) =>
          skill == null
            ? Effect.fail({ kind: "not-found" as const, message: `Skill not found: ${name}` })
            : Effect.succeed(skill)
        )
      )
  })
