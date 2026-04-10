import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"

// This is the current single source of truth for the API workspace root.
// It is intentionally small: callers can share one root definition today
// without baking in file-depth assumptions, and we can later replace this
// with a richer Workspace abstraction without changing every consumer again.
const repoMarker = ".git"

const hasRepoMarker = (directory: string) => existsSync(resolve(directory, repoMarker))

export const findWorkspaceRoot = (startDirectory: string): string => {
  let currentDirectory = resolve(startDirectory)

  while (true) {
    if (hasRepoMarker(currentDirectory)) {
      return currentDirectory
    }

    const parentDirectory = dirname(currentDirectory)

    if (parentDirectory === currentDirectory) {
      throw new Error(`Unable to locate workspace root from ${startDirectory}`)
    }

    currentDirectory = parentDirectory
  }
}

export const workspaceRoot = findWorkspaceRoot(import.meta.dirname)
