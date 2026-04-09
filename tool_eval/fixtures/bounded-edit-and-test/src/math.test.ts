import { describe, expect, test } from "bun:test"
import { subtract } from "./math"

describe("subtract", () => {
  test("subtracts positive numbers", () => {
    expect(subtract(5, 2)).toBe(3)
  })

  test("subtracts into negatives", () => {
    expect(subtract(-1, 2)).toBe(-3)
  })
})
