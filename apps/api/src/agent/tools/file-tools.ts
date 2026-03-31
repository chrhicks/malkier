import { createHash } from "node:crypto"
import { mkdir, rm, stat } from "node:fs/promises"
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

type WorkspaceTarget = {
  readonly absolutePath: string
  readonly workspacePath: string
}

type WorkspaceTextFile = {
  readonly path: string
  readonly content: string
}

type WorkspaceFileSnapshot = WorkspaceTextFile & {
  readonly snapshotId: SnapshotId
}

type ParsedPatchLine = {
  readonly kind: "context" | "add" | "remove"
  readonly content: string
}

type ParsedPatchHunk = {
  readonly anchor: string | null
  readonly lines: ReadonlyArray<ParsedPatchLine>
}

type ParsedPatchOperation =
  | {
    readonly kind: "add"
    readonly path: string
    readonly content: string
  }
  | {
    readonly kind: "delete"
    readonly path: string
  }
  | {
    readonly kind: "update"
    readonly path: string
    readonly hunks: ReadonlyArray<ParsedPatchHunk>
  }

type PatchPreview = {
  readonly content: string
  readonly addedLines: number
  readonly removedLines: number
}

type PatchPlan = {
  readonly target: WorkspaceTarget
  readonly path: string
  readonly content: string
  readonly addedLines: number
  readonly removedLines: number
}

type ApplyPatchGuidanceReason =
  | "missing-read-context"
  | "stale-read-context"
  | "patch-context-not-found"
  | "patch-context-ambiguous"
  | "create-not-allowed"
  | "delete-not-allowed"
  | "not-implemented"

type ApplyPatchGuidanceFile = {
  readonly path: string
  readonly reason: ApplyPatchGuidanceReason
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

const makeReadFileHint = (path: string, message: string): ToolHint => ({
  code: "read-file",
  message,
  suggestedTool: "read_file",
  suggestedArgs: {
    path,
    startLine: 1,
    maxLines: defaultReadLines
  }
})

const dedupeHints = (hints: ReadonlyArray<ToolHint>) => {
  const seen = new Set<string>()

  return hints.filter((hint) => {
    const key = JSON.stringify(hint)

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

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

const resolveVisibleWorkspaceTarget = Effect.fn("FileTools.resolveVisibleWorkspaceTarget")(function* (inputPath: string) {
  const target = yield* resolveWorkspaceTarget(inputPath)
  yield* ensureVisibleWorkspacePath(target.workspacePath)
  return target
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

const readOptionalPathStat = Effect.fn("FileTools.readOptionalPathStat")(function* (absolutePath: string, workspacePath: string) {
  return yield* readPathStat(absolutePath, workspacePath).pipe(
    Effect.catchTag("FileNotFoundError", () => Effect.succeed(null))
  )
})

const ensureFileTarget = Effect.fn("FileTools.ensureFileTarget")(function* (inputPath: string) {
  const target = yield* resolveVisibleWorkspaceTarget(inputPath)
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
  const target = yield* resolveVisibleWorkspaceTarget(inputPath)
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

const readResolvedWorkspaceTextFile = Effect.fn("FileTools.readResolvedWorkspaceTextFile")(function* (target: WorkspaceTarget) {
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
  } satisfies WorkspaceTextFile
})

const readWorkspaceTextFile = Effect.fn("FileTools.readWorkspaceTextFile")(function* (workspacePath: string) {
  const target = yield* ensureFileTarget(workspacePath)
  return yield* readResolvedWorkspaceTextFile(target)
})

const readOptionalWorkspaceFileSnapshot = Effect.fn("FileTools.readOptionalWorkspaceFileSnapshot")(function* (target: WorkspaceTarget) {
  const pathStat = yield* readOptionalPathStat(target.absolutePath, target.workspacePath)

  if (pathStat == null) {
    return null
  }

  if (!pathStat.isFile()) {
    return yield* Effect.fail(
      new InvalidPathError({
        path: target.workspacePath,
        message: `Expected a file path: ${target.workspacePath}`
      })
    )
  }

  const file = yield* readResolvedWorkspaceTextFile(target)

  return {
    ...file,
    snapshotId: makeSnapshotId(file.content)
  } satisfies WorkspaceFileSnapshot
})

const ensureParentDirectories = Effect.fn("FileTools.ensureParentDirectories")(function* (target: WorkspaceTarget, createParents: boolean) {
  const segments = target.workspacePath.split("/").slice(0, -1)
  const createdParents: Array<string> = []

  for (let index = 1; index <= segments.length; index++) {
    const parentPath = segments.slice(0, index).join("/")
    const parentTarget = yield* resolveVisibleWorkspaceTarget(parentPath)
    const pathStat = yield* readOptionalPathStat(parentTarget.absolutePath, parentTarget.workspacePath)

    if (pathStat == null) {
      if (!createParents) {
        return yield* Effect.fail(
          new InvalidPathError({
            path: target.workspacePath,
            message: `Parent directory does not exist: ${parentTarget.workspacePath}`
          })
        )
      }

      yield* Effect.tryPromise({
        try: () => mkdir(parentTarget.absolutePath),
        catch: (cause) =>
          new FileIoError({
            path: parentTarget.workspacePath,
            message: `Unable to create directory ${parentTarget.workspacePath}: ${String(cause)}`
          })
      })
      createdParents.push(parentTarget.workspacePath)
      continue
    }

    if (!pathStat.isDirectory()) {
      return yield* Effect.fail(
        new InvalidPathError({
          path: parentTarget.workspacePath,
          message: `Expected a directory path: ${parentTarget.workspacePath}`
        })
      )
    }
  }

  return createdParents
})

const writeResolvedWorkspaceTextFile = Effect.fn("FileTools.writeResolvedWorkspaceTextFile")(function* (target: WorkspaceTarget, content: string) {
  yield* Effect.tryPromise({
    try: () => Bun.write(target.absolutePath, content),
    catch: (cause) =>
      new FileIoError({
        path: target.workspacePath,
        message: `Unable to write ${target.workspacePath}: ${String(cause)}`
      })
  })
})

const deleteResolvedWorkspaceFile = Effect.fn("FileTools.deleteResolvedWorkspaceFile")(function* (target: WorkspaceTarget) {
  yield* Effect.tryPromise({
    try: () => rm(target.absolutePath),
    catch: (cause) =>
      new FileIoError({
        path: target.workspacePath,
        message: `Unable to delete ${target.workspacePath}: ${String(cause)}`
      })
  })
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

const splitContentLines = (content: string) => content.split(/\r?\n/)

const splitVisibleContentLines = (content: string) => {
  if (content.length === 0) {
    return []
  }

  const lines = splitContentLines(content)

  if (content.endsWith("\n") && lines.at(-1) === "") {
    lines.pop()
  }

  return lines
}

const countContentLines = (content: string) => splitVisibleContentLines(content).length

const buildReadFileContent = (lines: ReadonlyArray<string>, hasTrailingNewline: boolean, reachesFileEnd: boolean) => {
  if (lines.length === 0) {
    return ""
  }

  return `${lines.join("\n")}${hasTrailingNewline && reachesFileEnd ? "\n" : ""}`
}

const detectLineEnding = (content: string) => content.includes("\r\n") ? "\r\n" : "\n"

const invalidPatch = (message: string, path: string | null = null) =>
  new InvalidPatchError({ path, message })

const makeApplyPatchGuidanceMessage = (reasons: ReadonlyArray<ApplyPatchGuidanceReason>) => {
  const uniqueReasons = new Set(reasons)

  if (uniqueReasons.size === 1) {
    const reason = reasons[0]

    switch (reason) {
      case "missing-read-context":
      case "stale-read-context":
        return "apply_patch needs a fresh read of the target file before it can proceed."
      case "patch-context-not-found":
        return "apply_patch could not find the requested patch context in the current file contents."
      case "patch-context-ambiguous":
        return "apply_patch found multiple matches for the requested patch context in the current file contents."
      case "create-not-allowed":
        return "apply_patch only updates existing files. Use write_file to create new files instead."
      case "delete-not-allowed":
        return "apply_patch does not delete files. Use delete_file instead."
      case "not-implemented":
        return "apply_patch is specified but not implemented yet."
    }
  }

  return "apply_patch needs fresher read context or a different mutation tool before it can proceed."
}

const isPatchSectionHeader = (line: string) =>
  line.startsWith("*** Add File: ")
  || line.startsWith("*** Update File: ")
  || line.startsWith("*** Delete File: ")
  || line === "*** End Patch"

const trimTrailingBlankPatchLines = (lines: Array<string>) => {
  while (lines.at(-1) === "") {
    lines.pop()
  }

  return lines
}

const parsePatchAnchor = (line: string) => {
  const rawAnchor = line.slice(2)
  const anchor = rawAnchor.startsWith(" ") ? rawAnchor.slice(1) : rawAnchor
  return anchor.length === 0 ? null : anchor
}

const parsePatchHunks = (path: string, lines: ReadonlyArray<string>): Array<ParsedPatchHunk> => {
  if (lines.length === 0) {
    throw invalidPatch(`Update patch for ${path} must include at least one hunk.`, path)
  }

  const hunks: Array<ParsedPatchHunk> = []
  let index = 0

  while (index < lines.length) {
    const header = lines[index]

    if (header == null || !header.startsWith("@@")) {
      throw invalidPatch(`Invalid hunk header for ${path}: ${String(header)}`, path)
    }

    index += 1
    const hunkLines: Array<ParsedPatchLine> = []

    while (index < lines.length) {
      const line = lines[index]

      if (line == null || line.startsWith("@@")) {
        break
      }

      const prefix = line[0]

      if (prefix !== " " && prefix !== "+" && prefix !== "-") {
        throw invalidPatch(`Invalid patch line for ${path}: ${line}`, path)
      }

      hunkLines.push({
        kind: prefix === " " ? "context" : prefix === "+" ? "add" : "remove",
        content: line.slice(1)
      })
      index += 1
    }

    if (hunkLines.length === 0) {
      throw invalidPatch(`Patch hunk for ${path} must include at least one line.`, path)
    }

    if (parsePatchAnchor(header) == null && hunkLines.every((line) => line.kind === "add")) {
      throw invalidPatch(`Patch hunk for ${path} must include context or removals.`, path)
    }

    hunks.push({
      anchor: parsePatchAnchor(header),
      lines: hunkLines
    })
  }

  return hunks
}

const parsePatchText = (patch: string): Array<ParsedPatchOperation> => {
  const lines = trimTrailingBlankPatchLines(patch.split(/\r?\n/))

  if (lines[0] !== "*** Begin Patch") {
    throw invalidPatch("Patch must begin with *** Begin Patch.")
  }

  if (lines.at(-1) !== "*** End Patch") {
    throw invalidPatch("Patch must end with *** End Patch.")
  }

  const operations: Array<ParsedPatchOperation> = []
  let index = 1

  while (index < lines.length - 1) {
    const line = lines[index]

    if (line == null) {
      break
    }

    if (line.length === 0) {
      index += 1
      continue
    }

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length).trim()

      if (path.length === 0) {
        throw invalidPatch("Add File section must include a path.")
      }

      index += 1
      const body: Array<string> = []
      while (index < lines.length - 1) {
        const candidate = lines[index]
        if (candidate != null && isPatchSectionHeader(candidate)) {
          break
        }
        body.push(candidate ?? "")
        index += 1
      }

      if (!body.every((entry) => entry.startsWith("+"))) {
        throw invalidPatch(`Add File section for ${path} must contain only '+' lines.`, path)
      }

      operations.push({
        kind: "add",
        path,
        content: body.map((entry) => entry.slice(1)).join("\n")
      })
      continue
    }

    if (line.startsWith("*** Delete File: ")) {
      const path = line.slice("*** Delete File: ".length).trim()

      if (path.length === 0) {
        throw invalidPatch("Delete File section must include a path.")
      }

      operations.push({ kind: "delete", path })
      index += 1
      continue
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length).trim()

      if (path.length === 0) {
        throw invalidPatch("Update File section must include a path.")
      }

      index += 1
      const body: Array<string> = []
      while (index < lines.length - 1) {
        const candidate = lines[index]
        if (candidate != null && isPatchSectionHeader(candidate)) {
          break
        }
        body.push(candidate ?? "")
        index += 1
      }

      if (body[0]?.startsWith("*** Move to: ")) {
        throw invalidPatch(`apply_patch does not support move operations for ${path}.`, path)
      }

      operations.push({
        kind: "update",
        path,
        hunks: parsePatchHunks(path, body)
      })
      continue
    }

    throw invalidPatch(`Unknown patch section: ${line}`)
  }

  if (operations.length === 0) {
    throw invalidPatch("Patch must include at least one file operation.")
  }

  return operations
}

type SequenceMatchResult =
  | {
    readonly kind: "match"
    readonly index: number
  }
  | {
    readonly kind: "not-found"
  }
  | {
    readonly kind: "ambiguous"
  }

const findUniqueSequenceMatch = (
  lines: ReadonlyArray<string>,
  sequence: ReadonlyArray<string>,
  startIndex: number
): SequenceMatchResult => {
  let matchIndex: number | null = null

  for (let index = startIndex; index + sequence.length <= lines.length; index++) {
    let matched = true

    for (let offset = 0; offset < sequence.length; offset++) {
      if (lines[index + offset] !== sequence[offset]) {
        matched = false
        break
      }
    }

    if (!matched) {
      continue
    }

    if (matchIndex != null) {
      return { kind: "ambiguous" }
    }

    matchIndex = index
  }

  return matchIndex == null
    ? { kind: "not-found" }
    : { kind: "match", index: matchIndex }
}

type PatchPreviewFailure = {
  readonly reason: Extract<ApplyPatchGuidanceReason, "patch-context-not-found" | "patch-context-ambiguous">
}

type PatchPreviewResult = PatchPreview | PatchPreviewFailure

const isPatchPreviewFailure = (result: PatchPreviewResult): result is PatchPreviewFailure =>
  "reason" in result

const makePatchPreviewReadHintMessage = (path: string, reason: PatchPreviewFailure["reason"]) =>
  reason === "patch-context-ambiguous"
    ? `Re-read ${path}; the patch context matches multiple locations in the file.`
    : `Re-read ${path}; the patch context could not be found in the file.`

const previewPatchedContent = (
  path: string,
  content: string,
  hunks: ReadonlyArray<ParsedPatchHunk>
): PatchPreviewResult => {
  const newline = detectLineEnding(content)
  let lines = splitContentLines(content)
  let nextSearchStart = 0
  let addedLines = 0
  let removedLines = 0

  for (const hunk of hunks) {
    const beforeLines = [
      ...(hunk.anchor == null ? [] : [hunk.anchor]),
      ...hunk.lines.flatMap((line) => line.kind === "add" ? [] : [line.content])
    ]
    const afterLines = [
      ...(hunk.anchor == null ? [] : [hunk.anchor]),
      ...hunk.lines.flatMap((line) => line.kind === "remove" ? [] : [line.content])
    ]

    if (beforeLines.length === 0) {
      throw invalidPatch(`Patch hunk for ${path} must include context or removals.`, path)
    }

    const matchIndex = findUniqueSequenceMatch(lines, beforeLines, nextSearchStart)

    if (matchIndex.kind !== "match") {
      return {
        reason: matchIndex.kind === "ambiguous"
          ? "patch-context-ambiguous"
          : "patch-context-not-found"
      }
    }

    lines = [
      ...lines.slice(0, matchIndex.index),
      ...afterLines,
      ...lines.slice(matchIndex.index + beforeLines.length)
    ]
    nextSearchStart = matchIndex.index + afterLines.length
    addedLines += hunk.lines.filter((line) => line.kind === "add").length
    removedLines += hunk.lines.filter((line) => line.kind === "remove").length
  }

  return {
    content: lines.join(newline),
    addedLines,
    removedLines
  }
}

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
    reason: Schema.Literal(
      "missing-read-context",
      "stale-read-context",
      "patch-context-not-found",
      "patch-context-ambiguous",
      "create-not-allowed",
      "delete-not-allowed",
      "not-implemented"
    ),
    files: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        reason: Schema.Literal(
          "missing-read-context",
          "stale-read-context",
          "patch-context-not-found",
          "patch-context-ambiguous",
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
          const lines = splitVisibleContentLines(content)
          const hasTrailingNewline = content.endsWith("\n")
          const startIndex = normalizedStartLine - 1
          const selectedLines = startIndex >= lines.length
            ? []
            : lines.slice(startIndex, startIndex + normalizedMaxLines)
          const reachesFileEnd = startIndex + selectedLines.length >= lines.length
          const truncated = !reachesFileEnd
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
              content: buildReadFileContent(selectedLines, hasTrailingNewline, reachesFileEnd),
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

const makeMutationHandlers = () => ({
  write_file: ({ path, content, intent, baseSnapshotId, createParents }: WriteFileInput) =>
    catchFileToolErrors(
      Effect.gen(function* () {
        const target = yield* resolveVisibleWorkspaceTarget(path)
        const existingFile = yield* readOptionalWorkspaceFileSnapshot(target)

        if (intent === "create") {
          if (existingFile != null) {
            return {
              status: "guidance" as const,
              message: `${existingFile.path} already exists. Read it and use apply_patch for a focused update instead of write_file create.`,
              data: {
                path: existingFile.path,
                reason: "replace-existing-with-patch" as const,
                currentSnapshotId: existingFile.snapshotId
              },
              hints: [
                makeReadFileHint(
                  existingFile.path,
                  `Read ${existingFile.path} before updating the existing file.`
                )
              ]
            }
          }

          const createdParents = yield* ensureParentDirectories(target, createParents)
          yield* writeResolvedWorkspaceTextFile(target, content)

          return {
            status: "success" as const,
            message: `Created ${target.workspacePath}.`,
            data: {
              path: target.workspacePath,
              action: "created" as const,
              bytesWritten: Buffer.byteLength(content),
              lineCount: countContentLines(content),
              createdParents,
              snapshotId: makeSnapshotId(content)
            },
            hints: []
          }
        }

        if (existingFile == null) {
          return yield* Effect.fail(
            new FileNotFoundError({
              path: target.workspacePath,
              message: `File not found: ${target.workspacePath}`
            })
          )
        }

        if (baseSnapshotId == null) {
          return {
            status: "guidance" as const,
            message: `Read ${existingFile.path} before replacing it.`,
            data: {
              path: existingFile.path,
              reason: "read-before-replace" as const,
              currentSnapshotId: existingFile.snapshotId
            },
            hints: [
              makeReadFileHint(
                existingFile.path,
                `Read ${existingFile.path} before replacing its full contents.`
              )
            ]
          }
        }

        if (existingFile.snapshotId !== baseSnapshotId) {
          return {
            status: "guidance" as const,
            message: `${existingFile.path} changed since the last read. Re-read it before replacing the file.`,
            data: {
              path: existingFile.path,
              reason: "stale-snapshot" as const,
              currentSnapshotId: existingFile.snapshotId
            },
            hints: [
              makeReadFileHint(
                existingFile.path,
                `Re-read ${existingFile.path} to capture the latest snapshot before replacing it.`
              )
            ]
          }
        }

        yield* writeResolvedWorkspaceTextFile(target, content)

        return {
          status: "success" as const,
          message: `Replaced ${target.workspacePath}.`,
          data: {
            path: target.workspacePath,
            action: "replaced" as const,
            bytesWritten: Buffer.byteLength(content),
            lineCount: countContentLines(content),
            createdParents: [],
            snapshotId: makeSnapshotId(content)
          },
          hints: []
        }
      })
    ),

  apply_patch: ({ patch, expectedSnapshots }: ApplyPatchInput) =>
    catchFileToolErrors(
      Effect.gen(function* () {
        const operations = yield* Effect.try({
          try: () => parsePatchText(patch),
          catch: (cause) =>
            cause instanceof InvalidPatchError
              ? cause
              : invalidPatch(`Unable to parse patch: ${String(cause)}`)
        })

        const expectedSnapshotMap = new Map<string, SnapshotId>()
        for (const expectedSnapshot of expectedSnapshots) {
          const target = yield* resolveVisibleWorkspaceTarget(expectedSnapshot.path)

          if (expectedSnapshotMap.has(target.workspacePath)) {
            return yield* Effect.fail(
              invalidPatch(`Duplicate expected snapshot for ${target.workspacePath}.`, target.workspacePath)
            )
          }

          expectedSnapshotMap.set(target.workspacePath, expectedSnapshot.snapshotId)
        }

        const guidanceFiles: Array<ApplyPatchGuidanceFile> = []
        const guidanceHints: Array<ToolHint> = []
        const plans = new Map<string, PatchPlan>()

        for (const operation of operations) {
          const target = yield* resolveVisibleWorkspaceTarget(operation.path)

          if (operation.kind === "add") {
            guidanceFiles.push({
              path: target.workspacePath,
              reason: "create-not-allowed"
            })
            guidanceHints.push({
              code: "write-file-create",
              message: `Use write_file to create ${target.workspacePath} instead of apply_patch.`,
              suggestedTool: "write_file",
              suggestedArgs: {
                path: target.workspacePath,
                content: operation.content,
                intent: "create",
                baseSnapshotId: null,
                createParents: false
              }
            })
            continue
          }

          if (operation.kind === "delete") {
            guidanceFiles.push({
              path: target.workspacePath,
              reason: "delete-not-allowed"
            })
            guidanceHints.push(
              makeReadFileHint(
                target.workspacePath,
                `Read ${target.workspacePath} and then use delete_file to remove it.`
              )
            )
            continue
          }

          const expectedSnapshotId = expectedSnapshotMap.get(target.workspacePath)
          if (expectedSnapshotId == null) {
            guidanceFiles.push({
              path: target.workspacePath,
              reason: "missing-read-context"
            })
            guidanceHints.push(
              makeReadFileHint(
                target.workspacePath,
                `Read ${target.workspacePath} before applying a patch to it.`
              )
            )
            continue
          }

          const existingPlan = plans.get(target.workspacePath)
          if (existingPlan != null) {
            const preview = previewPatchedContent(target.workspacePath, existingPlan.content, operation.hunks)

            if (isPatchPreviewFailure(preview)) {
              guidanceFiles.push({
                path: target.workspacePath,
                reason: preview.reason
              })
              guidanceHints.push(
                makeReadFileHint(
                  target.workspacePath,
                  makePatchPreviewReadHintMessage(target.workspacePath, preview.reason)
                )
              )
              continue
            }

            plans.set(target.workspacePath, {
              ...existingPlan,
              content: preview.content,
              addedLines: existingPlan.addedLines + preview.addedLines,
              removedLines: existingPlan.removedLines + preview.removedLines
            })
            continue
          }

          const existingFile = yield* readOptionalWorkspaceFileSnapshot(target)
          if (existingFile == null || existingFile.snapshotId !== expectedSnapshotId) {
            guidanceFiles.push({
              path: target.workspacePath,
              reason: "stale-read-context"
            })
            guidanceHints.push(
              makeReadFileHint(
                target.workspacePath,
                `Re-read ${target.workspacePath} before applying the patch; the snapshot is missing or stale.`
              )
            )
            continue
          }

          const preview = previewPatchedContent(target.workspacePath, existingFile.content, operation.hunks)

          if (isPatchPreviewFailure(preview)) {
            guidanceFiles.push({
              path: target.workspacePath,
              reason: preview.reason
            })
            guidanceHints.push(
              makeReadFileHint(
                target.workspacePath,
                makePatchPreviewReadHintMessage(target.workspacePath, preview.reason)
              )
            )
            continue
          }

          plans.set(target.workspacePath, {
            target,
            path: target.workspacePath,
            content: preview.content,
            addedLines: preview.addedLines,
            removedLines: preview.removedLines
          })
        }

        if (guidanceFiles.length > 0) {
          const files = Array.from(
            new Map(guidanceFiles.map((file) => [`${file.path}:${file.reason}`, file])).values()
          )

          return {
            status: "guidance" as const,
            message: makeApplyPatchGuidanceMessage(files.map((file) => file.reason)),
            data: {
              reason: files[0]?.reason ?? "patch-context-not-found",
              files
            },
            hints: dedupeHints(guidanceHints)
          }
        }

        for (const plan of plans.values()) {
          yield* writeResolvedWorkspaceTextFile(plan.target, plan.content)
        }

        return {
          status: "success" as const,
          message: `Updated ${plans.size} file${plans.size === 1 ? "" : "s"}.`,
          data: {
            files: Array.from(plans.values(), (plan) => ({
              path: plan.path,
              action: "updated" as const,
              addedLines: plan.addedLines,
              removedLines: plan.removedLines,
              snapshotId: makeSnapshotId(plan.content)
            }))
          },
          hints: []
        }
      })
    ),

  delete_file: ({ path, baseSnapshotId }: DeleteFileInput) =>
    catchFileToolErrors(
      Effect.gen(function* () {
        const target = yield* resolveVisibleWorkspaceTarget(path)
        const existingFile = yield* readOptionalWorkspaceFileSnapshot(target)

        if (existingFile == null) {
          return {
            status: "success" as const,
            message: `${target.workspacePath} is already missing.`,
            data: {
              path: target.workspacePath,
              action: "already-missing" as const
            },
            hints: []
          }
        }

        if (baseSnapshotId == null) {
          return {
            status: "guidance" as const,
            message: `Read ${existingFile.path} before deleting it.`,
            data: {
              path: existingFile.path,
              reason: "read-before-delete" as const,
              currentSnapshotId: existingFile.snapshotId
            },
            hints: [
              makeReadFileHint(
                existingFile.path,
                `Read ${existingFile.path} before deleting it.`
              )
            ]
          }
        }

        if (existingFile.snapshotId !== baseSnapshotId) {
          return {
            status: "guidance" as const,
            message: `${existingFile.path} changed since the last read. Re-read it before deleting the file.`,
            data: {
              path: existingFile.path,
              reason: "stale-snapshot" as const,
              currentSnapshotId: existingFile.snapshotId
            },
            hints: [
              makeReadFileHint(
                existingFile.path,
                `Re-read ${existingFile.path} to capture the latest snapshot before deleting it.`
              )
            ]
          }
        }

        yield* deleteResolvedWorkspaceFile(target)

        return {
          status: "success" as const,
          message: `Deleted ${target.workspacePath}.`,
          data: {
            path: target.workspacePath,
            action: "deleted" as const
          },
          hints: []
        }
      })
    )
})

export const makeRepoInspectionToolkitLayer = () =>
  RepoInspectionToolkit.toLayer(
    RepoInspectionToolkit.of(makeRepoInspectionHandlers())
  )

export const makeFileMutationToolkitLayer = () =>
  FileMutationToolkit.toLayer(
    FileMutationToolkit.of(makeMutationHandlers())
  )

export const makeFileToolkitLayer = () =>
  FileToolkit.toLayer(
    FileToolkit.of({
      ...makeRepoInspectionHandlers(),
      ...makeMutationHandlers()
    })
  )
