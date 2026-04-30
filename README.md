# pi-dev-kit

Developer toolkit for the Pi coding agent.

## Tools

| Tool | Description |
|------|-------------|
| `pi_version` | Returns the currently running Pi version. |
| `pi_docs` | Lists Pi markdown documentation files from the installation directory. |
| `pi_changelog` | Returns changelog entries for a specific Pi version (or latest). Fetches from GitHub for versions newer than installed. |
| `pi_changelog_versions` | Lists all available Pi changelog versions. |
| `pi_ext_benchmark` | Profile Pi extension loading times — discovers all extensions (global, project-local, packages) and measures import + factory execution time per extension. Actions: `profile` (default), `list`. Scopes: `all`, `global`, `project`, `packages`. |
| `loaded_tools` | List all loaded tools with source provenance and active status. Returns tools grouped by source (built-in, SDK, extensions) with active/inactive indicators and per-extension grouping. |

## Commands

| Command | Description |
|---------|-------------|
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

## Related extensions

- **[pi-package-manager](../pi-package-manager)** — `detect_package_manager` and `pi_package_manager` tools.
- **[pi-updater](../pi-updater)** — `pi_updater` tool and `/update` command.
