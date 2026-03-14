import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { decodeToolMetadata } from "./persisted-prompts"

describe("decodeToolMetadata", () => {
  test("decodes persisted tool-call metadata", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        decodeToolMetadata(
          JSON.stringify({
            kind: "tool-call",
            id: "call-1",
            name: "list_sessions",
            params: {}
          })
        )
      )
    )

    if (result._tag !== "Right") {
      throw new Error(`Expected Right, got ${result._tag}`)
    }

    expect(result.right).toEqual({
      kind: "tool-call",
      id: "call-1",
      name: "list_sessions",
      params: {}
    })
  })

  test("fails with MetadataJsonError for invalid JSON", async () => {
    const result = await Effect.runPromise(Effect.either(decodeToolMetadata("{not json}")))

    if (result._tag !== "Left") {
      throw new Error(`Expected Left, got ${result._tag}`)
    }

    expect(result.left._tag).toBe("MetadataJsonError")
    expect(result.left.message).toContain("Invalid persisted metadata JSON")
  })

  test("fails with MetadataShapeError for invalid metadata shape", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        decodeToolMetadata(
          JSON.stringify({
            kind: "tool-result",
            id: "call-1",
            name: "list_sessions",
            result: []
          })
        )
      )
    )

    if (result._tag !== "Left") {
      throw new Error(`Expected Left, got ${result._tag}`)
    }

    expect(result.left._tag).toBe("MetadataShapeError")
    expect(result.left.message).toBe("Persisted metadata does not match PromptMetadata schema")
  })
})
