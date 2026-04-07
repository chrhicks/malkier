import { describe, expect, test } from "bun:test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { Effect } from "effect"
import { FileToolkit, makeFileToolkitLayer } from "./file-tools"
import type { SessionService } from "../../service/session.service"
import { getAgentTools } from "."

const workspaceRoot = resolve(import.meta.dirname, "../../../../..")

const getAgentToolkit = () =>
  Effect.runPromise(getAgentTools("user-1", {
    listSessions: () => Effect.succeed([]),
    getSession: () => Effect.die("unused in file tool tests")
  } as unknown as SessionService))

const getFileToolkit = () =>
  Effect.runPromise(
    FileToolkit.pipe(
      Effect.provide(makeFileToolkitLayer())
    )
  )

const withTestWorkspace = async <A>(run: (workspacePath: string) => Promise<A>) => {
  const workspacePath = `apps/api/src/agent/tools/test-workspace/${crypto.randomUUID()}`
  const absolutePath = resolve(workspaceRoot, workspacePath)

  await mkdir(absolutePath, { recursive: true })

  try {
    return await run(workspacePath)
  } finally {
    await rm(absolutePath, { recursive: true, force: true })
  }
}

const writeWorkspaceTextFile = async (workspacePath: string, content: string) => {
  const absolutePath = resolve(workspaceRoot, workspacePath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, "utf-8")
}

const readWorkspaceTextFile = async (workspacePath: string) =>
  readFile(resolve(workspaceRoot, workspacePath), "utf-8")

const readSnapshotId = async (
  toolkit: Awaited<ReturnType<typeof getFileToolkit>>,
  path: string
) => {
  const result = await Effect.runPromise(
    toolkit.handle("read_file", {
      path,
      startLine: 1,
      maxLines: 200
    })
  )

  expect(result.isFailure).toBe(false)
  if (result.isFailure || "kind" in result.result || result.result.status !== "success") {
    throw new Error(`Expected read_file success for ${path}`)
  }

  return result.result.data.snapshotId
}

describe("getAgentTools file inspection", () => {
  test("reads README from the project root and returns a snapshot id", async () => {
    const toolkit = await getAgentToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("read_file", {
        path: "README.md",
        startLine: 1,
        maxLines: 40
      })
    )

    expect(result.isFailure).toBe(false)
    if (result.isFailure || "kind" in result.result) {
      return
    }

    expect(result.result.status).toBe("success")
    expect(result.result.data.path).toBe("README.md")
    expect(result.result.data.snapshotId.length).toBeGreaterThan(0)
    expect(result.result.data.content).toContain("bun install")
    expect(result.result.data.startLine).toBe(1)
    expect(result.result.data.endLine).toBeGreaterThan(1)
  })

  test("lists root-level project files without surfacing gitignored paths", async () => {
    const toolkit = await getAgentToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("glob_files", {
        pattern: "**/*",
        basePath: null,
        maxResults: 50
      })
    )

    expect(result.isFailure).toBe(false)
    if (result.isFailure || "kind" in result.result) {
      return
    }

    expect(result.result.status).toBe("success")
    expect(result.result.data.files).toContain("README.md")
    expect(result.result.data.files).toContain("package.json")
    expect(result.result.data.files).not.toContain(".env")
    expect(result.result.data.files.some((path) => path.startsWith(".continuum/"))).toBe(false)
    expect(result.result.data.files.some((path) => path.startsWith(".agents/"))).toBe(false)
  })

  test("searches from the repo root without scanning ignored trees", async () => {
    const toolkit = await getAgentToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("search_code", {
        query: "TODO",
        basePath: null,
        include: null,
        caseSensitive: false,
        maxResults: 20
      })
    )

    expect(result.isFailure).toBe(false)
    if (result.isFailure || "kind" in result.result) {
      return
    }

    expect(result.result.status).toBe("success")
    expect(result.result.data.query).toBe("TODO")
    expect(
      result.result.data.matches.every((match: { path: string }) => !match.path.startsWith(".agents/"))
    ).toBe(true)
  })

  test("blocks direct reads of gitignored files", async () => {
    const toolkit = await getAgentToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("read_file", {
        path: ".env",
        startLine: 1,
        maxLines: 20
      })
    )

    expect(result).toEqual({
      isFailure: true,
      result: {
        kind: "ignored-path",
        message: "Path is ignored by inspection rules: .env",
        path: ".env"
      },
      encodedResult: {
        kind: "ignored-path",
        message: "Path is ignored by inspection rules: .env",
        path: ".env"
      }
    })
  })
})

describe("file mutation tools", () => {
  test("getAgentTools exposes write_file for live agent use", async () => {
    const toolkit = await getAgentToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/nested/example.ts`
      const content = "export const answer = 42\n"
      const result = await Effect.runPromise(
        toolkit.handle("write_file", {
          path: filePath,
          content,
          intent: "create",
          baseSnapshotId: null,
          createParents: true
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("success")
      if (result.result.status !== "success") {
        throw new Error("Expected write_file create success")
      }

      expect(result.result.data.path).toBe(filePath)
      expect(result.result.data.action).toBe("created")
      expect(result.result.data.lineCount).toBe(1)
      expect(result.result.data.createdParents).toEqual([
        `${workspacePath}/nested`
      ])
      expect(result.encodedResult).toEqual(result.result)
      expect(await readWorkspaceTextFile(filePath)).toBe(content)
    })
  })

  test("write_file requires a current snapshot before replacing an existing file", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/replace-me.ts`
      await writeWorkspaceTextFile(filePath, "export const value = 1\n")

      const result = await Effect.runPromise(
        toolkit.handle("write_file", {
          path: filePath,
          content: "export const value = 2\n",
          intent: "replace",
          baseSnapshotId: null,
          createParents: false
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("guidance")
      if (result.result.status !== "guidance") {
        throw new Error("Expected write_file replace guidance")
      }

      expect(result.result.data.reason).toBe("read-before-replace")
      expect(result.result.data.currentSnapshotId).not.toBeNull()
      expect(result.result.hints[0]?.suggestedTool).toBe("read_file")
      expect(await readWorkspaceTextFile(filePath)).toBe("export const value = 1\n")
    })
  })

  test("write_file detects stale snapshots before replacing a file", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/stale.ts`
      await writeWorkspaceTextFile(filePath, "export const version = 1\n")
      const snapshotId = await readSnapshotId(toolkit, filePath)
      await writeWorkspaceTextFile(filePath, "export const version = 2\n")

      const result = await Effect.runPromise(
        toolkit.handle("write_file", {
          path: filePath,
          content: "export const version = 3\n",
          intent: "replace",
          baseSnapshotId: snapshotId,
          createParents: false
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("guidance")
      if (result.result.status !== "guidance") {
        throw new Error("Expected write_file stale snapshot guidance")
      }

      expect(result.result.data.reason).toBe("stale-snapshot")
      expect(result.result.data.currentSnapshotId).not.toBe(snapshotId)
      expect(await readWorkspaceTextFile(filePath)).toBe("export const version = 2\n")
    })
  })

  test("apply_patch updates a file when the snapshot and context match", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/patch.ts`
      await writeWorkspaceTextFile(filePath, [
        'export const answer = 1',
        'export const label = "old"',
        ''
      ].join("\n"))
      const snapshotId = await readSnapshotId(toolkit, filePath)

      const result = await Effect.runPromise(
        toolkit.handle("apply_patch", {
          patch: [
            "*** Begin Patch",
            `*** Update File: ${filePath}`,
            "@@",
            " export const answer = 1",
            '-export const label = "old"',
            '+export const label = "new"',
            "*** End Patch"
          ].join("\n"),
          expectedSnapshots: [{ path: filePath, snapshotId }]
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("success")
      if (result.result.status !== "success") {
        throw new Error("Expected apply_patch success")
      }

      const files = result.result.data.files
      expect(files).toHaveLength(1)
      expect(files[0]).toMatchObject({
        path: filePath,
        action: "updated",
        addedLines: 1,
        removedLines: 1,
        snapshotId: files[0]?.snapshotId ?? ""
      })
      expect(files[0]?.unifiedDiff).toContain("-export const label = \"old\"")
      expect(files[0]?.unifiedDiff).toContain("+export const label = \"new\"")
      expect(await readWorkspaceTextFile(filePath)).toBe([
        'export const answer = 1',
        'export const label = "new"',
        ''
      ].join("\n"))
    })
  })

  test("apply_patch accepts a trailing newline after the patch envelope", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/patch-trailing-newline.ts`
      await writeWorkspaceTextFile(filePath, [
        'export const value = "old"',
        ''
      ].join("\n"))
      const snapshotId = await readSnapshotId(toolkit, filePath)

      const result = await Effect.runPromise(
        toolkit.handle("apply_patch", {
          patch: [
            "*** Begin Patch",
            `*** Update File: ${filePath}`,
            "@@",
            '-export const value = "old"',
            '+export const value = "new"',
            "*** End Patch"
          ].join("\n") + "\n",
          expectedSnapshots: [{ path: filePath, snapshotId }]
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("success")
      expect(await readWorkspaceTextFile(filePath)).toBe([
        'export const value = "new"',
        ''
      ].join("\n"))
    })
  })

  test("apply_patch accepts CRLF-terminated patch envelopes", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/patch-crlf.ts`
      await writeWorkspaceTextFile(filePath, [
        'export const value = "old"',
        ''
      ].join("\n"))
      const snapshotId = await readSnapshotId(toolkit, filePath)

      const result = await Effect.runPromise(
        toolkit.handle("apply_patch", {
          patch: [
            "*** Begin Patch",
            `*** Update File: ${filePath}`,
            "@@",
            '-export const value = "old"',
            '+export const value = "new"',
            "*** End Patch"
          ].join("\r\n") + "\r\n",
          expectedSnapshots: [{ path: filePath, snapshotId }]
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("success")
      expect(await readWorkspaceTextFile(filePath)).toBe([
        'export const value = "new"',
        ''
      ].join("\n"))
    })
  })

  test("apply_patch accepts trailing blank lines after the patch envelope", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/patch-trailing-blank-lines.ts`
      await writeWorkspaceTextFile(filePath, [
        'export const value = "old"',
        ''
      ].join("\n"))
      const snapshotId = await readSnapshotId(toolkit, filePath)

      const result = await Effect.runPromise(
        toolkit.handle("apply_patch", {
          patch: [
            "*** Begin Patch",
            `*** Update File: ${filePath}`,
            "@@",
            '-export const value = "old"',
            '+export const value = "new"',
            "*** End Patch"
          ].join("\n") + "\n\n",
          expectedSnapshots: [{ path: filePath, snapshotId }]
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("success")
      expect(await readWorkspaceTextFile(filePath)).toBe([
        'export const value = "new"',
        ''
      ].join("\n"))
    })
  })

  test("read_file reports visible line counts without counting the trailing newline as a separate line", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/line-counts.txt`
      const content = [
        "alpha",
        "beta",
        "gamma",
        ""
      ].join("\n")
      await writeWorkspaceTextFile(filePath, content)

      const result = await Effect.runPromise(
        toolkit.handle("read_file", {
          path: filePath,
          startLine: 1,
          maxLines: 20
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("success")
      if (result.result.status !== "success") {
        throw new Error("Expected read_file success")
      }

      expect(result.result.data.totalLines).toBe(3)
      expect(result.result.data.endLine).toBe(3)
      expect(result.result.data.content).toBe(content)
    })
  })

  test("apply_patch reports patch-context-not-found without implying the snapshot is stale", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/patch-mismatch.txt`
      await writeWorkspaceTextFile(filePath, [
        "alpha",
        "beta",
        ""
      ].join("\n"))
      const snapshotId = await readSnapshotId(toolkit, filePath)

      const result = await Effect.runPromise(
        toolkit.handle("apply_patch", {
          patch: [
            "*** Begin Patch",
            `*** Update File: ${filePath}`,
            "@@",
            "-does not exist",
            "+replacement",
            "*** End Patch"
          ].join("\n"),
          expectedSnapshots: [{ path: filePath, snapshotId }]
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("guidance")
      if (result.result.status !== "guidance") {
        throw new Error("Expected apply_patch mismatch guidance")
      }

      expect(result.result.message).toBe(
        "apply_patch could not find the requested patch context in the current file contents."
      )
      expect(result.result.data.reason).toBe("patch-context-not-found")
      expect(result.result.data.files).toEqual([
        {
          path: filePath,
          reason: "patch-context-not-found"
        }
      ])
    })
  })

  test("apply_patch reports patch-context-ambiguous when the patch matches multiple locations", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/patch-ambiguous.txt`
      await writeWorkspaceTextFile(filePath, [
        "alpha",
        "target",
        "beta",
        "target",
        "gamma",
        ""
      ].join("\n"))
      const snapshotId = await readSnapshotId(toolkit, filePath)

      const result = await Effect.runPromise(
        toolkit.handle("apply_patch", {
          patch: [
            "*** Begin Patch",
            `*** Update File: ${filePath}`,
            "@@",
            "-target",
            "+replacement",
            "*** End Patch"
          ].join("\n"),
          expectedSnapshots: [{ path: filePath, snapshotId }]
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("guidance")
      if (result.result.status !== "guidance") {
        throw new Error("Expected apply_patch ambiguity guidance")
      }

      expect(result.result.message).toBe(
        "apply_patch found multiple matches for the requested patch context in the current file contents."
      )
      expect(result.result.data.reason).toBe("patch-context-ambiguous")
      expect(result.result.data.files).toEqual([
        {
          path: filePath,
          reason: "patch-context-ambiguous"
        }
      ])
    })
  })

  test("apply_patch guides the agent to read a file before patching it", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/needs-read.ts`
      await writeWorkspaceTextFile(filePath, "export const ready = true\n")

      const result = await Effect.runPromise(
        toolkit.handle("apply_patch", {
          patch: [
            "*** Begin Patch",
            `*** Update File: ${filePath}`,
            "@@",
            "-export const ready = true",
            "+export const ready = false",
            "*** End Patch"
          ].join("\n"),
          expectedSnapshots: []
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("guidance")
      if (result.result.status !== "guidance") {
        throw new Error("Expected apply_patch guidance for missing context")
      }

      expect(result.result.data.reason).toBe("missing-read-context")
      expect(result.result.data.files).toEqual([
        {
          path: filePath,
          reason: "missing-read-context"
        }
      ])
      expect(result.result.hints[0]?.suggestedTool).toBe("read_file")
    })
  })

  test("apply_patch redirects file creation to write_file", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/new-file.ts`

      const result = await Effect.runPromise(
        toolkit.handle("apply_patch", {
          patch: [
            "*** Begin Patch",
            `*** Add File: ${filePath}`,
            "+export const created = true",
            "*** End Patch"
          ].join("\n"),
          expectedSnapshots: []
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("guidance")
      if (result.result.status !== "guidance") {
        throw new Error("Expected apply_patch guidance for add file")
      }

      expect(result.result.data.reason).toBe("create-not-allowed")
      expect(result.result.data.files).toEqual([
        {
          path: filePath,
          reason: "create-not-allowed"
        }
      ])
      expect(result.result.hints[0]?.suggestedTool).toBe("write_file")
    })
  })

  test("delete_file deletes a file after snapshot validation", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/delete-me.ts`
      await writeWorkspaceTextFile(filePath, "export const doomed = true\n")
      const snapshotId = await readSnapshotId(toolkit, filePath)

      const result = await Effect.runPromise(
        toolkit.handle("delete_file", {
          path: filePath,
          baseSnapshotId: snapshotId
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result).toEqual({
        status: "success",
        message: `Deleted ${filePath}.`,
        data: {
          path: filePath,
          action: "deleted"
        },
        hints: []
      })
    })
  })

  test("delete_file requires a recent read before removing an existing file", async () => {
    const toolkit = await getFileToolkit()

    await withTestWorkspace(async (workspacePath) => {
      const filePath = `${workspacePath}/needs-delete-read.ts`
      await writeWorkspaceTextFile(filePath, "export const doomed = true\n")

      const result = await Effect.runPromise(
        toolkit.handle("delete_file", {
          path: filePath,
          baseSnapshotId: null
        })
      )

      expect(result.isFailure).toBe(false)
      if (result.isFailure || "kind" in result.result) {
        return
      }

      expect(result.result.status).toBe("guidance")
      if (result.result.status !== "guidance") {
        throw new Error("Expected delete_file guidance")
      }

      expect(result.result.data.reason).toBe("read-before-delete")
      expect(result.result.data.currentSnapshotId).not.toBeNull()
      expect(result.result.hints[0]?.suggestedTool).toBe("read_file")
    })
  })
})
