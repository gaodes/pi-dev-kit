# pi-tools

Runtime tools for Pi — version, docs, changelog, updater, and package manager.

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

## Commands

| Command | Description |
|---------|-------------|
| `/update` | Interactive Pi update flow — check, install, or dismiss updates. |
| `/manage-packages` | Interactive Pi package manager — scan, remove orphans, re-register, or uninstall packages. |

## Key fixes vs upstream

- **`findPiInstallation()`** uses `createRequire(import.meta.url)`, `PI_PACKAGE_DIR` env var, `npm root -g`, and well-known global paths — works correctly when Pi is installed globally via npm/homebrew.
- **`detect_package_manager`** never throws. When no `package.json` or lockfile is found, it returns npm as the default with a `source: "default"` indicator.
