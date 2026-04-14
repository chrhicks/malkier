# Runtime Instruction Layering Design

## Purpose

Define how Malkier should assemble runtime instructions from multiple explicit layers instead of relying on one base system prompt plus ad hoc runtime behavior.

This design is intended to make Malkier more trustworthy for supervised dogfooding by making prompt composition:

- explicit
- inspectable
- testable
- extensible

## Background

Malkier now has:

- a stronger base system prompt in `apps/api/src/agent/prompts/malkier-base-system-prompt.md`
- evals that measure tool use, honesty, bounded edits, and review behavior
- research showing that strong coding harnesses use layered instructions rather than a single monolithic prompt

What Malkier does not yet have is a real runtime instruction model.

Today, the effective runtime behavior is mostly shaped by:

- the base system prompt
- conversation history
- tool schemas
- a soft-stop system message near the turn cap
- runtime code outside the prompt

That is enough to improve surface behavior, but it is not enough to support:

- repo-local coding guidance
- mode-specific behavior such as review mode
- skill-specific overlays
- future subagent inheritance
- good visibility into why the agent behaved the way it did

## Goals

1. Centralize prompt assembly in one runtime module.
2. Support explicit instruction layers with a defined precedence order.
3. Load the root `AGENTS.md` file as the first repo-local instruction source.
4. Support practical mode overlays such as `default` and `review`.
5. Support runtime skill overlays sourced from `.agents/skills`.
6. Define a practical context-inheritance model for future subagents.
7. Make active layers visible in persisted run metadata and debugging surfaces.
8. Keep the first implementation small enough to ship without a prompt DSL or a complex rule engine.

## Non-Goals

This design does not aim to do the following in the first version:

- nested `AGENTS.md` lookup
- arbitrary user-authored prompt graphs
- dynamic layer mutation in the middle of a run
- full subagent productization
- runtime hard enforcement for every instruction conflict

Those may come later, but this design only needs to establish a strong first layering model.

## Current Runtime

The current runtime roughly behaves like this:

1. inject the base system prompt
2. append persisted conversation messages
3. expose the tool surface
4. add a soft-stop system message when nearing the round cap

This is simple, but it has four major weaknesses:

1. There is no explicit place for repo-local guidance.
2. There is no clean place for review or other mode-specific behavior.
3. Skills exist in the repo, but the runtime does not load them as instruction layers.
4. There is little visibility into which instructions were active for a given run.

## Proposed Layer Model

The runtime should assemble instructions in this order:

1. Base system prompt
2. Runtime constraints overlay
3. Repo-local instructions
4. Mode overlay
5. Skill overlays
6. Subagent overlay
7. Conversation history
8. Soft-stop overlay when needed

Not every run will use every layer.

### Layer responsibilities

#### 1. Base system prompt

The base system prompt defines the stable identity and behavior contract of Malkier.

It should cover:

- identity and operating model
- autonomy
- instruction precedence
- tool-use policy
- evidence-backed completion
- editing philosophy
- dirty-worktree safety
- git/high-risk action rules
- validation
- review-mode expectation at a high level
- progress updates
- final answer behavior

This lives in:

- `apps/api/src/agent/prompts/malkier-base-system-prompt.md`

#### 2. Runtime constraints overlay

This is a small system-level overlay owned by the harness, not the repo.

It should cover runtime facts that may change independently of the base prompt, such as:

- tool availability disclaimers
- current turn/soft-stop behavior
- short-lived guardrails for a specific runtime version
- environment facts that should not be baked into the base prompt file

This keeps the base prompt stable while letting runtime-specific guidance evolve.

#### 3. Repo-local instructions

The first repo-local instruction source should be the root `AGENTS.md` only.

The runtime should:

- look for `/home/chicks/workspaces/malkier/AGENTS.md`
- include it when present
- skip silently when absent

Nested lookup can come later.

This layer is important because it carries project-specific rules such as:

- use memory-manager
- use continuum-task for medium/large work
- use `malkier-ui` for Solid UI work

Those are not part of the universal Malkier identity. They are repo-local operating instructions.

#### 4. Mode overlay

Modes are small instruction overlays that change how the agent approaches a task without replacing the whole prompt.

The first modes should be:

- `default`
- `review`

`default` mode may be an empty overlay at first.

`review` mode should add a focused overlay describing how to behave when the user asks for a review.

Practically, a review mode overlay would say things like:

- findings first
- prioritize bugs, regressions, security issues, and missing tests
- keep severity/confidence high
- avoid style-only noise unless it blocks clarity

This is not “enforcement” in the hard sense yet. It is a dedicated instruction layer that the runtime intentionally injects when the run is in review mode.

Mode selection can be done in two ways:

1. explicit mode selected by the runtime or UI
2. inferred mode based on the user request

The first implementation should support both, but explicit mode should win over inference.

#### 5. Skill overlays

Skills already exist in `.agents/skills` and are one of the most valuable immediate extensions of Malkier's capabilities.

The runtime should treat a selected skill as an additional instruction layer.

Practically, a skill overlay means:

- the runtime loads the selected skill's `SKILL.md`
- the skill text is added as an additional prompt layer
- the layer metadata records which skill was loaded and from where

The first version should keep this simple:

- only explicitly selected skills are loaded
- no automatic multi-skill orchestration yet
- load order should be deterministic

When multiple skills are selected, they should be ordered by selection order.

#### 6. Subagent overlay

Subagents should eventually be modeled as separate agent runs with a derived instruction stack, not as “the same agent but with a different name.”

Practically, a subagent invocation should create a new runtime stack made from:

1. base system prompt
2. runtime constraints overlay
3. repo-local `AGENTS.md`
4. inherited mode overlay if appropriate
5. inherited skill overlays if appropriate
6. subagent-specific overlay
7. task-specific context from the parent

The subagent-specific overlay should describe:

- the subagent's narrow role
- expected scope boundaries
- required output format
- what it should return to the parent

### Why subagents need explicit design

Without explicit inheritance rules, subagents become prompt drift machines.

The practical rules should be:

- subagents always inherit the base prompt
- subagents always inherit runtime constraints
- subagents always inherit repo-local instructions
- subagents inherit mode by default unless the caller overrides it
- subagents do not automatically inherit every prior conversation message
- subagents receive a bounded task brief from the parent instead of the full transcript whenever possible
- subagents may inherit selected skills only when those skills are relevant to the delegated task

This keeps them grounded in the same product rules without exploding context size.

## Message Roles and Prompt Composition

The runtime should distinguish between:

- true system-owned instructions
- repo/context material
- conversation history

### Proposed role mapping

- Base prompt: system
- Runtime constraints overlay: system
- Repo `AGENTS.md`: system for now
- Mode overlays: system
- Skill overlays: system
- Subagent overlay: system
- Conversation messages: preserved user/assistant/tool history
- Soft-stop overlay: system

### Why treat `AGENTS.md` as system in v1

Some harnesses inject repo-local instructions as user-role content. That is a valid design, but for Malkier v1 the more practical choice is to treat root `AGENTS.md` as a system-owned overlay because:

- it behaves more like project policy than ordinary conversation context
- it avoids accidental dilution of important repo rules
- it is easier to reason about in the first implementation

If that creates unwanted rigidity later, we can revisit role placement once nested instruction layers and more advanced composition exist.

## Prompt Assembler

Prompt assembly should move into a dedicated runtime module.

For example:

- `apps/api/src/agent/prompt-assembly.ts`

That module should be responsible for:

- discovering applicable layers
- loading layer content
- assembling the ordered prompt messages
- returning metadata about which layers were used

### Suggested interface

The exact type names may change, but conceptually it should return:

```ts
type PromptLayer = {
  id: string
  kind: "base" | "runtime" | "repo" | "mode" | "skill" | "subagent" | "soft-stop"
  role: "system"
  source: string
  content: string
  sha256: string
}

type AssembledPrompt = {
  prompt: Prompt.RawInput
  layers: ReadonlyArray<PromptLayer>
}
```

This keeps prompt construction and prompt visibility tied together.

## Mode Overlays in Practice

The main concern raised in feedback was that “mode overlays” are easy to understand conceptually but fuzzy practically.

Here is the practical model.

### Example: default mode

Default mode may add nothing at first.

The base prompt already describes normal implementation behavior.

### Example: review mode

Review mode would inject a short overlay like:

```md
## Review Mode

- Treat this run as a code review.
- Findings come before summaries.
- Prioritize bugs, regressions, security issues, risky assumptions, and missing validation.
- Prefer high-confidence findings over speculative or stylistic comments.
- If no meaningful findings are present, say so explicitly.
```

What changes practically is not the tool surface or the whole system prompt. What changes is the instruction layer the runtime adds before the conversation messages.

That gives us:

- a concrete place to encode review behavior
- tests that can assert review mode changes the prompt assembly
- future UI/debug surfaces that can show “review mode active”

### Future modes

Potential future overlays:

- `explain`
- `research`
- `task-loop`

But those should only be added once there is a real need.

## Skill Loading in Practice

The runtime should not automatically scan and inject all skills.

Instead, it should support an explicit list of selected skills for a run.

### Practical flow

1. The caller selects one or more skills.
2. The runtime resolves each skill path under `.agents/skills/<name>/SKILL.md`.
3. The runtime loads the file content.
4. Each selected skill becomes a prompt layer.
5. The assembler records each loaded skill in the layer metadata.

### Why explicit selection first

This avoids three problems:

- surprise prompt bloat
- accidental conflicting instructions
- unclear behavior when many skills exist in the repo

It also matches how the project is already used manually.

## Subagents in Practice

The design doc needs to be concrete here because “subagent” can mean many different things.

### Proposed practical model

A subagent is a separate agent run created by the parent agent for a bounded job.

Examples:

- explore the codebase for relevant files
- review a proposed patch for bugs
- investigate a failing test

### Parent responsibilities

The parent agent should:

- decide whether a subagent is useful
- choose the subagent role
- prepare a bounded task brief
- choose what context and skills to pass down
- consume the returned result

### Subagent responsibilities

The subagent should:

- operate only within the brief it was given
- follow inherited product and repo rules
- return a compact artifact to the parent

### First practical output contract

Subagents should return structured text or a simple object containing:

- summary
- findings or result
- relevant file references
- any open uncertainty

The parent remains responsible for the final user-facing answer.

### What subagents should not do in v1

- they should not automatically share full long transcripts
- they should not silently mutate the parent's prompt stack
- they should not become hidden magic workers with invisible context

## Visibility and Debugging

Visibility is a hard requirement for this design.

Every run should be able to report which layers were active.

### Minimum metadata to persist

- layer order
- layer kind
- source path or source name
- content hash
- mode
- selected skills
- whether root `AGENTS.md` was loaded

### Desired debug output

At minimum, a developer should be able to inspect something like:

```json
{
  "layers": [
    { "kind": "base", "source": "apps/api/src/agent/prompts/malkier-base-system-prompt.md", "sha256": "..." },
    { "kind": "repo", "source": "AGENTS.md", "sha256": "..." },
    { "kind": "mode", "source": "review", "sha256": "..." },
    { "kind": "skill", "source": ".agents/skills/coding-standards/SKILL.md", "sha256": "..." }
  ]
}
```

This does not need to expose the full text in the first version. Hashes and sources are enough to start.

## Testing Strategy

Layering needs both unit tests and behavior validation.

### Prompt assembly tests

- base prompt is always included
- root `AGENTS.md` is loaded when present
- mode overlays appear in the correct order
- selected skills are loaded in the requested order
- soft-stop overlay is appended only when needed
- missing optional layers fail safely

### Behavioral evals later

After runtime layering is in place, add evals such as:

- repo instruction changes behavior in a measurable way
- review mode produces findings-first output
- a loaded skill changes workflow without breaking honesty or tool use

## Implementation Plan

### Phase 1: Centralize assembly

- create prompt assembler module
- keep behavior equivalent to current runtime
- return layer metadata

### Phase 2: Root repo instructions

- load root `AGENTS.md`
- include it in the layer metadata
- add tests for presence/absence

### Phase 3: Mode overlays

- add `default` and `review`
- make mode explicit in runtime metadata
- add tests for mode selection and prompt composition

### Phase 4: Skill overlays

- support explicit skill selection
- load `.agents/skills/<name>/SKILL.md`
- include selected skills in metadata

### Phase 5: Subagent inheritance contract

- define derived prompt assembly for subagents
- add prompt-layer metadata for subagent runs
- keep context bounded

## Open Questions

These do not block the design, but they should be answered during implementation.

1. Should root `AGENTS.md` always be treated as a system layer, or should we eventually move it to user-context style injection?
2. How should mode be chosen in the API: explicit request field, inferred request classification, or both?
3. Where should selected skills come from in the runtime API: request payload, session state, or a separate selection service?
4. Should the full assembled layer list be persisted with every session message, or only run-level metadata?
5. When subagents arrive, should they inherit parent-selected skills by default or only when explicitly requested by the parent?

## Recommendation

Implement layering in the smallest useful slice:

1. prompt assembler module
2. root `AGENTS.md` support
3. `review` mode overlay
4. layer metadata visibility

That is enough to move Malkier from “better prompt” to “real layered instruction runtime” without overbuilding the system too early.
