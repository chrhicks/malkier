import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellToolkit, makeShellToolkitLayer } from "./shell-tools"

const getToolkit = () =>
  Effect.runPromise(
    ShellToolkit.pipe(
      Effect.provide(makeShellToolkitLayer())
    )
  )

describe("ShellToolkit", () => {
  test("executes a command in the workspace and returns structured output", async () => {
    const toolkit = await getToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("bash", {
        command: "pwd",
        args: [],
        cwd: null,
        timeoutMs: 5_000
      })
    )

    expect(result.isFailure).toBe(false)
    if (result.isFailure || "kind" in result.result) {
      return
    }

    expect(result.result.cwd).toBe(".")
    expect(result.result.exitCode).toBe(0)
    expect(result.result.stdout).toContain("/home/chicks/workspaces/malkier")
  })

  test("returns structured failures for non-zero exits", async () => {
    const toolkit = await getToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("bash", {
        command: "sh",
        args: ["-c", "printf 'stdout-text'; printf 'stderr-text' >&2; exit 7"],
        cwd: null,
        timeoutMs: 5_000
      })
    )

    expect(result.isFailure).toBe(true)
    if (!result.isFailure || !("kind" in result.result)) {
      return
    }

    expect(result.result.kind).toBe("non-zero-exit")
    expect(result.result.message).toBe("Command exited with code 7.")
    expect(result.result.command).toBe("sh")
    expect(result.result.args).toEqual(["-c", "printf 'stdout-text'; printf 'stderr-text' >&2; exit 7"])
    expect(result.result.cwd).toBe(".")
    expect(result.result.exitCode).toBe(7)
    expect(result.result.signal).toBe(null)
    expect(result.result.stdout).toBe("stdout-text")
    expect(result.result.stderr).toBe("stderr-text")
    expect(result.result.stdoutTruncated).toBe(false)
    expect(result.result.stderrTruncated).toBe(false)
    expect(result.result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("returns structured failures for invalid cwd", async () => {
    const toolkit = await getToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("bash", {
        command: "pwd",
        args: [],
        cwd: "../",
        timeoutMs: 5_000
      })
    )

    expect(result).toEqual({
      isFailure: true,
      result: {
        kind: "forbidden",
        message: "cwd resolves outside the workspace root.",
        command: "",
        args: [],
        cwd: "../",
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0
      },
      encodedResult: {
        kind: "forbidden",
        message: "cwd resolves outside the workspace root.",
        command: "",
        args: [],
        cwd: "../",
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0
      }
    })
  })

  test("returns structured failures for timeouts", async () => {
    const toolkit = await getToolkit()
    const result = await Effect.runPromise(
      toolkit.handle("bash", {
        command: "sh",
        args: ["-c", "sleep 1"],
        cwd: null,
        timeoutMs: 50
      })
    )

    expect(result.isFailure).toBe(true)
    if (!result.isFailure || !("kind" in result.result)) {
      return
    }

    expect(result.result.kind).toBe("timeout")
    expect(result.result.command).toBe("sh")
    expect(result.result.cwd).toBe(".")
    expect(result.result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
