import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { SessionService } from "../../service/session.service"
import { getAgentTools } from "."

const sessionService = {
  listSessions: () => Effect.succeed([]),
  getSession: () => Effect.die("unused in skill tool tests")
} as unknown as SessionService

describe("skill tools", () => {
  test("lists available skills", async () => {
    const toolkit = await Effect.runPromise(getAgentTools("user-1", sessionService))
    const result = await Effect.runPromise(toolkit.handle("list_skills", {}))

    expect(result.isFailure).toBe(false)

    if (result.isFailure) {
      throw new Error("Expected list_skills success")
    }

    const skills = result.result as ReadonlyArray<{ name: string }>

    expect(Array.isArray(skills)).toBe(true)
    expect(skills.map((skill) => skill.name)).toContain("coding-standards")
  })

  test("loads a skill by name", async () => {
    const toolkit = await Effect.runPromise(getAgentTools("user-1", sessionService))
    const result = await Effect.runPromise(toolkit.handle("load_skill", { name: "coding-standards" }))

    expect(result.isFailure).toBe(false)

    if (result.isFailure) {
      throw new Error("Expected load_skill success")
    }

    const skill = result.result as { name: string, content: string }

    expect(skill.name).toBe("coding-standards")
    expect(skill.content).toContain("## Code Standard Principles")
  })

  test("returns a structured failure for a missing skill", async () => {
    const toolkit = await Effect.runPromise(getAgentTools("user-1", sessionService))
    const result = await Effect.runPromise(
      toolkit.handle("load_skill", { name: `missing-skill-${crypto.randomUUID()}` })
    )

    expect(result).toEqual({
      isFailure: true,
      result: {
        kind: "not-found",
        message: expect.stringContaining("Skill not found")
      },
      encodedResult: {
        kind: "not-found",
        message: expect.stringContaining("Skill not found")
      }
    })
  })
})
