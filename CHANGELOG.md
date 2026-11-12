# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-12

No breaking changes — every 0.1.0 export is still available with the same name and type.

### Added

- Dual ESM + CommonJS build (`import` and `require` both work) with type definitions for each, via an `exports` map.
- `loginGrab` finds Chrome / Chromium automatically: `chromePath` is now optional (falls back to `CHROME_PATH`,
  then the usual install locations on macOS, Linux and Windows). New `findChromePath()` export.
- Unit tests (Vitest) for cookie / token helpers, date windowing, request building, Grab ID error mapping and the
  HTTP retry layer.
- ESLint + Prettier, CI on Node 22 and 24, release workflow with npm provenance.
- Examples in `examples/`, contributing guide and issue / PR templates.

### Changed

- Source reorganised into `src/client/` and `src/auth/` modules. Behaviour is unchanged.

## [0.1.0] - 2026-11-12

### Added

- Initial release: portal login through headless Chrome (OTP and human-solved challenges), live orders, order
  history, order details, menu and modifier availability, inventory export / upload, order marking, retry on
  5xx / network errors.

[Unreleased]: https://github.com/rice2411/grab-merchant-api/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rice2411/grab-merchant-api/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rice2411/grab-merchant-api/releases/tag/v0.1.0
