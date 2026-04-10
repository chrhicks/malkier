import { stat } from "node:fs/promises"
import { isAbsolute, normalize, relative, resolve } from "node:path"
import { Tool, Toolkit } from "@effect/ai"
import { Effect, Schema } from "effect"
import { annotateCurrentSpanAttributes } from "../../observability/span-attributes"
import { workspaceRoot } from "../../workspace-root"

const defaultTimeoutMs = 30_000
const maxOutputChars = 16_000

const ShellToolSuccess = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
  durationMs: Schema.Number
})

const ShellToolFailure = Schema.Struct({
  kind: Schema.Literal("forbidden", "timeout", "non-zero-exit", "spawn-failed"),
  message: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  exitCode: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
  durationMs: Schema.Number
})

type ShellToolFailure = Schema.Schema.Type<typeof ShellToolFailure>
type ShellToolSuccess = Schema.Schema.Type<typeof ShellToolSuccess>

class InvalidCwdError extends Schema.TaggedError<InvalidCwdError>()("InvalidCwdError", {
  message: Schema.String,
  cwd: Schema.NullOr(Schema.String)
}) { }

class BashSpawnError extends Schema.TaggedError<BashSpawnError>()("BashSpawnError", {
  message: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.NullOr(Schema.String)
}) { }

class BashTimeoutError extends Schema.TaggedError<BashTimeoutError>()("BashTimeoutError", {
  message: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
  durationMs: Schema.Number
}) { }

class BashNonZeroExitError extends Schema.TaggedError<BashNonZeroExitError>()("BashNonZeroExitError", {
  message: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  exitCode: Schema.Number,
  signal: Schema.NullOr(Schema.String),
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
  durationMs: Schema.Number
}) { }

type ShellToolTaggedError = InvalidCwdError | BashSpawnError | BashTimeoutError | BashNonZeroExitError

const BashTool = Tool.make("bash", {
  description: "Execute a program inside the workspace with structured stdout, stderr, exit status, and timeout handling.",
  parameters: {
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.NullOr(Schema.String),
    timeoutMs: Schema.Number
  },
  success: ShellToolSuccess,
  failure: ShellToolFailure,
  failureMode: "return"
})

const normalizeWorkspacePath = (path: string) => path.replaceAll("\\", "/")

const sanitizeTimeoutMs = (timeoutMs: number) => {
  if (!Number.isFinite(timeoutMs)) {
    return defaultTimeoutMs
  }

  return Math.max(1, Math.floor(timeoutMs))
}

const truncateOutput = (output: string) => ({
  text: output.length <= maxOutputChars ? output : `${output.slice(0, maxOutputChars)}\n...[truncated]`,
  truncated: output.length > maxOutputChars
})

const readStreamText = (stream: ReadableStream<Uint8Array<ArrayBuffer>>) =>
  new Response(stream).text()

const toShellToolFailure = (error: ShellToolTaggedError): ShellToolFailure => {
  switch (error._tag) {
    case "InvalidCwdError":
      return {
        kind: "forbidden",
        message: error.message,
        command: "",
        args: [],
        cwd: error.cwd,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0
      }
    case "BashSpawnError":
      return {
        kind: "spawn-failed",
        message: error.message,
        command: error.command,
        args: error.args,
        cwd: error.cwd,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0
      }
    case "BashTimeoutError":
      return {
        kind: "timeout",
        message: error.message,
        command: error.command,
        args: error.args,
        cwd: error.cwd,
        exitCode: error.exitCode,
        signal: error.signal,
        stdout: error.stdout,
        stderr: error.stderr,
        stdoutTruncated: error.stdoutTruncated,
        stderrTruncated: error.stderrTruncated,
        durationMs: error.durationMs
      }
    case "BashNonZeroExitError":
      return {
        kind: "non-zero-exit",
        message: error.message,
        command: error.command,
        args: error.args,
        cwd: error.cwd,
        exitCode: error.exitCode,
        signal: error.signal,
        stdout: error.stdout,
        stderr: error.stderr,
        stdoutTruncated: error.stdoutTruncated,
        stderrTruncated: error.stderrTruncated,
        durationMs: error.durationMs
      }
  }
}

const resolveShellCwd = Effect.fn("ShellTools.resolveShellCwd")(function* (cwd: string | null) {
  if (cwd == null) {
    return {
      absolutePath: workspaceRoot,
      workspacePath: "."
    }
  }

  const trimmedPath = cwd.trim()

  if (trimmedPath.length === 0 || isAbsolute(trimmedPath)) {
    return yield* Effect.fail(
      new InvalidCwdError({
        cwd,
        message: "cwd must be a non-empty workspace-relative directory path."
      })
    )
  }

  const absolutePath = resolve(workspaceRoot, normalize(trimmedPath))
  const workspacePath = normalizeWorkspacePath(relative(workspaceRoot, absolutePath))

  if (workspacePath.length === 0 || workspacePath === ".") {
    return {
      absolutePath: workspaceRoot,
      workspacePath: "."
    }
  }

  if (workspacePath.startsWith("../") || workspacePath === "..") {
    return yield* Effect.fail(
      new InvalidCwdError({
        cwd,
        message: "cwd resolves outside the workspace root."
      })
    )
  }

  const pathStat = yield* Effect.tryPromise({
    try: () => stat(absolutePath),
    catch: () =>
      new InvalidCwdError({
        cwd,
        message: `cwd does not exist: ${workspacePath}`
      })
  })

  if (!pathStat.isDirectory()) {
    return yield* Effect.fail(
      new InvalidCwdError({
        cwd,
        message: `cwd is not a directory: ${workspacePath}`
      })
    )
  }

  return {
    absolutePath,
    workspacePath
  }
})

const executeBash = Effect.fn("ShellTools.executeBash")(function* ({
  command,
  args,
  cwd,
  timeoutMs
}: {
  command: string
  args: ReadonlyArray<string>
  cwd: string | null
  timeoutMs: number
}) {
  const normalizedTimeoutMs = sanitizeTimeoutMs(timeoutMs)

  yield* annotateCurrentSpanAttributes({
    "tool.name": "bash",
    "tool.command": command,
    "tool.cwd.requested": cwd ?? ".",
    "tool.timeout_ms": normalizedTimeoutMs,
    "tool.args.count": args.length
  })

  const resolvedCwd = yield* resolveShellCwd(cwd)

  yield* annotateCurrentSpanAttributes({
    "tool.cwd": resolvedCwd.workspacePath,
    "tool.cwd.resolved": resolvedCwd.workspacePath
  })

  return yield* Effect.tryPromise({
    try: async () => {
      const startedAt = Date.now()
      let timedOut = false
      const controller = new AbortController()
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, normalizedTimeoutMs)

      try {
        const subprocess = Bun.spawn({
          cmd: [command, ...args],
          cwd: resolvedCwd.absolutePath,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          signal: controller.signal,
          killSignal: "SIGKILL"
        })

        const [stdout, stderr, exitCode] = await Promise.all([
          readStreamText(subprocess.stdout),
          readStreamText(subprocess.stderr),
          subprocess.exited
        ])

        const durationMs = Date.now() - startedAt
        const truncatedStdout = truncateOutput(stdout)
        const truncatedStderr = truncateOutput(stderr)

        if (timedOut) {
          throw new BashTimeoutError({
            message: `Command timed out after ${normalizedTimeoutMs}ms.`,
            command,
            args: [...args],
            cwd: resolvedCwd.workspacePath,
            exitCode,
            signal: subprocess.signalCode,
            stdout: truncatedStdout.text,
            stderr: truncatedStderr.text,
            stdoutTruncated: truncatedStdout.truncated,
            stderrTruncated: truncatedStderr.truncated,
            durationMs
          })
        }

        if (exitCode !== 0) {
          throw new BashNonZeroExitError({
            message: `Command exited with code ${exitCode}.`,
            command,
            args: [...args],
            cwd: resolvedCwd.workspacePath,
            exitCode,
            signal: subprocess.signalCode,
            stdout: truncatedStdout.text,
            stderr: truncatedStderr.text,
            stdoutTruncated: truncatedStdout.truncated,
            stderrTruncated: truncatedStderr.truncated,
            durationMs
          })
        }

        return {
          command,
          args: [...args],
          cwd: resolvedCwd.workspacePath,
          exitCode,
          stdout: truncatedStdout.text,
          stderr: truncatedStderr.text,
          stdoutTruncated: truncatedStdout.truncated,
          stderrTruncated: truncatedStderr.truncated,
          durationMs
        } satisfies ShellToolSuccess
      } finally {
        clearTimeout(timer)
      }
    },
    catch: (cause) => {
      if (cause instanceof InvalidCwdError || cause instanceof BashSpawnError || cause instanceof BashTimeoutError || cause instanceof BashNonZeroExitError) {
        return cause
      }

      return new BashSpawnError({
        message: `Failed to start command: ${String(cause)}`,
        command,
        args: [...args],
        cwd: resolvedCwd.workspacePath
      })
    }
  })
})

export const ShellToolkit = Toolkit.make(BashTool)

export const makeShellToolkitLayer = () =>
  ShellToolkit.toLayer(
    ShellToolkit.of({
      bash: ({ command, args, cwd, timeoutMs }) =>
        executeBash({ command, args, cwd, timeoutMs }).pipe(
          Effect.tap((result) =>
            annotateCurrentSpanAttributes({
              "tool.result.class": "ok",
              "tool.exit_code": result.exitCode,
              "tool.duration_ms": result.durationMs
            })
          ),
          Effect.catchTags({
            InvalidCwdError: (error) =>
              annotateCurrentSpanAttributes({
                "tool.result.class": "forbidden"
              }).pipe(Effect.zipRight(Effect.fail(toShellToolFailure(error)))),
            BashSpawnError: (error) =>
              annotateCurrentSpanAttributes({
                "tool.result.class": "spawn_failed"
              }).pipe(Effect.zipRight(Effect.fail(toShellToolFailure(error)))),
            BashTimeoutError: (error) =>
              annotateCurrentSpanAttributes({
                "tool.result.class": "timeout",
                "tool.exit_code": error.exitCode ?? undefined,
                "tool.signal": error.signal ?? undefined,
                "tool.duration_ms": error.durationMs
              }).pipe(Effect.zipRight(Effect.fail(toShellToolFailure(error)))),
            BashNonZeroExitError: (error) =>
              annotateCurrentSpanAttributes({
                "tool.result.class": "non_zero_exit",
                "tool.exit_code": error.exitCode,
                "tool.signal": error.signal ?? undefined,
                "tool.duration_ms": error.durationMs
              }).pipe(Effect.zipRight(Effect.fail(toShellToolFailure(error))))
          })
        )
    })
  )
