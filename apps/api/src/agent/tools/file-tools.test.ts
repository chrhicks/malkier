import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FileToolkit, makeFileToolkitLayer } from "./file-tools"
import type { SessionService } from "../../service/session.service"
import { getAgentTools } from "."

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

  test("keeps mutation tools stubbed until their task is implemented", async () => {
    const toolkit = await getFileToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("apply_patch", {
        patch: "*** Begin Patch\n*** Update File: foo.ts\n*** End Patch",
        expectedSnapshots: []
      })
    )

    expect(result).toEqual({
      isFailure: false,
      result: {
        status: "guidance",
        message: "apply_patch is specified but not implemented yet.",
        data: {
          reason: "not-implemented",
          files: []
        },
        hints: [
          {
            code: "stub-contract",
            message: "This file tool is currently a typed stub. Implement the handler before exposing it in the live agent toolkit.",
            suggestedTool: null,
            suggestedArgs: null
          }
        ]
      },
      encodedResult: {
        status: "guidance",
        message: "apply_patch is specified but not implemented yet.",
        data: {
          reason: "not-implemented",
          files: []
        },
        hints: [
          {
            code: "stub-contract",
            message: "This file tool is currently a typed stub. Implement the handler before exposing it in the live agent toolkit.",
            suggestedTool: null,
            suggestedArgs: null
          }
        ]
      }
    })
  })
})
