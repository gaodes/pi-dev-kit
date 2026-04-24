# pi-tools

Runtime tools for Pi — version, docs, changelog, and package manager detection.

Forked from `@aliou/pi-dev-kit` with fixes for global installation detection and graceful fallbacks.

## Tools

| Tool | Description |
|------|-------------|
| `detect_package_manager` | Detect the package manager in the current project. Falls back to npm if no lockfile or `packageManager` field is found — never throws. |
| `pi_version` | Returns the currently running Pi version. |
| `pi_docs` | Lists Pi markdown documentation files from the installation directory. |
| `pi_changelog` | Returns changelog entries for a specific Pi version (or latest). Fetches from GitHub for versions newer than installed. |
| `pi_changelog_versions` | Lists all available Pi changelog versions. |

## Key fixes vs upstream

- **`findPiInstallation()`** uses `createRequire(import.meta.url)`, `PI_PACKAGE_DIR` env var, `npm root -g`, and well-known global paths — works correctly when Pi is installed globally via npm/homebrew.
- **`detect_package_manager`** never throws. When no `package.json` or lockfile is found, it returns npm as the default with a `source: "default"` indicator.
