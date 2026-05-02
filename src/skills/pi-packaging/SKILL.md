---
name: pi-packaging
description: Bundle and distribute Pi resources as packages. Use when creating a pi package, configuring package.json manifest, publishing to npm or git, managing package sources, or setting up install/update workflows.
---

# Pi Packaging

Bundle extensions, skills, prompt templates, and themes as Pi packages for sharing via npm or git.

## Package Sources

| Source | Format                           | Notes                                  |
| ------ | -------------------------------- | -------------------------------------- |
| npm    | `npm:@scope/pkg@1.2.3`           | Versioned = pinned, skipped by updates |
| git    | `git:github.com/user/repo@v1`    | HTTPS/SSH/protocol URLs all work       |
| local  | `/absolute/path` or `./relative` | No copying, reference in-place         |

```bash
pi install npm:@foo/bar@1.0.0      # npm, pinned
pi install git:github.com/user/repo # git, latest
pi install ./my-local-package       # local path
pi install npm:@foo/bar -l          # project-local install
pi remove npm:@foo/bar
pi list
pi update                           # update pi + packages
pi update --extensions              # packages only
pi update --self                    # pi only
```

## Package Manifest

Add a `pi` key to `package.json`:

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Paths are relative to package root. Arrays support glob patterns and `!exclusions`.

### Convention Directories

Without a `pi` manifest, Pi auto-discovers from:

- `extensions/` → `.ts` and `.js` files
- `skills/` → `SKILL.md` folders and root `.md` files
- `prompts/` → `.md` files
- `themes/` → `.json` files

### Gallery Metadata

Tag with `pi-package` for [gallery](https://pi.dev/packages) discoverability. Add preview:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

## Dependency Rules

| Type              | Where                                  | Notes                                                                                                                    |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Runtime deps      | `dependencies`                         | Installed automatically on `pi install`                                                                                  |
| Pi internals      | `peerDependencies` with `"*"` range    | `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `typebox` |
| Other pi packages | `dependencies` + `bundledDependencies` | Must bundle; separate installs don't share modules                                                                       |

**Critical:** Pi peer deps must be `"*"` range, never pinned. Add `optional: true` in `peerDependenciesMeta` to prevent npm 7+ from auto-installing them.

```json
{
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*"
  },
  "peerDependenciesMeta": {
    "@mariozechner/pi-coding-agent": { "optional": true },
    "@mariozechner/pi-tui": { "optional": true }
  }
}
```

## Package Filtering

Filter what a package loads using the object form in settings:

```json
{
  "packages": [
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"]
    }
  ]
}
```

- Omit a key → load all of that type
- `[]` → load none
- `!pattern` → exclude
- `+path` → force-include

## Scope and Deduplication

Packages can appear in both global and project settings. Identity:

- npm: package name
- git: URL without ref
- local: resolved absolute path

Project entry wins on conflict. Use `pi config` to enable/disable individual resources.

## Checklist

- [ ] `package.json` has `pi-package` keyword
- [ ] `pi` manifest or convention directories present
- [ ] Pi internals in `peerDependencies` with `"*"` range and `optional: true`
- [ ] Runtime dependencies in `dependencies`
- [ ] Other pi packages in `bundledDependencies`
- [ ] Gallery `video` or `image` metadata for visual preview
- [ ] `npm publish --access public` for scoped packages
- [ ] Tested: `pi install` + `pi list` shows correct resources
