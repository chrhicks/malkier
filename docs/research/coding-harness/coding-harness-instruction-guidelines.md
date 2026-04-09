# Coding Harness Instruction Guidelines

This document distills common themes from Claude Code, Codex, and OpenClaw into practical guidance for designing a strong coding-agent system prompt and instruction stack for Malkier.

## 1. Define the operating model clearly

The prompt should say what the agent is, where it is running, and what kind of work it is expected to complete.

- State that the agent is a coding agent working in a local workspace with tools.
- State that it should solve the task end-to-end when feasible, not stop at plans or vague advice.
- State what kinds of actions are in-bounds: reading code, editing files, running commands, reviewing changes, and reporting results.

Without this, the model often falls back to generic assistant behavior.

## 2. Separate built-in prompt from layered instructions

All three harnesses rely on layered guidance. The base prompt should not carry the entire system.

- Define what belongs in the base system prompt.
- Define what belongs in repo-local instruction files.
- Define what belongs in task-specific skills or slash-command prompts.
- Define what subagents inherit and what they do not.

For Malkier, this should be explicit and inspectable. Hidden or ambiguous precedence leads to inconsistent behavior.

## 3. Teach tool selection, not just tool availability

The prompt should teach:

- prefer dedicated tools over shell when both exist
- when shell is appropriate as an escape hatch
- when to batch reads/searches in parallel
- when to stop exploring and start acting

Good coding harnesses do not just list tools. They teach decision rules for using them.

## 4. Make autonomy explicit, but bounded

The prompt should encourage forward progress without waiting for needless confirmation.

- Bias toward implementation when the user clearly wants work done.
- Gather context proactively.
- Persist through minor failures and resolve blockers where possible.
- Stop and ask when the task is genuinely ambiguous, unsafe, or externally consequential.

Autonomy should feel like a senior engineer, not an unbounded actor.

## 5. Require evidence-backed claims

This is the most important addition for Malkier.

The prompt should explicitly forbid claiming that something happened unless the harness has evidence for it.

- Do not say a file was changed unless a file-edit tool or diff confirms it.
- Do not say tests were run unless a test command actually ran.
- Do not say a task note was posted or a task was completed unless the relevant task operation actually succeeded.
- Do not say work is closure-ready unless the verification step actually happened.

This should be phrased as a hard behavioral rule, not a soft preference.

## 6. Teach dirty-worktree discipline

Strong coding harnesses assume the worktree may already be dirty.

- Do not revert unrelated user changes.
- Do not overwrite or clean up changes you did not make.
- If unrelated changes conflict with the task, stop and ask.
- Otherwise work around them and stay focused.

This is foundational for trust.

## 7. Constrain destructive and high-risk actions

The prompt should give crisp rules for risky operations:

- avoid destructive git commands unless explicitly requested
- do not amend or force-push unless clearly requested
- do not expose secrets or commit secret-bearing files casually
- ask before external or irreversible actions

Prompt guidance should be reinforced by runtime permissions or approvals when possible.

## 8. Define editing philosophy

The best harness prompts shape how code gets changed, not just whether it gets changed.

- prefer minimal correct changes
- fix root causes over surface symptoms when practical
- follow existing repo conventions
- avoid speculative refactors and unrelated cleanup
- prefer patch-style edits for focused updates
- keep comments sparse and useful

This keeps the model from becoming noisy, sprawling, or stylistically unstable.

## 9. Define validation philosophy

The prompt should explain how to validate work.

- start with the narrowest relevant test/build/check
- expand to broader validation as confidence grows
- do not fix unrelated failures unless asked
- state clearly when validation could not be run

Validation should be proportional, not performative.

## 10. Define progress-update behavior

Users should be able to follow along without drowning in narration.

- send short progress updates before substantial work
- group related actions into one update
- do not narrate every read/search step
- explain meaningful discoveries, blockers, and tradeoffs

The prompt should shape a calm operator-like rhythm, not constant chatter.

## 11. Define review mode separately

Review prompts are different from implementation prompts.

- default review mode should prioritize bugs, regressions, risks, and missing tests
- findings should come before summaries
- use severity or confidence thresholds to reduce noise
- avoid style-only nitpicks unless they block clarity or violate explicit standards

Claude Code and Codex both encode review as a distinct mode with its own bar for reporting.

## 12. Keep formatting guidance practical

Response formatting should help scanability, not become a second job.

- keep final answers concise by default
- use short headers only when helpful
- prefer bullets for grouped results
- reference files and commands inline
- avoid dumping long code in the final answer

Good harnesses optimize the delivery format because it feeds back into how the agent thinks about completion.

## 13. Use skills and subagents for specialization

Do not overload the main prompt with every specialized behavior.

- use skills for reusable, on-demand workflows
- use subagents for bounded research/review/implementation roles
- define what context subagents inherit
- make delegation visible in the transcript and persisted history

Specialization keeps the base prompt smaller and reduces conflicting instructions.

## 14. Keep memory and project context compact

Instruction files and memory are helpful until they become noise.

- keep durable instruction files short and concrete
- split large guidance into narrower topical files
- make injection scope explicit
- treat memory as context, not a guaranteed enforcement layer

OpenClaw is especially instructive here: rich bootstrap context is useful, but it can become token-heavy fast.

## 15. Backstop the prompt with runtime policy

Prompt text alone is not enough.

Where trust matters, the harness should add runtime support:

- approvals or permission policies for risky tools
- sandboxing and cwd restrictions
- hooks for pre/post tool-use checks
- event logging for what actually happened
- UI affordances that show evidence of actions taken

This is the difference between a persuasive assistant and a trustworthy coding harness.

## Recommended base sections for Malkier

If Malkier keeps a primary coding-agent system prompt, it should probably include at least these sections:

1. identity and operating context
2. autonomy and persistence
3. instruction precedence and repo-local guidance
4. tool-use policy
5. editing constraints
6. dirty-worktree and git safety rules
7. validation philosophy
8. evidence-backed completion rules
9. review-mode behavior
10. progress-update behavior
11. final-answer formatting

## Recommended non-prompt layers for Malkier

The prompt should not carry everything. Malkier should also have:

- repo-local instruction files for project norms
- skill files for reusable workflows
- specialized review/research prompts
- runtime approval/sandbox policy
- evals for honesty, tool use, and closure claims

## Suggested Malkier-specific additions

Based on current dogfood feedback, Malkier should add prompt language like:

- never claim an edit, test run, task note, or task completion unless it actually happened in this run
- when uncertain whether an action succeeded, say that explicitly and verify before claiming success
- if task tools are unavailable, do not imply task-side effects happened
- treat the transcript as auditable evidence, not performance theater

That last point is the real lesson from this research: the best coding harnesses are not just action-biased. They are action-biased while remaining inspectable, grounded, and honest.
