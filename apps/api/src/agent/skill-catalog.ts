import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { workspaceRoot } from "../workspace-root"

export type SkillCatalogEntry = {
  readonly name: string
  readonly description: string
  readonly source: string
  readonly content: string
}

export type AvailableSkill = Omit<SkillCatalogEntry, "content">

const skillsRoot = resolve(workspaceRoot, ".agents/skills")
const frontmatterDelimiter = "---"

export const availableSkillsPromptSource = "@malkier/agent/available-skills"

const trimWrappedQuotes = (value: string) => value.replace(/^['"]|['"]$/g, "")

const parseFrontmatter = (content: string): Record<string, string> => {
  const lines = content.split(/\r?\n/)

  if (lines[0] !== frontmatterDelimiter) {
    return {}
  }

  const frontmatter: Record<string, string> = {}

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]

    if (line == null) {
      continue
    }

    if (line === frontmatterDelimiter) {
      return frontmatter
    }

    if (/^\s/.test(line)) {
      continue
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)

    if (match == null) {
      continue
    }

    const [, key, value] = match

    if (key == null || value == null) {
      continue
    }

    frontmatter[key] = trimWrappedQuotes(value.trim())
  }

  return {}
}

const readSkillFileIfPresent = (skillName: string): string | null => {
  try {
    return readFileSync(resolve(skillsRoot, skillName, "SKILL.md"), "utf8").trim()
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null
    }

    throw error
  }
}

const readSkillCatalogEntry = (skillName: string): SkillCatalogEntry | null => {
  const content = readSkillFileIfPresent(skillName)

  if (content == null || content.length === 0) {
    return null
  }

  const frontmatter = parseFrontmatter(content)

  return {
    name: frontmatter.name?.trim() || skillName,
    description: frontmatter.description?.trim() || "No description provided.",
    source: `.agents/skills/${skillName}/SKILL.md`,
    content
  }
}

const listSkillDirectoryNames = (): ReadonlyArray<string> =>
  {
    try {
      return readdirSync(skillsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right))
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT"
      ) {
        return []
      }

      throw error
    }
  }

export const listAvailableSkills = (): ReadonlyArray<AvailableSkill> =>
  listSkillDirectoryNames().flatMap((skillName) => {
    const entry = readSkillCatalogEntry(skillName)

    if (entry == null) {
      return []
    }

    return [{
      name: entry.name,
      description: entry.description,
      source: entry.source
    }]
  })

export const loadSkillByName = (skillName: string): SkillCatalogEntry | null => readSkillCatalogEntry(skillName)

export const loadSelectedSkills = (selectedSkills: ReadonlyArray<string>): ReadonlyArray<SkillCatalogEntry> =>
  selectedSkills.flatMap((skillName) => {
    const entry = readSkillCatalogEntry(skillName)

    return entry == null ? [] : [entry]
  })

export const buildAvailableSkillsPrompt = (skills: ReadonlyArray<AvailableSkill>): string | null => {
  if (skills.length === 0) {
    return null
  }

  return [
    "## Available Skills",
    "",
    "These are specialized instruction packs available in this workspace.",
    "Load a skill when its description clearly matches the current task or when the user asks for that workflow by name.",
    "Do not load irrelevant skills just because they are available.",
    "",
    ...skills.map((skill) => `- \`${skill.name}\`: ${skill.description}`)
  ].join("\n")
}

export const loadAvailableSkillsPrompt = (): string | null => buildAvailableSkillsPrompt(listAvailableSkills())
