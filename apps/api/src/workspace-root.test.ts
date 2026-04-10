import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { findWorkspaceRoot, workspaceRoot } from "./workspace-root"

describe("workspaceRoot", () => {
  test("resolves the repo root from the helper module", () => {
    expect(existsSync(resolve(workspaceRoot, ".git"))).toBe(true)
    expect(existsSync(resolve(workspaceRoot, "AGENTS.md"))).toBe(true)
  })

  test("walks upward from a nested API directory", () => {
    const nestedDirectory = resolve(workspaceRoot, "apps/api/src/agent/tools")

    expect(findWorkspaceRoot(nestedDirectory)).toBe(workspaceRoot)
  })
})
