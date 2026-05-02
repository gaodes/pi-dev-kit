---
name: pi-patterns
description: Find the right Pi extension pattern quickly. Use when starting a new extension, looking for an example of a specific Pi API, or finding reference implementations for tools, commands, hooks, UI, providers, or session management.
---

# Pi Patterns

Indexed reference to Pi's 70+ example extensions, organized by archetype. Find the right pattern, then read its source.

## How to Use

1. Identify your extension's archetype below
2. Read the listed example files for patterns
3. See `pi-extension-authoring` skill for detailed implementation rules

Example files live in `examples/extensions/` relative to the Pi installation (`@mariozechner/pi-coding-agent`).

## Archetypes

### Minimal Tool

Single tool, minimal setup.

- `hello.ts` — simplest custom tool

### Multi-action Tool

One tool with multiple actions via `StringEnum`.

- `todo.ts` — stateful tool with persistence and custom rendering

### Tool with Custom Rendering

Override `renderCall` / `renderResult` for rich output.

- `built-in-tool-renderer.ts` — custom compact rendering for built-in tools
- `minimal-mode.ts` — override built-in rendering for minimal display
- `truncated-tool.ts` — wraps ripgrep with output truncation

### Tool with User Interaction

Tools that ask the user questions.

- `question.ts` — `ctx.ui.select()` for user choices
- `questionnaire.ts` — multi-question wizard with tab navigation
- `timed-confirm.ts` — dialogs with timeout/AbortSignal

### Dynamic Tools

Register tools at runtime, not just during load.

- `dynamic-tools.ts` — `registerTool` after startup + `promptSnippet`/`promptGuidelines`

### Structured Output

End the agent turn on a tool result.

- `structured-output.ts` — `terminate: true` for final output

### Permission Gate

Block dangerous operations.

- `permission-gate.ts` — `tool_call` hook with `ctx.ui.confirm()`
- `protected-paths.ts` — block writes to specific paths

### Event Interceptor

React to lifecycle events.

- `event-bus.ts` — inter-extension communication via `pi.events`
- `trigger-compact.ts` — trigger compaction at token thresholds
- `input-transform.ts` — rewrite user input via `input` event
- `git-checkpoint.ts` — git stash at each turn
- `auto-commit-on-exit.ts` — commit on session shutdown
- `file-trigger.ts` — file watcher triggers messages
- `model-status.ts` — react to model changes
- `system-prompt-header.ts` — display system prompt info
- `prompt-customizer.ts` — context-aware tool guidance
- `claude-rules.ts` — load rules from `.claude/rules/`

### Custom Command

Slash commands with custom behavior.

- `commands.ts` — basic command registration
- `preset.ts` — saveable presets with shortcuts and flags

### Custom UI / Overlay

Interactive components replacing the editor.

- `qna.ts` — extract questions into editor
- `overlay-test.ts` — overlay compositing
- `snake.ts` — full game with keyboard handling
- `space-invaders.ts` — game with animation loop

### Status, Widget, Footer

Persistent UI elements.

- `status-line.ts` — footer status via `ctx.ui.setStatus()`
- `working-indicator.ts` — custom streaming indicator
- `widget-placement.ts` — widgets above/below editor
- `custom-footer.ts` — replace footer entirely
- `custom-header.ts` — replace startup header
- `border-status-editor.ts` — editor border customization

### Custom Editor

Replace the input editor.

- `modal-editor.ts` — vim-like modal editing
- `rainbow-editor.ts` — animated editor styling

### Subagent

Spawn isolated agent sessions.

- `subagent/` — planner, reviewer, scout, worker agents

### Plan Mode

Read-only exploration mode.

- `plan-mode/` — full plan mode with step tracking

### Provider

Custom LLM backends.

- `custom-provider-anthropic/` — Anthropic proxy with OAuth
- `custom-provider-gitlab-duo/` — GitLab Duo integration

### SSH / Sandbox

Remote and isolated execution.

- `ssh.ts` — delegate tools to remote machine via SSH
- `sandbox/` — OS-level sandboxing

### Session Management

Session lifecycle control.

- `session-name.ts` — name sessions for selector
- `handoff.ts` — transfer context to focused session
- `bookmark.ts` — label entries for `/tree` navigation
- `reload-runtime.ts` — safe reload flow
- `shutdown-command.ts` — graceful shutdown

### Custom Compaction

Control how context is summarized.

- `custom-compaction.ts` — custom summary logic
- `summarize.ts` — conversation summary with model call

### Dynamic Resources

Contribute skills, prompts, themes at runtime.

- `dynamic-resources/` — `resources_discover` event

### Message Rendering

Custom display for extension messages.

- `message-renderer.ts` — `registerMessageRenderer` with expandable details

### Autocomplete

Stack custom completion on top of built-in.

- `github-issue-autocomplete.ts` — `#1234` issue completions

### External Dependencies

Extension with npm packages.

- `with-deps/` — package.json with dependencies
