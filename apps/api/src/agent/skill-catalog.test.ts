import { describe, expect, test } from "bun:test"
import {
  buildAvailableSkillsPrompt,
  listAvailableSkills,
  loadAvailableSkillsPrompt,
  loadSkillByName,
  loadSelectedSkills
} from "./skill-catalog"

describe("skill catalog", () => {
  test("lists available skills with descriptions", () => {
    const skills = listAvailableSkills()

    expect(skills.length).toBeGreaterThan(0)
    expect(skills.map((skill) => skill.name)).toContain("coding-standards")
    expect(skills.find((skill) => skill.name === "malkier-ui")?.description).toContain("SolidJS frontend")
  })

  test("builds a compact available-skills prompt", () => {
    const prompt = loadAvailableSkillsPrompt()

    expect(prompt).not.toBeNull()
    expect(prompt).toContain("## Available Skills")
    expect(prompt).toContain("`coding-standards`")
    expect(prompt).toContain("Load a skill when its description clearly matches the current task")
  })

  test("loads selected skills in request order and skips missing ones", () => {
    const skills = loadSelectedSkills(["missing-skill", "coding-standards", "malkier-ui"])

    expect(skills.map((skill) => skill.name)).toEqual(["coding-standards", "malkier-ui"])
  })

  test("loads a single skill by name", () => {
    const skill = loadSkillByName("coding-standards")

    expect(skill).not.toBeNull()
    expect(skill?.source).toBe(".agents/skills/coding-standards/SKILL.md")
    expect(skill?.content).toContain("## Code Standard Principles")
  })

  test("returns null for a missing skill", () => {
    expect(loadSkillByName(`missing-skill-${crypto.randomUUID()}`)).toBeNull()
  })

  test("returns null when building a prompt for an empty catalog", () => {
    expect(buildAvailableSkillsPrompt([])).toBeNull()
  })
})
