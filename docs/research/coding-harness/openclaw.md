# OpenClaw

## Research stance

OpenClaw exposes more of its prompt assembly in source than Claude Code, but it also has more documentation drift. The most authoritative material is the current source and first-party docs, followed by official template files and official repo-local skills/prompts. Community SOUL/AGENTS examples are useful, but often outdated.

## Official source of truth

### Prompt assembly

- `docs/concepts/system-prompt.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/concepts/system-prompt.md>
  - Why it matters: best official explainer of prompt assembly.
  - Key excerpt themes:
    - OpenClaw builds a custom OpenClaw-owned system prompt.
    - Structured tools are the source of truth.
    - Prompt sections are fixed and intentionally compact.
    - Provider plugins can replace small named sections or add stable/dynamic injections.

- `src/agents/system-prompt.ts`
  - URL: <https://github.com/openclaw/openclaw/blob/main/src/agents/system-prompt.ts>
  - Why it matters: actual prompt builder in source.
  - Key themes from the source inventory:
    - execution bias
    - tool call style
    - safety
    - messaging / silent replies
    - runtime information
    - skills loading hints

- `src/agents/workspace.ts`
  - URL: <https://github.com/openclaw/openclaw/blob/main/src/agents/workspace.ts>
  - Why it matters: defines workspace bootstrap filenames and allowlists.

- `src/agents/bootstrap-files.ts`
  - URL: <https://github.com/openclaw/openclaw/blob/main/src/agents/bootstrap-files.ts>
  - Why it matters: real logic for which workspace files are injected and how they are truncated.

### Workspace and bootstrapping docs

- `Agent Bootstrapping`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/start/bootstrapping.md>
  - Why it matters: explains first-run workspace seeding.

- `Agent Workspace`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/concepts/agent-workspace.md>
  - Why it matters: maps workspace files such as `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `TOOLS.md`, `HEARTBEAT.md`, daily memory, and `MEMORY.md`.

- `Default AGENTS reference page`
  - URL: <https://openclawlab.com/en/docs/reference/agents.default/>
  - Why it matters: first-party user-facing reference for the default workspace handbook.

- `Workspace Files`
  - URL: <https://openclawlab.com/en/docs/agent/workspace-files/>
  - Why it matters: high-level guide to which workspace files shape behavior.

- `Sub-Agents`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/tools/subagents.md>
  - Why it matters: explains subagent behavior, limits, and context inheritance.

## Official workspace templates

These are not the immutable built-in system prompt, but they are first-party instruction files meant to be injected into the workspace context.

- `docs/reference/templates/AGENTS.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/AGENTS.md>
  - Why it matters: baseline workspace handbook.
  - Key excerpt themes:
    - session startup ritual: read `SOUL.md`, `USER.md`, and recent memory
    - memory maintenance
    - external-vs-internal action boundaries
    - group-chat participation rules
    - heartbeat-driven proactive work

- `docs/reference/templates/SOUL.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/SOUL.md>
  - Why it matters: explicit persona layer.
  - Key excerpt: "You're not a chatbot. You're becoming someone."
  - Important themes:
    - be genuinely helpful, not performatively helpful
    - have opinions
    - be resourceful before asking
    - earn trust through competence
    - respect intimacy and privacy

- `docs/reference/templates/IDENTITY.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/IDENTITY.md>
  - Why it matters: structured self-description.

- `docs/reference/templates/USER.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/USER.md>
  - Why it matters: structured user profile.

- `docs/reference/templates/TOOLS.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/TOOLS.md>
  - Why it matters: environment-specific local notes, not tool availability.

- `docs/reference/templates/BOOTSTRAP.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/BOOTSTRAP.md>
  - Why it matters: first-run ritual instructions.

- `docs/reference/templates/CLAUDE.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/docs/reference/templates/CLAUDE.md>
  - Why it matters: compatibility alias showing that OpenClaw expects `AGENTS.md` semantics rather than a separate `CLAUDE.md` meaning.

- dev template variants such as `AGENTS.dev.md`, `SOUL.dev.md`, `IDENTITY.dev.md`, `USER.dev.md`, and `TOOLS.dev.md`
  - URL root: <https://github.com/openclaw/openclaw/tree/main/docs/reference/templates>
  - Why they matter: first-party examples of more opinionated, persona-heavy workspace instructions.

## Official repo-local prompt artifacts

These are prompt-like assets for contributors or repo-local agents, not universal runtime behavior.

- repo root `AGENTS.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/AGENTS.md>
  - Why it matters: extremely detailed contributor instructions for coding agents on the OpenClaw repo.

- `skills/coding-agent/SKILL.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/skills/coding-agent/SKILL.md>
  - Why it matters: first-party coding-agent delegation skill.

- `.pi/prompts/cl.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/.pi/prompts/cl.md>
  - Why it matters: codebase-specific coding patterns.

- `.pi/prompts/reviewpr.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/.pi/prompts/reviewpr.md>
  - Why it matters: explicit PR review prompt.

- `.pi/prompts/is.md`
  - URL: <https://github.com/openclaw/openclaw/blob/main/.pi/prompts/is.md>
  - Why it matters: issue-analysis prompt.

- maintainer skills under `.agents/skills/`
  - URLs live under the repo; examples include PR maintainer, release maintainer, GHSA maintainer, QA testing, and heap leak investigation.
  - Why they matter: strong evidence that OpenClaw treats specialist instruction packs as first-class behavior shapers.

## Documentation drift and uncertainty

OpenClaw has meaningful drift between docs and runtime around subagent/bootstrap injection.

- Official docs have stated that subagents only inject `AGENTS.md` and `TOOLS.md`.
- Current source and official issues/PRs indicate that `SOUL.md`, `IDENTITY.md`, and `USER.md` have also been included in allowlists in some versions.
- Official issues documenting this mismatch:
  - `#24852`: subagents not loading `SOUL.md` / `IDENTITY.md` / `USER.md`
  - `#24979`: PR to include those files in subagent/cron allowlists
  - `#27038`: docs incorrect, `SOUL.md` injected in subagents
  - `#53547`: regression report for bootstrap files not loaded from workspace
  - `#42861`: open PR for per-account `SOUL` files, useful as a boundary between current and proposed behavior

Implication: for OpenClaw, source wins over docs when there is conflict.

## Community sources

Useful examples, but not authoritative.

- `awesome-openclaw-agents`
  - URL: <https://github.com/mergisi/awesome-openclaw-agents>
  - Notes: broad corpus of user-authored `SOUL.md` personas.

- Matt Berman `SOUL.md` gist
  - URL: <https://gist.github.com/mberman84/cd6924c7058ba5251a773dac177ae756>
  - Notes: widely shared persona example.

- `openclaw-runbook` agent prompt examples
  - URL: <https://github.com/digitalknk/openclaw-runbook/blob/main/examples/agent-prompts.md>
  - Notes: useful prompt examples, but some claims conflict with current official runtime behavior.

- fan guides such as `openclaws.io` or `stanza.dev`
  - Notes: often explain SOUL/persona ideas well, but frequently use outdated paths or prompt-composition claims.

## Common OpenClaw themes

- OpenClaw treats workspace files as part of agent identity and continuity, not just project coding instructions.
- The harness distinguishes between built-in prompt assembly and injected user-authored files.
- Persona is explicit.
  - `SOUL.md` is a first-class customization mechanism, not an accidental side channel.
- Prompt content is compact, but the workspace bootstrap can still become large and token-expensive.
- Runtime/tool policy is still needed because prompt guidance is advisory.

## Implications for Malkier

- Be explicit about what is built-in prompt text versus injected project/user context.
- If Malkier wants a persona layer, keep it separate from coding-policy layers.
- Keep memory/bootstrap injection bounded and inspectable.
- Prefer source-backed docs and make drift visible when runtime behavior changes.
