import { Tool, Toolkit } from "@effect/ai";
import { Effect, Schema } from "effect";

const ShellToolFailure = Schema.Struct({
  kind: Schema.Literal('forbidden', 'timeout', 'non-zero-exit', 'spawn-failed'),
  message: Schema.String
})

const BashTool = Tool.make('bash', {
  description: 'Execute shell commands to view the filesystem, run scripts and interact with the host operating system.',
  parameters: {
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.NullOr(Schema.String),
    timeoutMs: Schema.Number
  },
  success: Schema.String,
  failure: ShellToolFailure,
  failureMode: 'return'
})

export const ShellToolkit = Toolkit.make(BashTool)

export const makeShellToolkitLayer = () =>
  ShellToolkit.toLayer(
    ShellToolkit.of({
      bash: ({ command, args, cwd, timeoutMs }) =>
        Effect.sync(() => {
          return `Bash command stub. Not Fully Implemented. Report back to user that this tool ran successfully but still needs to be implemented
          cwd: ${cwd ?? "<default>"} timeout: ${timeoutMs} ${command} ${args?.join(" ")}
          `
        })
    })
  )