---
name: pi-context-files
description: Author Pi context files (AGENTS.md, CLAUDE.md, SYSTEM.md). Use when writing project instructions, configuring agent behavior, or deciding where to place conventions and guidance.
---

# Pi Context Files

Context files provide durable instructions that the agent always sees. They load at startup and stay in the system prompt.

## What Are Context Files

Pi loads `AGENTS.md` (or `CLAUDE.md`) files as always-present context:

| Location                | Scope                 |
| ----------------------- | --------------------- |
| `~/.pi/agent/AGENTS.md` | Global (all projects) |
| Parent directories      | Walking up from cwd   |
| `./AGENTS.md`           | Project (cwd)         |

All matching files are **concatenated**. Disable with `--no-context-files` or `-nc`.

## System Prompt Overrides

| File                                                     | Effect                             |
| -------------------------------------------------------- | ---------------------------------- |
| `.pi/SYSTEM.md` (project)                                | Replaces the default system prompt |
| `~/.pi/agent/SYSTEM.md` (global)                         | Replaces the default system prompt |
| `.pi/APPEND_SYSTEM.md` or `~/.pi/agent/APPEND_SYSTEM.md` | Appends without replacing          |

Context files (`AGENTS.md`) are appended **after** the system prompt.

## What Belongs in Context Files

**Good candidates:**

- Project-specific conventions (naming, patterns, architecture decisions)
- Common commands (build, test, deploy)
- Technology stack and framework choices
- Code style rules and formatting preferences
- Import conventions and module organization
- What NOT to do (anti-patterns, deprecated approaches)

**Bad candidates:**

- Secrets, credentials, tokens → use environment variables
- Large API references → use skills with `references/`
- Transient task state → use session entries or tool `details`
- Complex multi-step workflows → use skills
- One-shot instructions → use prompt templates

## Hierarchy Best Practices

### Global (`~/.pi/agent/AGENTS.md`)

- Cross-project principles and safety rules
- Host-specific tool locations and paths
- Default behaviors and preferences
- Remote and git conventions

### Workspace/Parent

- Domain conventions (e.g., all projects in this workspace follow these patterns)
- Shared tooling and infrastructure details

### Project (`./AGENTS.md`)

- Project-specific architecture and file layout
- Build/test/deploy commands
- Code style and naming conventions for this codebase
- Known gotchas and constraints

## Context Files vs Skills vs Templates

| Mechanism        | Always in context  | Token cost          | When to use                             |
| ---------------- | ------------------ | ------------------- | --------------------------------------- |
| Context files    | Yes                | Constant            | Durable rules, conventions              |
| Skills           | No (on-demand)     | Only when activated | Specialized workflows, large references |
| Prompt templates | No (slash command) | Only when invoked   | Reusable prompts with arguments         |

## Checklist

- [ ] Durable, always-needed instructions in `AGENTS.md`
- [ ] No secrets or credentials in context files
- [ ] Large reference docs moved to skills
- [ ] Project-level conventions in project `AGENTS.md`
- [ ] Global conventions in `~/.pi/agent/AGENTS.md`
- [ ] No redundancy between levels — each adds new information
- [ ] System prompt override only when the default truly doesn't fit
