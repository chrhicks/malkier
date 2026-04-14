# Tool Evals

This directory holds isolated evals for Malkier's agent behavior.

## Layout

- `core.ts`: shared eval schemas, assertion helpers, transcript capture, metadata, and artifact writing.
- `runtime.ts`: shared live-eval runtime wiring for prompt construction, agent/session layers, metadata helpers, and CLI execution.
- `*-lib.ts`: rubric logic for one eval.
- `*.test.ts`: deterministic unit tests for one rubric.
- `*.ts`: live eval runner for one eval.
- `results/<eval-name>/`: latest and timestamped JSON artifacts for live runs.

## Conventions

- Keep grading logic separate from live execution.
- Prefer grounded assertions over text heuristics when possible.
- Every live eval artifact should include:
  - `gitSha`
  - prompt file path
  - prompt hash
  - run timing metadata
- Rubric tests should include both positive and negative examples.

## Commands

- `bun run eval:test`: run deterministic rubric tests.
- `bun run eval:hello-no-tool`: run the first no-tool eval.
- `bun run eval:must-use-tool`: run the tool-required eval.
- `bun run eval:unavailable-capability-honesty`: run the unsupported-side-effect honesty eval.
- `bun run eval:bounded-edit-and-test`: run the bounded edit-and-test fixture eval.
- `bun run eval:review-known-bug`: run the seeded code review eval.
- `bun run eval:repo-grounded-approach`: run the repo-grounded architecture-answer eval.
- `bun run eval:all`: run all live evals sequentially.

## Environment

Live evals use the same defaults as the current agent harness unless overridden:

- `MALKIER_AGENT_MODEL`
- `MALKIER_AGENT_API_URL`
- `MALKIER_AGENT_TEMPERATURE`
- `MALKIER_AGENT_REASONING_EFFORT`
- `MALKIER_AGENT_VERBOSITY`
- `MALKIER_AGENT_MAX_COMPLETION_TOKENS`
- `OPENCODE_ZEN_API_KEY`

If `MALKIER_DB_PATH` is not set, evals default to an isolated sqlite database at `tool_eval/results/.data/malkier-eval.sqlite` so they do not pollute the app's normal local state.
