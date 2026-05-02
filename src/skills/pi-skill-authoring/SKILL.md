---
name: pi-skill-authoring
description: Author Pi skills that comply with the Agent Skills standard. Use when creating a new skill, improving an existing skill's trigger accuracy, or reviewing skill structure and frontmatter compliance.
---

# Pi Skill Authoring

Create and maintain Pi skills that comply with the [Agent Skills standard](https://agentskills.io/specification).

## When to Create a Skill

Create a skill when:

- You have specialized instructions that the agent should load on-demand (not always in context)
- A workflow has multiple steps the agent might forget or skip
- Reference documentation is too large for the system prompt but needed for specific tasks
- You want to share reusable knowledge across projects or agents

Do NOT create a skill when:

- A few lines in `AGENTS.md` suffice (durable, always-needed instructions)
- A prompt template covers the use case (one-shot instructions)
- An extension is needed (runtime behavior, tools, commands)

## Skill Locations

Pi discovers skills from:

| Location                               | Scope                                           |
| -------------------------------------- | ----------------------------------------------- |
| `~/.pi/agent/skills/`                  | Global                                          |
| `.pi/skills/`                          | Project                                         |
| `~/.agents/skills/`, `.agents/skills/` | Cross-client                                    |
| Packages                               | `skills/` dirs or `pi.skills` in `package.json` |
| Settings                               | `skills` array                                  |
| CLI                                    | `--skill <path>`                                |

Discovery rules:

- In `~/.pi/agent/skills/` and `.pi/skills/`: root `.md` files are individual skills
- In all locations: directories containing `SKILL.md` are discovered recursively
- Disable with `--no-skills`

## Directory Structure

```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Optional: helper scripts
├── references/           # Optional: detailed docs loaded on-demand
└── assets/               # Optional: templates, data files
```

## SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific about triggers.
---

# My Skill

## Setup

<!-- Optional: one-time setup steps -->

## Instructions

<!-- The main body the agent follows when the skill is activated -->

## Examples

<!-- Optional: input/output examples -->
```

## Frontmatter Reference

| Field           | Required | Constraints                                                                                                                  |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `name`          | Yes      | 1-64 chars, lowercase `a-z`, `0-9`, hyphens only. No leading/trailing/consecutive hyphens. Must match parent directory name. |
| `description`   | Yes      | 1-1024 chars. Describes what the skill does AND when to use it.                                                              |
| `license`       | No       | License name or reference.                                                                                                   |
| `compatibility` | No       | Max 500 chars. Environment requirements.                                                                                     |
| `metadata`      | No       | Arbitrary key-value mapping.                                                                                                 |
| `allowed-tools` | No       | Space-separated pre-approved tools. Experimental.                                                                            |

### Name Rules

Valid: `pdf-processing`, `data-analysis`, `code-review`
Invalid: `PDF-Processing` (uppercase), `-pdf` (leading hyphen), `pdf--processing` (consecutive hyphens)

The name **must match the parent directory name**. Pi warns but still loads on mismatch.

## Description Best Practices

The description determines when the agent loads the skill. It appears in the system prompt catalog (~50-100 tokens per skill).

**Good descriptions:**

```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents.
```

```yaml
description: Author Pi skills that comply with the Agent Skills standard. Use when creating a new skill, improving trigger accuracy, or reviewing skill structure.
```

**Poor descriptions:**

```yaml
description: Helps with PDFs.
```

```yaml
description: A skill for doing things.
```

Include:

1. What the skill does
2. When to use it (trigger keywords)
3. Specific nouns the agent can match against

## Progressive Disclosure

Skills load in three tiers:

| Tier         | What's loaded                  | When                        | Token cost     |
| ------------ | ------------------------------ | --------------------------- | -------------- |
| Catalog      | Name + description             | Session start               | ~50-100 tokens |
| Instructions | Full SKILL.md body             | Agent activates skill       | Varies         |
| Resources    | scripts/, references/, assets/ | Instructions reference them | On-demand      |

**Keep `SKILL.md` under 500 lines.** Move detailed reference material to separate files in `references/`. The agent loads these only when needed.

## File References

Use relative paths from the skill root:

```markdown
See [the reference guide](references/api-reference.md) for details.
```

Keep references one level deep. Avoid deeply nested reference chains.

## Skill Commands

Skills register as `/skill:name` commands. Arguments after the command are appended to the skill content.

```bash
/skill:pdf-tools extract document.pdf
```

## Validation

Pi validates skills leniently:

- Missing `description` → skill is **not loaded** (the only hard failure)
- Name/directory mismatch → warning, still loads
- Name too long or invalid chars → warning, still loads
- Unknown frontmatter fields → ignored

## Checklist

- [ ] `name` matches parent directory name
- [ ] `name` is lowercase, hyphens only, no leading/trailing/consecutive hyphens
- [ ] `description` is specific about what the skill does AND when to use it
- [ ] `description` is under 1024 characters
- [ ] SKILL.md body is under 500 lines
- [ ] Detailed content moved to `references/`
- [ ] File references use relative paths from skill root
- [ ] References are one level deep
- [ ] No secrets, credentials, or tokens in skill files
- [ ] Tested: skill triggers on expected inputs, doesn't trigger on unrelated inputs
