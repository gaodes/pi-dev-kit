---
name: pi-theme-authoring
description: Author Pi themes. Use when creating a custom theme, modifying color tokens, or troubleshooting theme display issues.
---

# Pi Theme Authoring

Create and customize Pi terminal UI themes.

## Locations

| Location                    | Scope            |
| --------------------------- | ---------------- |
| Built-in: `dark`, `light`   | Always available |
| `~/.pi/agent/themes/*.json` | Global           |
| `.pi/themes/*.json`         | Project          |
| `themes/` in packages       | Package          |
| `--theme <path>`            | CLI              |

Select via `/settings` or `settings.json`:

```json
{ "theme": "my-theme" }
```

## Hot Reload

When you edit the currently active custom theme file, Pi reloads it automatically. No restart needed.

## Theme Format

```json
{
  "$schema": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
  "name": "my-theme",
  "vars": {
    "primary": "#00aaff",
    "gray": 242
  },
  "colors": {
    "accent": "primary",
    "border": "primary",
    "text": "",
    "...": "..."
  },
  "export": {
    "pageBg": "#18181e",
    "cardBg": "#1e1e24",
    "infoBg": "#3c3728"
  }
}
```

- `name` — required, must be unique
- `vars` — optional, reusable color references
- `colors` — required, all 51 tokens must be defined
- `export` — optional, controls `/export` HTML output colors
- `$schema` — optional, enables editor auto-completion

## Color Formats

| Format    | Example     | Description                 |
| --------- | ----------- | --------------------------- |
| Hex       | `"#ff0000"` | 6-digit hex RGB             |
| 256-color | `39`        | xterm palette index (0-255) |
| Variable  | `"primary"` | Reference to `vars` entry   |
| Default   | `""`        | Terminal's default color    |

### 256-Color Palette

- 0-15: Basic ANSI (terminal-dependent)
- 16-231: 6×6×6 RGB cube (`16 + 36×R + 6×G + B`)
- 232-255: Grayscale ramp

Pi uses 24-bit RGB. Most modern terminals support this (iTerm2, Kitty, WezTerm, VS Code). Falls back to nearest 256-color on older terminals.

## Color Tokens

Every theme must define all 51 tokens. No optional colors.

### Core UI (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### Backgrounds & Content (11)

`selectedBg`, `userMessageBg`, `userMessageText`, `customMessageBg`, `customMessageText`, `customMessageLabel`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Tool Diffs (3)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`

### Syntax Highlighting (9)

`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### Thinking Level Borders (6)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`

### Bash Mode (1)

`bashMode`

## Design Tips

- **Dark terminals:** Bright, saturated colors with higher contrast
- **Light terminals:** Darker, muted colors with lower contrast
- **Color harmony:** Start with a base palette (Nord, Gruvbox, Tokyo Night), define in `vars`, reference consistently
- **Testing:** Check with different message types, tool states, markdown content, and long wrapped text
- **VS Code:** Set `terminal.integrated.minimumContrastRatio` to `1` for accurate colors

## Checklist

- [ ] `name` is unique and descriptive
- [ ] All 51 color tokens defined (no missing)
- [ ] `vars` used for repeated colors (DRY)
- [ ] `$schema` included for editor validation
- [ ] Tested in target terminal(s) — dark and/or light
- [ ] Hot reload works (edit active theme file, changes appear immediately)
- [ ] Export section set if using `/export`
