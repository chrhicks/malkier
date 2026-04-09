# Claude Code

## Research stance

Claude Code has strong official documentation for instruction layering, memory, subagents, permissions, hooks, skills, and output-style prompt mutation. Anthropic does not publish the full current default main-agent system prompt, so the best public picture is:

- official docs + official repo prompt-bearing files
- then community/leaked prompt captures, clearly labeled as unofficial

## Official sources

### Prompt layering and memory

- `Modifying system prompts`
  - URL: <https://docs.anthropic.com/en/docs/claude-code/sdk/modifying-system-prompts>
  - Why it matters: strongest official statement about prompt layering.
  - Key excerpt: "The Agent SDK uses a minimal system prompt by default... To include the full Claude Code system prompt, specify `preset: \"claude_code\"`."

- `How Claude remembers your project`
  - URL: <https://docs.anthropic.com/en/docs/claude-code/memory>
  - Why it matters: canonical source for `CLAUDE.md`, `.claude/rules/`, and auto memory.
  - Key excerpt: "CLAUDE.md content is delivered as a user message after the system prompt, not as part of the system prompt itself."

- `Create custom subagents`
  - URL: <https://docs.anthropic.com/en/docs/claude-code/sub-agents>
  - Why it matters: explains prompt isolation for built-in and custom subagents.
  - Key excerpt: custom subagents get their own prompt plus environment details, not the full Claude Code main prompt.

### Tooling, hooks, permissions, and styles

- `Tools reference`
  - URL: <https://code.claude.com/docs/en/tools-reference.md>
  - Why it matters: official list of tool names and behavior surfaces.

- `CLI reference`
  - URL: <https://code.claude.com/docs/en/cli-reference.md>
  - Why it matters: documents `--system-prompt`, `--append-system-prompt`, `--agent`, `--agents`, tool restrictions, and `--bare`.
  - Key idea: Anthropic recommends appending rather than replacing for most use cases.

- `Extend Claude with skills`
  - URL: <https://code.claude.com/docs/en/skills.md>
  - Why it matters: shows how task-specific instruction packs are discovered and loaded.

- `Hooks reference`
  - URL: <https://code.claude.com/docs/en/hooks.md>
  - Why it matters: shows that behavior enforcement is not prompt-only. Hooks can inject or block behavior at lifecycle boundaries.

- `Configure permissions`
  - URL: <https://code.claude.com/docs/en/permissions.md>
  - Why it matters: documents allow/ask/deny rules and command restrictions that backstop prompt guidance.

- `Output styles`
  - URL: <https://code.claude.com/docs/en/output-styles.md>
  - Why it matters: confirms output styles directly modify the system prompt.

- `How Claude Code works`
  - URL: <https://code.claude.com/docs/en/how-claude-code-works.md>
  - Why it matters: high-level explanation of the agent loop, context, tools, memory, and subagents.

- `Explore the .claude directory`
  - URL: <https://code.claude.com/docs/en/claude-directory.md>
  - Why it matters: maps prompt-like artifacts: `CLAUDE.md`, rules, skills, commands, agents, output styles, and memory.

- `Extend Claude Code`
  - URL: <https://code.claude.com/docs/en/features-overview.md>
  - Why it matters: compares `CLAUDE.md`, skills, rules, subagents, hooks, and MCP as distinct behavior layers.

- `Best practices`
  - URL: <https://code.claude.com/docs/en/best-practices.md>
  - Why it matters: first-party behavioral guidance for concise `CLAUDE.md`, planning, verification, permissions, and context discipline.

- `Run Claude Code programmatically`
  - URL: <https://code.claude.com/docs/en/headless.md>
  - Why it matters: clarifies behavior in non-interactive and automation flows.

## Official prompt-bearing repo files

### Agent generation and design

- `plugins/plugin-dev/skills/agent-development/references/agent-creation-system-prompt.md`
  - URL: <https://raw.githubusercontent.com/anthropics/claude-code/main/plugins/plugin-dev/skills/agent-development/references/agent-creation-system-prompt.md>
  - Why it matters: Anthropic explicitly labels this as "the exact system prompt used by Claude Code's agent generation feature".
  - Important themes:
    - extract intent and success criteria
    - design an expert persona
    - define boundaries, methodology, and edge cases
    - include quality control and self-verification
    - generate examples showing proactive agent invocation

- `plugins/plugin-dev/skills/agent-development/references/system-prompt-design.md`
  - URL: <https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/agent-development/references/system-prompt-design.md>
  - Why it matters: template-like guidance for writing strong prompts for analysis, generation, validation, and orchestration agents.

### Subagents and command prompts

- `plugins/feature-dev/agents/code-reviewer.md`
  - URL: <https://raw.githubusercontent.com/anthropics/claude-code/main/plugins/feature-dev/agents/code-reviewer.md>
  - Why it matters: real specialist prompt for high-confidence code review.
  - Key excerpt: "Only report issues with confidence >= 80."

- `plugins/feature-dev/agents/code-explorer.md`
  - URL: <https://github.com/anthropics/claude-code/blob/main/plugins/feature-dev/agents/code-explorer.md>
  - Why it matters: shows a deliberate exploration workflow with file:line outputs and architecture tracing.

- `plugins/feature-dev/agents/code-architect.md`
  - URL: <https://github.com/anthropics/claude-code/blob/main/plugins/feature-dev/agents/code-architect.md>
  - Why it matters: shows how Anthropic encodes planning and architecture decisions in a specialist prompt.

- `plugins/code-review/commands/code-review.md`
  - URL: <https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md>
  - Why it matters: orchestrator prompt for PR review, including multiple subagents and high-signal filtering.

### Output-style prompt injections

- `plugins/explanatory-output-style/hooks-handlers/session-start.sh`
  - URL: <https://github.com/anthropics/claude-code/blob/main/plugins/explanatory-output-style/hooks-handlers/session-start.sh>
  - Why it matters: real prompt injection showing how explanation mode modifies behavior.

- `plugins/learning-output-style/hooks-handlers/session-start.sh`
  - URL: <https://github.com/anthropics/claude-code/blob/main/plugins/learning-output-style/hooks-handlers/session-start.sh>
  - Why it matters: demonstrates an alternate teaching-oriented instruction overlay.

### Repo-local instruction examples from Anthropic

- `claude-agent-sdk-python/CLAUDE.md`
  - URL: <https://github.com/anthropics/claude-agent-sdk-python/blob/main/CLAUDE.md>
  - Why it matters: shows how Anthropic itself writes repo-local project guidance.

- `claude-agent-sdk-python/.claude/agents/test-agent.md`
  - URL: <https://github.com/anthropics/claude-agent-sdk-python/blob/main/.claude/agents/test-agent.md>
  - Why it matters: minimal example of custom subagent markdown.

- `claude-agent-sdk-python/.claude/commands/commit.md`
  - URL: <https://github.com/anthropics/claude-agent-sdk-python/blob/main/.claude/commands/commit.md>
  - Why it matters: concrete command prompt for a git commit workflow.

- `claude-agent-sdk-python/examples/system_prompt.py`
  - URL: <https://github.com/anthropics/claude-agent-sdk-python/blob/main/examples/system_prompt.py>
  - Why it matters: official example showing string prompts, preset prompts, and preset-plus-append usage.

- `claude-agent-sdk-python/examples/setting_sources.py`
  - URL: <https://github.com/anthropics/claude-agent-sdk-python/blob/main/examples/setting_sources.py>
  - Why it matters: official example for how settings sources control loading of prompts, commands, and agents.

## Community and leaked sources

These are useful for studying likely main-agent prompt structure, but they are not official.

- `transitive-bullshit` gist
  - URL: <https://gist.github.com/transitive-bullshit/487c9cb52c75a9701d312334ed53b20c>
  - Notes: strongest unofficial capture found; includes early system prompt and tool definitions.

- `armstrongl` gist
  - URL: <https://gist.github.com/armstrongl/7320839f0da33308c6335fee905f1d42>
  - Notes: later richer capture with `TodoWrite`, plan-mode style behaviors, stronger tool-use guidance.

- `matthew-lim/claude-code-system-prompt`
  - URL: <https://github.com/matthew-lim-matthew-lim/claude-code-system-prompt/blob/main/claudecode.md>
  - Notes: transcript-style runtime capture.

- `asgeirtj/system_prompts_leaks`
  - URL: <https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code.md>
  - Notes: useful archive/mirror, weaker provenance than primary captures.

## Common Claude Code themes

- Instructions are layered.
  - Base prompt, then project memory/instructions, then task-specific overlays such as output styles, skills, commands, and subagents.

- `CLAUDE.md` is not the system prompt.
  - It is loaded as user-role context after the system prompt.

- Specialist prompts matter.
  - Anthropic ships many narrow prompts for review, exploration, architecture, explanation, and agent generation.

- Runtime enforcement complements prompt guidance.
  - Hooks, permissions, and output styles materially change behavior outside the core prompt.

- High-signal review is explicit.
  - The official reviewer prompt strongly filters findings rather than rewarding volume.

## Implications for Malkier

- Keep the main prompt compact, but support strong layered instruction sources.
- Treat repo-local guidance as context with explicit precedence, not as an undocumented magic file.
- Use specialized prompts or skills for review/exploration/planning instead of putting every behavior in one giant system prompt.
- Backstop prompt behavior with real runtime policy for approvals, tools, and hooks.
