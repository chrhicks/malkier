# Codex

## Research stance

Codex is the most transparent of the three harnesses for core built-in prompts. Major prompt files live in the public `openai/codex` repo, and OpenAI documents AGENTS layering, sandboxing, approvals, hooks, skills, and subagents separately.

## Official prompt files

### Main coding-agent prompts

- `codex-rs/core/gpt-5.1-codex-max_prompt.md`
  - URL: <https://github.com/openai/codex/blob/main/codex-rs/core/gpt-5.1-codex-max_prompt.md>
  - Why it matters: OpenAI's cookbook says the recommended starter prompt began as this default prompt.

- `codex-rs/core/gpt_5_1_prompt.md`
  - URL: <https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_1_prompt.md>
  - Why it matters: fuller prompt for a later GPT-5.1 Codex family.

- `codex-rs/core/gpt_5_2_prompt.md`
  - URL: <https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/gpt_5_2_prompt.md>
  - Why it matters: strong modern example of the built-in coding-agent prompt.
  - Key excerpt themes from the file:
    - AGENTS scope and precedence
    - autonomy and persistence
    - plan hygiene
    - focused validation and testing
    - dirty-worktree discipline
    - concise final-answer formatting

- `codex-rs/core/gpt_5_codex_prompt.md`
  - URL: <https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_codex_prompt.md>
  - Why it matters: compact official prompt for `gpt-5-codex`.

- `codex-rs/core/prompt_with_apply_patch_instructions.md`
  - URL: <https://github.com/openai/codex/blob/main/codex-rs/core/prompt_with_apply_patch_instructions.md>
  - Why it matters: shows how OpenAI teaches patch grammar when the patch tool is exposed as freeform text.

### Review-specific prompt

- `codex-rs/core/review_prompt.md`
  - URL: <https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/review_prompt.md>
  - Why it matters: explicit reviewer prompt with severity tiers and structured output.
  - Key excerpt themes:
    - only flag real, discrete bugs
    - prioritize findings by severity
    - brief, actionable output
    - overall correctness verdict

### Instruction layering message

- `codex-rs/core/hierarchical_agents_message.md`
  - URL: <https://github.com/openai/codex/blob/main/codex-rs/core/hierarchical_agents_message.md>
  - Why it matters: short canonical rule for AGENTS scope/override behavior.

- repo root `AGENTS.md`
  - URL: <https://github.com/openai/codex/blob/main/AGENTS.md>
  - Why it matters: real example of how the Codex team writes repo-local instructions for a coding agent working inside the Codex codebase.

## Official docs and guides

### AGENTS and instruction layering

- `Custom instructions with AGENTS.md`
  - URL: <https://developers.openai.com/codex/guides/agents-md>
  - Why it matters: best official explanation of global + project + nested instruction loading.
  - Key excerpt: Codex reads `AGENTS.md` files before doing any work and concatenates them root-to-leaf.

- `Config basics`, `Advanced config`, `Config reference`
  - URLs:
    - <https://developers.openai.com/codex/config-basic>
    - <https://developers.openai.com/codex/config-advanced>
    - <https://developers.openai.com/codex/config-reference>
  - Why they matter: they define config precedence and prompt-related knobs such as `developer_instructions`, `model_instructions_file`, and AGENTS size caps.

### Prompting, skills, subagents, and workflows

- `Codex Prompting Guide`
  - URL: <https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide/>
  - Why it matters: the strongest official harness-builder guide.
  - Important guidance:
    - start from the standard Codex-Max prompt
    - preserve autonomy/tool-use sections
    - remove over-eager upfront-plan or preamble prompting during rollout
    - prefer the exact `apply_patch` implementation and familiar shell-like tool shapes
    - parallelize read/search operations explicitly

- `Customization`
  - URL: <https://developers.openai.com/codex/concepts/customization/>
  - Why it matters: high-level model of AGENTS + skills + MCP + subagents.

- `Skills`
  - URL: <https://developers.openai.com/codex/skills/>
  - Why it matters: documents progressive disclosure for reusable instruction bundles.

- `Subagents` and `Subagent concepts`
  - URLs:
    - <https://developers.openai.com/codex/subagents/>
    - <https://developers.openai.com/codex/concepts/subagents/>
  - Why they matter: explain context-avoidance, role separation, and custom agent instructions.

- `Workflows`
  - URL: <https://developers.openai.com/codex/workflows/>
  - Why it matters: de facto prompting guidance for common coding tasks.

- `Best practices`
  - URL: <https://developers.openai.com/codex/learn/best-practices/>
  - Why it matters: concise first-party guidance on what users should tell Codex and what habits improve reliability.

### Safety, rules, and approvals

- `Agent approvals & security`
  - URL: <https://developers.openai.com/codex/agent-approvals-security/>
  - Why it matters: sandbox/approval policy backstops prompt guidance.

- `Sandboxing`
  - URL: <https://developers.openai.com/codex/concepts/sandboxing/>
  - Why it matters: explains why shell behavior is constrained by runtime, not just prompt text.

- `Rules`
  - URL: <https://developers.openai.com/codex/rules/>
  - Why it matters: command policy outside the base prompt.

- `Hooks`
  - URL: <https://developers.openai.com/codex/hooks/>
  - Why it matters: shows where runtime scripts can inject or block behavior.

- `Non-interactive Mode`
  - URL: <https://developers.openai.com/codex/noninteractive/>
  - Why it matters: documents automation behavior and event streaming outside the interactive CLI.

- `Slash commands`
  - URL: <https://developers.openai.com/codex/cli/slash-commands/>
  - Why it matters: shows the user-visible control plane for planning, permissions, review, compacting, and agent selection.

## Community and unofficial sources

Useful for triangulation, but lower-trust than OpenAI's own repo/docs.

- `allgemeiner-intellekt/codex-system-prompt`
  - URL: <https://github.com/allgemeiner-intellekt/codex-system-prompt>
  - Notes: extracted prompt artifacts from Codex data sources; useful for comparing with official repo prompt files.

- `asgeirtj/system_prompts_leaks`
  - URLs:
    - <https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/codex-cli.md>
    - <https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/gpt-5.3-codex.md>
  - Notes: archival snapshots, not primary sources.

- `letta-ai/letta-code` prompt notes
  - URL: <https://github.com/letta-ai/letta-code/blob/main/src/agent/prompts/README.md>
  - Notes: comparative commentary on Codex prompt families; useful but unofficial.

## Common Codex themes

- The prompt is explicit about operating as a harnessed coding agent.
  - It names AGENTS, planning tools, patch tools, shell behavior, and final-answer formatting directly.

- Instruction layering is first-class.
  - Global AGENTS, project AGENTS, nested overrides, config files, hooks, skills, and subagents are all documented.

- The prompt assumes autonomy.
  - Codex is instructed to implement, validate, and persist unless blocked.

- The prompt is safety-conscious but action-biased.
  - Avoid destructive git, respect dirty worktrees, use the sandbox/approval model, and keep edits focused.

- Tool ergonomics matter.
  - OpenAI recommends exact or near-exact tool shapes for shell/apply_patch/update_plan because the model is tuned for them.

## Implications for Malkier

- Publish the core prompt if possible, or at least keep it reviewable in-repo.
- Make instruction layering explicit and observable.
- Separate main coding mode from review mode with dedicated instructions.
- Prefer tools with clear names and familiar behavior over vague or overloaded tool surfaces.
- Use runtime approvals/sandboxing as the hard layer beneath the soft prompt layer.
