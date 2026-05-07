# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This is a fork of [@aliou/pi-dev-kit](https://github.com/aliou/pi-dev-kit) by [Aliou DIA](https://github.com/aliou).
All versions prior to the fork are credited to the original author.

## [2.0.3] - 2026-05-08

### Changed

- Updated peer dependencies from `@mariozechner/*` to `@earendil-works/*` following the Pi 0.74.0 scope migration.

## [2.0.2] - 2026-05-03

### Changed

- Refresh README package links for npm, GitHub source, and upstream provenance.
- Bump `@gaodes/pi-utils-ui` dependency to `^0.3.1`.

## [2.0.1] - 2026-05-03

### Added

- Add `detect_package_manager` tool — moved from pi-package-manager extension (originally from upstream `@aliou/pi-dev-kit`)

## [2.0.0] - 2026-05-03

### Changed

- Renamed package from `pi-dev-kit` to `@gaodes/pi-dev-kit`
- Published under `@gaodes` npm scope
- Dependency `@aliou/pi-utils-ui` replaced with `@gaodes/pi-utils-ui`

### Removed

- Removed `pi-extension` skill (moved to user-level skills)

## [0.3.0] - 2026-05-01

### Added

- Upgrade `version-tool` and `docs-tool` to `defineTool` API with `ToolCallHeader` rendering
- Add `promptSnippet` and `promptGuidelines` to upgraded tools
- Add `pi-extension` skill with 12 reference docs from upstream
- Add `demo-setup` skill and `setup-demo` prompt from upstream
- Add `@aliou/pi-utils-ui` dependency for `ToolCallHeader`/`ToolBody` rendering

## [0.2.0]

### Added

- Add `pi_ext_benchmark` tool — profile extension loading times
- Add `loaded_tools` tool — list all tools with source provenance
- Add `/tools` command and message renderer
- Add startup display (opt-in via `showOnStartup`)

## [0.1.0]

### Added

- Initial release: `pi_version`, `pi_docs`, `pi_changelog`, `pi_changelog_versions`

[2.0.2]: https://github.com/gaodes/pi-dev-kit/releases/tag/v2.0.2
[2.0.1]: https://github.com/gaodes/pi-dev-kit/releases/tag/v2.0.1
[2.0.0]: https://github.com/gaodes/pi-dev-kit/releases/tag/v2.0.0
