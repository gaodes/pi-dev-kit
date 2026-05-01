# pi-dev-kit

Developer toolkit for the Pi coding agent.

## Tools

| Tool                    | Description                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi_version`            | Returns the currently running Pi version.                                                                                                                                                                                                         |
| `pi_docs`               | Lists Pi markdown documentation files from the installation directory.                                                                                                                                                                            |
| `pi_changelog`          | Returns changelog entries for a specific Pi version (or latest). Fetches from GitHub for versions newer than installed.                                                                                                                           |
| `pi_changelog_versions` | Lists all available Pi changelog versions.                                                                                                                                                                                                        |
| `pi_ext_benchmark`      | Profile Pi extension loading times — discovers all extensions (global, project-local, packages) and measures import + factory execution time per extension. Actions: `profile` (default), `list`. Scopes: `all`, `global`, `project`, `packages`. |
| `loaded_tools`          | List all loaded tools with source provenance and active status. Returns tools grouped by source (built-in, SDK, extensions) with active/inactive indicators and per-extension grouping.                                                           |

## Commands

| Command  | Description                                                     |
| -------- | --------------------------------------------------------------- |
| `/tools` | List all loaded tools with source provenance and active status. |

## Configuration

### Startup display

By default, the tools list is **not** shown at session start. To enable it, add to `~/.pi/agent/prime-settings.json`:

```json
{
  "pi-dev-kit": {
    "showOnStartup": true
  }
}
```

Or per-project in `.pi/prime-settings.json`.

## Skills

| Skill          | Description                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi-extension` | Comprehensive Pi extension development reference — tools, hooks, commands, components, modes, state, providers, testing, publishing, and 12 API reference docs |
| `demo-setup`   | Demo project setup guide for new Pi extensions                                                                                                                 |

## Changelog

### v0.3.0

- Upgrade `version-tool` and `docs-tool` to `defineTool` API with `ToolCallHeader` rendering
- Add `promptSnippet` and `promptGuidelines` to upgraded tools
- Add `pi-extension` skill with 12 reference docs from upstream
- Add `demo-setup` skill and `setup-demo` prompt from upstream
- Add `@aliou/pi-utils-ui` dependency for `ToolCallHeader`/`ToolBody` rendering

### v0.2.0

- Add `pi_ext_benchmark` tool — profile extension loading times
- Add `loaded_tools` tool — list all tools with source provenance
- Add `/tools` command and message renderer
- Add startup display (opt-in via `showOnStartup`)

### v0.1.0

- Initial release: `pi_version`, `pi_docs`, `pi_changelog`, `pi_changelog_versions`

## Related extensions

- **[pi-package-manager](../pi-package-manager)** — `detect_package_manager` and `pi_package_manager` tools.
- **[pi-updater](../pi-updater)** — `pi_updater` tool and `/update` command.
