# pi-tools

Runtime tools for Pi — version, docs, changelog, updater, package manager, and extension benchmarking.

Forked from `@aliou/pi-dev-kit` with fixes for global installation detection and graceful fallbacks.

## Tools

| Tool | Description |
|------|-------------|
| `detect_package_manager` | Detect the package manager in the current project. Falls back to npm if no lockfile or `packageManager` field is found — never throws. |
| `pi_version` | Returns the currently running Pi version. |
| `pi_docs` | Lists Pi markdown documentation files from the installation directory. |
| `pi_changelog` | Returns changelog entries for a specific Pi version (or latest). Fetches from GitHub for versions newer than installed. |
| `pi_changelog_versions` | Lists all available Pi changelog versions. |
| `pi_updater` | Check for Pi updates, view version status, install updates, or dismiss versions. |
| `pi_package_manager` | Scan installed Pi packages, find orphaned npm packages, re-register or bulk-uninstall them. Actions: `scan`, `orphans`, `reinstall`, `uninstall`. |
| `pi_ext_benchmark` | Profile Pi extension loading times — discovers all extensions (global, project-local, packages) and measures import + factory execution time per extension. Actions: `profile` (default), `list`. Scopes: `all`, `global`, `project`, `packages`. |
| `loaded_tools` | List all loaded tools with source provenance and active status. Returns tools grouped by source (built-in, SDK, extensions) with active/inactive indicators and per-extension grouping. |

## Commands

| Command | Description |
|---------|-------------|
| `/update` | Interactive Pi update flow — check, install, or dismiss updates. |
| `/manage-packages` | Interactive Pi package manager — scan, remove orphans, re-register, or uninstall packages. |
| `/tools` | List all loaded tools with source provenance and active status. Renders inline with Pi's native boot-time visual style. |

## Configuration

### Startup display

By default, the tools list is **not** shown at session start. To enable it, add to `~/.pi/agent/prime-settings.json`:

```json
{
  "pi-tools": {
    "showOnStartup": true
  }
}
```

Or per-project in `.pi/prime-settings.json`.

## Key fixes vs upstream

- **`findPiInstallation()`** uses `createRequire(import.meta.url)`, `PI_PACKAGE_DIR` env var, `npm root -g`, and well-known global paths — works correctly when Pi is installed globally via npm/homebrew.
- **`detect_package_manager`** never throws. When no `package.json` or lockfile is found, it returns npm as the default with a `source: "default"` indicator.
