# Contributing

This file contains maintainer-focused instructions for publishing and releasing the userscript.

## GitHub Pages Configuration

1. Push this repository to GitHub.
2. Open `Settings` -> `Pages`.
3. Under `Build and deployment`, set:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main`
   - `Folder`: `/docs`
4. Save and wait for deployment.

Published URLs:

- Site: `https://frimik.github.io/tampermonkey-sportadmin-helper/`
- Userscript: `https://frimik.github.io/tampermonkey-sportadmin-helper/sportadmin-helper.user.js`

## Versioning

CalVer format: `YYYY.MM.MINOR`

Examples:

- `2026.05.0`
- `2026.05.1`
- `2026.06.0`

Rules:

- `YYYY.MM` follows UTC date at release time.
- `MINOR` starts at `0` for the first release in a month.
- Additional releases in the same month increment `MINOR` by 1.

## Release Scripts

### Manual version bump

- Auto-bump month/minor: `bash scripts/bump-version.sh`
- Set explicit version: `bash scripts/bump-version.sh 2026.05.2`

### One-command release

Use the helper script when the git working tree is clean:

- Auto-bump and commit only (default): `bash scripts/release.sh`
- Explicit version and commit only: `bash scripts/release.sh 2026.05.2`
- Auto-bump, commit, and push: `bash scripts/release.sh --push`
- Explicit version, commit, and push: `bash scripts/release.sh --push 2026.05.2`

Behavior:

1. Verifies the working tree is clean.
2. Bumps `@version` in `docs/sportadmin-helper.user.js`.
3. Creates commit message `release: v<version>`.
4. Pushes only when `--push` is used.
