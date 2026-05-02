---
name: pi-prompt-templates
description: Author Pi prompt templates. Use when creating reusable prompts, setting up slash commands for common workflows, or configuring argument hints and positional parameters.
---

# Pi Prompt Templates

Prompt templates are Markdown snippets that expand into full prompts. Type `/name` in the editor to invoke.

## Locations

| Location                   | Scope    |
| -------------------------- | -------- |
| `~/.pi/agent/prompts/*.md` | Global   |
| `.pi/prompts/*.md`         | Project  |
| `prompts/` in packages     | Package  |
| `prompts` in settings      | Explicit |
| `--prompt-template <path>` | CLI      |

Disable with `--no-prompt-templates`. Discovery in `prompts/` is non-recursive.

## Format

```markdown
---
description: Review staged git changes
argument-hint: "<focus-area>"
---

Review the staged changes (`git diff --cached`). Focus on:

- Bugs and logic errors
- Security issues
- Error handling gaps

Special attention on: $1
```

### Frontmatter

| Field           | Required | Description                                              |
| --------------- | -------- | -------------------------------------------------------- |
| `description`   | No       | Shown in autocomplete. Defaults to first non-empty line. |
| `argument-hint` | No       | Shown before description in autocomplete dropdown.       |

### Argument Hint Syntax

- `<arg>` — required argument
- `[arg]` — optional argument

Renders in autocomplete as:

```
→ review   <focus-area>   — Review staged git changes
```

## Filename → Command

The filename (without `.md`) becomes the slash command:

- `review.md` → `/review`
- `component.md` → `/component`

## Positional Arguments

| Syntax               | Description                      |
| -------------------- | -------------------------------- |
| `$1`, `$2`, ...      | Positional args                  |
| `$@` or `$ARGUMENTS` | All args joined                  |
| `${@:N}`             | Args from position N (1-indexed) |
| `${@:N:L}`           | L args starting at position N    |

Example:

```markdown
---
description: Create a component
---

Create a React component named $1 with features: $@
```

Usage: `/component Button "onClick handler" "disabled support"`
Result: `Create a React component named Button with features: Button "onClick handler" "disabled support"`

## Templates vs Skills vs Commands

| When to use                                | Mechanism             |
| ------------------------------------------ | --------------------- |
| One-shot instructions with variable parts  | **Prompt template**   |
| Multi-step workflow with on-demand loading | **Skill**             |
| Interactive UI or runtime behavior         | **Extension command** |

Templates are simplest — pure text expansion with argument substitution.

## Checklist

- [ ] Filename is a clear, concise command name (no spaces, lowercase)
- [ ] `description` frontmatter explains what the template does
- [ ] `argument-hint` provided if the template accepts arguments
- [ ] Positional args (`$1`, `$@`) used correctly
- [ ] Template body is self-contained — no assumptions about prior context
- [ ] Placed in `~/.pi/agent/prompts/` (global) or `.pi/prompts/` (project)
