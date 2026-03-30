import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import { isAbsolute, normalize, relative, resolve } from "node:path"
import { Tool, Toolkit } from "@effect/ai"
import { Effect, Schema } from "effect"

const workspaceRoot = resolve(import.meta.dirname, "../../../../..")
const gitignorePath = resolve(workspaceRoot, ".gitignore")
const defaultReadLines = 200
const defaultGlobResults = 200
const defaultSearchResults = 100
const maxSearchLineLength = 300

export const SnapshotId = Schema.String
export type SnapshotId = Schema.Schema.Type<typeof SnapshotId>

export const FileToolName = Schema.Literal(
  "glob_files",
  "search_code",
  "read_file",
  "write_file",
  "apply_patch",
  "delete_file"
)
export type FileToolName = Schema.Schema.Type<typeof FileToolName>

export const ToolHintSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  suggestedTool: Schema.NullOr(FileToolName),
  suggestedArgs: Schema.NullOr(Schema.Unknown)
})
export type ToolHint = Schema.Schema.Type<typeof ToolHintSchema>

export const FileToolFailureSchema = Schema.Struct({
  kind: Schema.Literal(
    "invalid-path",
    "outside-workspace",
    "ignored-path",
    "not-found",
    "already-exists",
    "binary-file",
    "invalid-patch",
    "io-error"
  ),
  message: Schema.String,
  path: Schema.NullOr(Schema.String)
})
export type FileToolFailure = Schema.Schema.Type<typeof FileToolFailureSchema>

export class InvalidPathError extends Schema.TaggedError<InvalidPathError>()(
  "InvalidPathError",
  {
    path: Schema.String,
    message: Schema.String
  }
) { }

export class OutsideWorkspaceError extends Schema.TaggedError<OutsideWorkspaceError>()(
  "OutsideWorkspaceError",
  {
    path: Schema.String,
    message: Schema.String
  }
) { }

export class FileNotFoundError extends Schema.TaggedError<FileNotFoundError>()(
  "FileNotFoundError",
  {
    path: Schema.String,
    message: Schema.String
  }
) { }

export class IgnoredPathError extends Schema.TaggedError<IgnoredPathError>()(
  "IgnoredPathError",
  {
    path: Schema.String,
    message: Schema.String
  }
) { }

export class FileAlreadyExistsError extends Schema.TaggedError<FileAlreadyExistsError>()(
  "FileAlreadyExistsError",
  {
    path: Schema.String,
    message: Schema.String
  }
) { }

export class BinaryFileError extends Schema.TaggedError<BinaryFileError>()(
  "BinaryFileError",
  {
    path: Schema.String,
    message: Schema.String
  }
) { }

export class InvalidPatchError extends Schema.TaggedError<InvalidPatchError>()(
  "InvalidPatchError",
  {
    path: Schema.NullOr(Schema.String),
    message: Schema.String
  }
) { }

export class FileIoError extends Schema.TaggedError<FileIoError>()(
  "FileIoError",
  {
    path: Schema.NullOr(Schema.String),
    message: Schema.String
  }
) { }

export type FileToolTaggedError =
  | InvalidPathError
  | OutsideWorkspaceError
  | IgnoredPathError
  | FileNotFoundError
  | FileAlreadyExistsError
  | BinaryFileError
  | InvalidPatchError
  | FileIoError

export const toFileToolFailure = (error: FileToolTaggedError): FileToolFailure => {
  switch (error._tag) {
    case "InvalidPathError":
      return { kind: "invalid-path", message: error.message, path: error.path }
    case "OutsideWorkspaceError":
      return { kind: "outside-workspace", message: error.message, path: error.path }
    case "IgnoredPathError":
      return { kind: "ignored-path", message: error.message, path: error.path }
    case "FileNotFoundError":
      return { kind: "not-found", message: error.message, path: error.path }
    case "FileAlreadyExistsError":
      return { kind: "already-exists", message: error.message, path: error.path }
    case "BinaryFileError":
      return { kind: "binary-file", message: error.message, path: error.path }
    case "InvalidPatchError":
      return { kind: "invalid-patch", message: error.message, path: error.path }
    case "FileIoError":
      return { kind: "io-error", message: error.message, path: error.path }
  }
}

const catchFileToolErrors = <A>(
  effect: Effect.Effect<A, FileToolTaggedError>
): Effect.Effect<A, FileToolFailure> =>
  effect.pipe(
    Effect.catchTags({
      InvalidPathError: (error) => Effect.fail(toFileToolFailure(error)),
      OutsideWorkspaceError: (error) => Effect.fail(toFileToolFailure(error)),
      IgnoredPathError: (error) => Effect.fail(toFileToolFailure(error)),
      FileNotFoundError: (error) => Effect.fail(toFileToolFailure(error)),
      FileAlreadyExistsError: (error) => Effect.fail(toFileToolFailure(error)),
      BinaryFileError: (error) => Effect.fail(toFileToolFailure(error)),
      InvalidPatchError: (error) => Effect.fail(toFileToolFailure(error)),
      FileIoError: (error) => Effect.fail(toFileToolFailure(error))
    })
  )

const StubHint: ToolHint = {
  code: "stub-contract",
  message: "This file tool is currently a typed stub. Implement the handler before exposing it in the live agent toolkit.",
  suggestedTool: null,
  suggestedArgs: null
}

const normalizeWorkspacePath = (path: string) => path.replaceAll("\\", "/")

const sanitizePositiveInt = (value: number | null, fallback: number) => {
  if (value == null || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

const makeSnapshotId = (content: string) => createHash("sha256").update(content).digest("hex")

const hasBinaryByte = (bytes: Uint8Array<ArrayBuffer>) => bytes.some((value) => value === 0)

const truncateSearchLine = (line: string) =>
  line.length <= maxSearchLineLength ? line : `${line.slice(0, maxSearchLineLength - 3)}...`

type IgnoreRule = {
  readonly negate: boolean
  readonly matchers: ReadonlyArray<Bun.Glob>
}

const buildIgnoreMatchers = (pattern: string, directoryOnly: boolean) => {
  const normalizedPattern = normalizeWorkspacePath(pattern)
  const hasSlash = normalizedPattern.includes("/")
  const patterns = new Set<string>()
  const add = (value: string) => {
    if (value.length > 0) {
      patterns.add(value)
    }
  }

  if (hasSlash) {
    add(normalizedPattern)
    add(`${normalizedPattern}/**`)
  } else {
    add(normalizedPattern)
    add(`**/${normalizedPattern}`)
    add(`${normalizedPattern}/**`)
    add(`**/${normalizedPattern}/**`)
  }

  if (directoryOnly) {
    add(`${normalizedPattern}/**`)
    if (!hasSlash) {
      add(`**/${normalizedPattern}/**`)
    }
  }

  return Array.from(patterns, (value) => new Bun.Glob(value))
}

const parseIgnoreRules = (content: string): Array<IgnoreRule> =>
  content
    .split(/\r?\n/)
    .flatMap((line) => {
      const trimmed = line.trim()

      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        return []
      }

      const negate = trimmed.startsWith("!")
      const rawPattern = negate ? trimmed.slice(1) : trimmed
      const directoryOnly = rawPattern.endsWith("/")
      const normalizedPattern = normalizeWorkspacePath(rawPattern.replace(/^\/+/, "").replace(/\/+$/, ""))

      if (normalizedPattern.length === 0) {
        return []
      }

      return [{
        negate,
        matchers: buildIgnoreMatchers(normalizedPattern, directoryOnly)
      }]
    })

const loadIgnoreRules = Effect.fn("FileTools.loadIgnoreRules")(function* () {
  const gitignoreFile = Bun.file(gitignorePath)
  const exists = yield* Effect.tryPromise({
    try: () => gitignoreFile.exists(),
    catch: (cause) =>
      new FileIoError({
        path: ".gitignore",
        message: `Unable to inspect .gitignore: ${String(cause)}`
      })
  })

  if (!exists) {
    return []
  }

  const content = yield* Effect.tryPromise({
    try: () => gitignoreFile.text(),
    catch: (cause) =>
      new FileIoError({
        path: ".gitignore",
        message: `Unable to read .gitignore: ${String(cause)}`
      })
  })

  return parseIgnoreRules(content)
})

const isAlwaysIgnoredWorkspacePath = (path: string) =>
  normalizeWorkspacePath(path)
    .split("/")
    .includes(".git")

const matchesIgnoreRules = (path: string, rules: ReadonlyArray<IgnoreRule>) => {
  if (isAlwaysIgnoredWorkspacePath(path)) {
    return true
  }

  let ignored = false

  for (const rule of rules) {
    if (rule.matchers.some((matcher) => matcher.match(path))) {
      ignored = !rule.negate
    }
  }

  return ignored
}

const ensureVisibleWorkspacePath = Effect.fn("FileTools.ensureVisibleWorkspacePath")(function* (workspacePath: string) {
  const ignoreRules = yield* loadIgnoreRules()

  if (!matchesIgnoreRules(workspacePath, ignoreRules)) {
    return
  }

  return yield* Effect.fail(
    new IgnoredPathError({
      path: workspacePath,
      message: `Path is ignored by inspection rules: ${workspacePath}`
    })
  )
})

const makeReadMoreHint = (path: string, nextStartLine: number, maxLines: number): ToolHint => ({
  code: "read-more",
  message: `Read more of ${path} before updating it.`,
  suggestedTool: "read_file",
  suggestedArgs: {
    path,
    startLine: nextStartLine,
    maxLines
  }
})

const makeStubHints = (): Array<ToolHint> => [StubHint]

const resolveWorkspaceTarget = Effect.fn("FileTools.resolveWorkspaceTarget")(function* (inputPath: string) {
  const trimmedPath = inputPath.trim()

  if (trimmedPath.length === 0 || isAbsolute(trimmedPath)) {
    return yield* Effect.fail(
      new InvalidPathError({
        path: inputPath,
        message: "Paths must be non-empty and workspace-relative."
      })
    )
  }

  const absolutePath = resolve(workspaceRoot, normalize(trimmedPath))
  const relativePath = normalizeWorkspacePath(relative(workspaceRoot, absolutePath))

  if (relativePath.length === 0 || relativePath === ".") {
    return yield* Effect.fail(
      new InvalidPathError({
        path: inputPath,
        message: "Use an explicit workspace-relative path."
      })
    )
  }

  if (relativePath.startsWith("../") || relativePath === "..") {
    return yield* Effect.fail(
      new OutsideWorkspaceError({
        path: inputPath,
        message: "Path resolves outside the workspace root."
      })
    )
  }

  return {
    absolutePath,
    workspacePath: relativePath
  }
})

const readPathStat = Effect.fn("FileTools.readPathStat")(function* (absolutePath: string, workspacePath: string) {
  return yield* Effect.tryPromise({
    try: () => stat(absolutePath),
    catch: (cause) => {
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
        return new FileNotFoundError({
          path: workspacePath,
          message: `File not found: ${workspacePath}`
        })
      }

      return new FileIoError({
        path: workspacePath,
        message: `Unable to inspect ${workspacePath}: ${String(cause)}`
      })
    }
  })
})

const ensureFileTarget = Effect.fn("FileTools.ensureFileTarget")(function* (inputPath: string) {
  const target = yield* resolveWorkspaceTarget(inputPath)
  yield* ensureVisibleWorkspacePath(target.workspacePath)
  const pathStat = yield* readPathStat(target.absolutePath, target.workspacePath)

  if (!pathStat.isFile()) {
    return yield* Effect.fail(
      new InvalidPathError({
        path: target.workspacePath,
        message: `Expected a file path: ${target.workspacePath}`
      })
    )
  }

  return target
})

const ensureDirectoryTarget = Effect.fn("FileTools.ensureDirectoryTarget")(function* (inputPath: string) {
  const target = yield* resolveWorkspaceTarget(inputPath)
  yield* ensureVisibleWorkspacePath(target.workspacePath)
  const pathStat = yield* readPathStat(target.absolutePath, target.workspacePath)

  if (!pathStat.isDirectory()) {
    return yield* Effect.fail(
      new InvalidPathError({
        path: target.workspacePath,
        message: `Expected a directory path: ${target.workspacePath}`
      })
    )
  }

  return target
})

const readWorkspaceTextFile = Effect.fn("FileTools.readWorkspaceTextFile")(function* (workspacePath: string) {
  const target = yield* ensureFileTarget(workspacePath)
  const bytes = yield* Effect.tryPromise({
    try: () => Bun.file(target.absolutePath).bytes(),
    catch: (cause) =>
      new FileIoError({
        path: target.workspacePath,
        message: `Unable to read ${target.workspacePath}: ${String(cause)}`
      })
  })

  if (hasBinaryByte(bytes)) {
    return yield* Effect.fail(
      new BinaryFileError({
        path: target.workspacePath,
        message: `Refusing to read binary file: ${target.workspacePath}`
      })
    )
  }

  const content = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    catch: () =>
      new BinaryFileError({
        path: target.workspacePath,
        message: `Refusing to read non-UTF-8 file: ${target.workspacePath}`
      })
  })

  return {
    path: target.workspacePath,
    content
  }
})

const listMatchingFiles = Effect.fn("FileTools.listMatchingFiles")(function* ({
  pattern,
  basePath,
  maxResults
}: {
  pattern: string
  basePath: string | null
  maxResults: number
}) {
  const baseTarget = basePath == null
    ? { absolutePath: workspaceRoot, workspacePath: "." }
    : yield* ensureDirectoryTarget(basePath)
  const ignoreRules = yield* loadIgnoreRules()

  return yield* Effect.tryPromise({
    try: async () => {
      const files: Array<string> = []
      let truncated = false

      for await (const match of new Bun.Glob(pattern).scan({
        cwd: baseTarget.absolutePath,
        dot: true,
        onlyFiles: true,
        followSymlinks: false
      })) {
        const candidatePath = normalizeWorkspacePath(
          baseTarget.workspacePath === "."
            ? match
            : `${baseTarget.workspacePath}/${match}`
        )

        if (matchesIgnoreRules(candidatePath, ignoreRules)) {
          continue
        }

        if (files.length >= maxResults) {
          truncated = true
          break
        }

        files.push(candidatePath)
      }

      files.sort((left, right) => left.localeCompare(right))

      return {
        basePath: baseTarget.workspacePath,
        files,
        truncated
      }
    },
    catch: (cause) =>
      new FileIoError({
        path: baseTarget.workspacePath,
        message: `Unable to scan ${baseTarget.workspacePath}: ${String(cause)}`
      })
  })
})

export const GlobFilesParameters = {
  pattern: Schema.String,
  basePath: Schema.NullOr(Schema.String),
  maxResults: Schema.NullOr(Schema.Number)
} as const

export const GlobFilesSuccessSchema = Schema.Struct({
  status: Schema.Literal("success"),
  message: Schema.String,
  data: Schema.Struct({
    basePath: Schema.String,
    pattern: Schema.String,
    files: Schema.Array(Schema.String),
    truncated: Schema.Boolean
  }),
  hints: Schema.Array(ToolHintSchema)
})
export type GlobFilesResult = Schema.Schema.Type<typeof GlobFilesSuccessSchema>

export const SearchCodeParameters = {
  query: Schema.String,
  basePath: Schema.NullOr(Schema.String),
  include: Schema.NullOr(Schema.String),
  caseSensitive: Schema.Boolean,
  maxResults: Schema.NullOr(Schema.Number)
} as const

export const SearchCodeSuccessSchema = Schema.Struct({
  status: Schema.Literal("success"),
  message: Schema.String,
  data: Schema.Struct({
    basePath: Schema.String,
    query: Schema.String,
    matches: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        line: Schema.Number,
        content: Schema.String
      })
    ),
    truncated: Schema.Boolean
  }),
  hints: Schema.Array(ToolHintSchema)
})
export type SearchCodeResult = Schema.Schema.Type<typeof SearchCodeSuccessSchema>

export const ReadFileParameters = {
  path: Schema.String,
  startLine: Schema.NullOr(Schema.Number),
  maxLines: Schema.NullOr(Schema.Number)
} as const

export const ReadFileInputSchema = Schema.Struct(ReadFileParameters)
export type ReadFileInput = Schema.Schema.Type<typeof ReadFileInputSchema>

export const ReadFileSuccessDataSchema = Schema.Struct({
  path: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  totalLines: Schema.NullOr(Schema.Number),
  content: Schema.String,
  truncated: Schema.Boolean,
  snapshotId: SnapshotId,
  encoding: Schema.Literal("utf-8")
})

export const ReadFileSuccessSchema = Schema.Struct({
  status: Schema.Literal("success"),
  message: Schema.String,
  data: ReadFileSuccessDataSchema,
  hints: Schema.Array(ToolHintSchema)
})
export type ReadFileResult = Schema.Schema.Type<typeof ReadFileSuccessSchema>

export const WriteFileParameters = {
  path: Schema.String,
  content: Schema.String,
  intent: Schema.Literal("create", "replace"),
  baseSnapshotId: Schema.NullOr(SnapshotId),
  createParents: Schema.Boolean
} as const

export const WriteFileInputSchema = Schema.Struct(WriteFileParameters)
export type WriteFileInput = Schema.Schema.Type<typeof WriteFileInputSchema>

export const WriteFileSuccessSchema = Schema.Struct({
  status: Schema.Literal("success"),
  message: Schema.String,
  data: Schema.Struct({
    path: Schema.String,
    action: Schema.Literal("created", "replaced"),
    bytesWritten: Schema.Number,
    lineCount: Schema.Number,
    createdParents: Schema.Array(Schema.String),
    snapshotId: SnapshotId
  }),
  hints: Schema.Array(ToolHintSchema)
})

export const WriteFileGuidanceSchema = Schema.Struct({
  status: Schema.Literal("guidance"),
  message: Schema.String,
  data: Schema.Struct({
    path: Schema.String,
    reason: Schema.Literal(
      "read-before-replace",
      "stale-snapshot",
      "replace-existing-with-patch",
      "not-implemented"
    ),
    currentSnapshotId: Schema.NullOr(SnapshotId)
  }),
  hints: Schema.Array(ToolHintSchema)
})

export const WriteFileResultSchema = Schema.Union(WriteFileSuccessSchema, WriteFileGuidanceSchema)
export type WriteFileResult = Schema.Schema.Type<typeof WriteFileResultSchema>

export const ApplyPatchParameters = {
  patch: Schema.String,
  expectedSnapshots: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      snapshotId: SnapshotId
    })
  )
} as const

export const ApplyPatchInputSchema = Schema.Struct(ApplyPatchParameters)
export type ApplyPatchInput = Schema.Schema.Type<typeof ApplyPatchInputSchema>

export const ApplyPatchSuccessSchema = Schema.Struct({
  status: Schema.Literal("success"),
  message: Schema.String,
  data: Schema.Struct({
    files: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        action: Schema.Literal("updated"),
        addedLines: Schema.Number,
        removedLines: Schema.Number,
        snapshotId: SnapshotId
      })
    )
  }),
  hints: Schema.Array(ToolHintSchema)
})

export const ApplyPatchGuidanceSchema = Schema.Struct({
  status: Schema.Literal("guidance"),
  message: Schema.String,
  data: Schema.Struct({
    reason: Schema.Literal("not-implemented"),
    files: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        reason: Schema.Literal(
          "missing-read-context",
          "stale-read-context",
          "patch-context-mismatch",
          "create-not-allowed",
          "delete-not-allowed",
          "not-implemented"
        )
      })
    )
  }),
  hints: Schema.Array(ToolHintSchema)
})

export const ApplyPatchResultSchema = Schema.Union(ApplyPatchSuccessSchema, ApplyPatchGuidanceSchema)
export type ApplyPatchResult = Schema.Schema.Type<typeof ApplyPatchResultSchema>

export const DeleteFileParameters = {
  path: Schema.String,
  baseSnapshotId: Schema.NullOr(SnapshotId)
} as const

export const DeleteFileInputSchema = Schema.Struct(DeleteFileParameters)
export type DeleteFileInput = Schema.Schema.Type<typeof DeleteFileInputSchema>

export const DeleteFileSuccessSchema = Schema.Struct({
  status: Schema.Literal("success"),
  message: Schema.String,
  data: Schema.Struct({
    path: Schema.String,
    action: Schema.Literal("deleted", "already-missing")
  }),
  hints: Schema.Array(ToolHintSchema)
})

export const DeleteFileGuidanceSchema = Schema.Struct({
  status: Schema.Literal("guidance"),
  message: Schema.String,
  data: Schema.Struct({
    path: Schema.String,
    reason: Schema.Literal("read-before-delete", "stale-snapshot", "not-implemented"),
    currentSnapshotId: Schema.NullOr(SnapshotId)
  }),
  hints: Schema.Array(ToolHintSchema)
})

export const DeleteFileResultSchema = Schema.Union(DeleteFileSuccessSchema, DeleteFileGuidanceSchema)
export type DeleteFileResult = Schema.Schema.Type<typeof DeleteFileResultSchema>

export const GlobFilesTool = Tool.make("glob_files", {
  description: "List workspace files matching a glob pattern.",
  parameters: GlobFilesParameters,
  success: GlobFilesSuccessSchema,
  failure: FileToolFailureSchema,
  failureMode: "return"
})

export const SearchCodeTool = Tool.make("search_code", {
  description: "Search text files in the workspace for matching lines.",
  parameters: SearchCodeParameters,
  success: SearchCodeSuccessSchema,
  failure: FileToolFailureSchema,
  failureMode: "return"
})

export const ReadFileTool = Tool.make("read_file", {
  description: "Read a UTF-8 text file from the workspace and return bounded contents plus a snapshotId for later mutations.",
  parameters: ReadFileParameters,
  success: ReadFileSuccessSchema,
  failure: FileToolFailureSchema,
  failureMode: "return"
})

export const WriteFileTool = Tool.make("write_file", {
  description: "Create a new file or fully replace an existing file. Prefer apply_patch for targeted updates to existing files.",
  parameters: WriteFileParameters,
  success: WriteFileResultSchema,
  failure: FileToolFailureSchema,
  failureMode: "return"
})

export const ApplyPatchTool = Tool.make("apply_patch", {
  description: "Apply a focused patch to existing workspace files. This is the default mutation path for updating files that were read recently.",
  parameters: ApplyPatchParameters,
  success: ApplyPatchResultSchema,
  failure: FileToolFailureSchema,
  failureMode: "return"
})

export const DeleteFileTool = Tool.make("delete_file", {
  description: "Delete a workspace file. Existing files should be read recently before they are removed.",
  parameters: DeleteFileParameters,
  success: DeleteFileResultSchema,
  failure: FileToolFailureSchema,
  failureMode: "return"
})

export const RepoInspectionToolkit = Toolkit.make(GlobFilesTool, SearchCodeTool, ReadFileTool)
export const FileMutationToolkit = Toolkit.make(WriteFileTool, ApplyPatchTool, DeleteFileTool)
export const FileToolkit = Toolkit.merge(RepoInspectionToolkit, FileMutationToolkit)

const makeRepoInspectionHandlers = () => ({
  glob_files: ({ pattern, basePath, maxResults }: Schema.Schema.Type<Schema.Struct<typeof GlobFilesParameters>>) =>
    catchFileToolErrors(
      listMatchingFiles({
        pattern,
        basePath,
        maxResults: sanitizePositiveInt(maxResults, defaultGlobResults)
      }).pipe(
        Effect.map(({ basePath: resolvedBasePath, files, truncated }): GlobFilesResult => ({
          status: "success",
          message: `Found ${files.length} matching file${files.length === 1 ? "" : "s"}.`,
          data: {
            basePath: resolvedBasePath,
            pattern,
            files,
            truncated
          },
          hints: []
        }))
      )
    ),

  search_code: ({ query, basePath, include, caseSensitive, maxResults }: Schema.Schema.Type<Schema.Struct<typeof SearchCodeParameters>>) =>
    catchFileToolErrors(
      Effect.gen(function* () {
        const limit = sanitizePositiveInt(maxResults, defaultSearchResults)
        const { basePath: resolvedBasePath, files } = yield* listMatchingFiles({
          pattern: include ?? "**/*",
          basePath,
          maxResults: defaultGlobResults * 10
        })

        const normalizedQuery = caseSensitive ? query : query.toLowerCase()
        const matches: Array<Schema.Schema.Type<typeof SearchCodeSuccessSchema>["data"]["matches"][number]> = []
        let truncated = false

        for (const filePath of files) {
          const fileRead = yield* readWorkspaceTextFile(filePath).pipe(
            Effect.catchTag("BinaryFileError", () => Effect.succeed(null))
          )

          if (fileRead == null) {
            continue
          }

          const lines = fileRead.content.split(/\r?\n/)
          for (const [index, line] of lines.entries()) {
            const candidate = caseSensitive ? line : line.toLowerCase()
            if (!candidate.includes(normalizedQuery)) {
              continue
            }

            if (matches.length >= limit) {
              truncated = true
              break
            }

            matches.push({
              path: fileRead.path,
              line: index + 1,
              content: truncateSearchLine(line)
            })
          }

          if (truncated) {
            break
          }
        }

        return {
          status: "success" as const,
          message: `Found ${matches.length} matching line${matches.length === 1 ? "" : "s"}.`,
          data: {
            basePath: resolvedBasePath,
            query,
            matches,
            truncated
          },
          hints: []
        }
      })
    ),

  read_file: ({ path, startLine, maxLines }: ReadFileInput) =>
    catchFileToolErrors(
      readWorkspaceTextFile(path).pipe(
        Effect.map(({ path: workspacePath, content }): ReadFileResult => {
          const normalizedStartLine = sanitizePositiveInt(startLine, 1)
          const normalizedMaxLines = sanitizePositiveInt(maxLines, defaultReadLines)
          const lines = content.split(/\r?\n/)
          const startIndex = normalizedStartLine - 1
          const selectedLines = startIndex >= lines.length
            ? []
            : lines.slice(startIndex, startIndex + normalizedMaxLines)
          const truncated = startIndex + normalizedMaxLines < lines.length
          const endLine = selectedLines.length === 0
            ? Math.min(lines.length, normalizedStartLine - 1)
            : normalizedStartLine + selectedLines.length - 1

          return {
            status: "success",
            message: `Read ${workspacePath}.`,
            data: {
              path: workspacePath,
              startLine: normalizedStartLine,
              endLine,
              totalLines: lines.length,
              content: selectedLines.join("\n"),
              truncated,
              snapshotId: makeSnapshotId(content),
              encoding: "utf-8"
            },
            hints: truncated
              ? [makeReadMoreHint(workspacePath, endLine + 1, normalizedMaxLines)]
              : []
          }
        })
      )
    )
})

const makeMutationStubHandlers = () => ({
  write_file: ({ path }: WriteFileInput) =>
    Effect.succeed({
      status: "guidance" as const,
      message: "write_file is specified but not implemented yet.",
      data: {
        path,
        reason: "not-implemented" as const,
        currentSnapshotId: null
      },
      hints: makeStubHints()
    }),

  apply_patch: () =>
    Effect.succeed({
      status: "guidance" as const,
      message: "apply_patch is specified but not implemented yet.",
      data: {
        reason: "not-implemented" as const,
        files: []
      },
      hints: makeStubHints()
    }),

  delete_file: ({ path }: DeleteFileInput) =>
    Effect.succeed({
      status: "guidance" as const,
      message: "delete_file is specified but not implemented yet.",
      data: {
        path,
        reason: "not-implemented" as const,
        currentSnapshotId: null
      },
      hints: makeStubHints()
    })
})

export const makeRepoInspectionToolkitLayer = () =>
  RepoInspectionToolkit.toLayer(
    RepoInspectionToolkit.of(makeRepoInspectionHandlers())
  )

export const makeFileMutationToolkitLayer = () =>
  FileMutationToolkit.toLayer(
    FileMutationToolkit.of(makeMutationStubHandlers())
  )

export const makeFileToolkitLayer = () =>
  FileToolkit.toLayer(
    FileToolkit.of({
      ...makeRepoInspectionHandlers(),
      ...makeMutationStubHandlers()
    })
  )
