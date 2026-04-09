# Coding Harness Prompt Research

This directory collects public prompt and instruction material for three coding harnesses:

- Claude Code
- Codex
- OpenClaw

The goal is to give Malkier a durable local reference for how strong coding agents are instructed to behave.

## What is stored here

- `claude-code.md`: official docs, official prompt-bearing repo files, and clearly labeled community/leaked prompt captures.
- `codex.md`: official Codex prompt files, AGENTS.md docs, approval/sandbox guidance, and community prompt archives.
- `openclaw.md`: official source/docs for prompt assembly and workspace files, plus community examples and documentation drift notes.
- `coding-harness-instruction-guidelines.md`: distilled guidance for what a strong coding-agent system prompt should contain.

## Storage approach

This research pack stores:

- an inventory of the prompt and instruction artifacts we found
- key verbatim excerpts from the most important official sources
- provenance notes separating official material from community archives or leaked captures
- synthesis about how each harness structures behavior, tool use, safety, memory, and autonomy

It does not attempt to vendor every upstream file byte-for-byte. Some source files are large, versioned, or unstable, so the local docs preserve the important excerpts plus source URLs for follow-up inspection.

## Top-level findings

### Shared themes

- All three harnesses layer instructions rather than relying on one static monolithic prompt.
- Tool use is central: each harness spends meaningful prompt space teaching when to use tools, when not to, and how to report side effects.
- Safety is mostly a combination of prompt guidance plus runtime enforcement such as sandboxing, approvals, hooks, or permissions.
- Good coding harnesses push the model toward autonomous completion, but they also constrain destructive actions, git operations, and user-visible claims.
- Specialized instructions live outside the base prompt too: AGENTS/CLAUDE files, skills, rules, output styles, subagents, hooks, and repo-local guidance.

### Key differences

- Claude Code has the richest public documentation around instruction layering, but Anthropic does not publish the full current default main-agent prompt.
- Codex is the most transparent about core built-in prompts: major prompt files live directly in the open-source repo.
- OpenClaw exposes prompt assembly and workspace-file conventions in source and docs, but its docs and runtime behavior can drift, especially around bootstrap/subagent context.

## Why this matters for Malkier

- Malkier should treat prompt design as a harness problem, not just a single system message problem.
- The prompt should explicitly govern evidence-backed completion, tool preference, autonomy, validation, and dirty-worktree behavior.
- Repo-local instruction files and skills should be part of the design from the start, with clear precedence and compact loading rules.
- Runtime policy should backstop the prompt wherever honesty, safety, or approvals matter.
