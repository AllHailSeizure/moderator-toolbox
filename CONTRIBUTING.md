# Contributing

Thanks for helping improve Moderator Toolbox.

## How to contribute

1. **Open an issue** first if you are unsure whether a change fits, or to report a bug with enough detail to reproduce it.
2. **Fork** the repository and create a branch from `master`.
3. **Make your change** in `src/` or configuration the maintainers expect contributors to touch (this docs-only effort is unusual; most work is TypeScript under `src/server/`).
4. **Verify locally** before opening a pull request:

   ```sh
   npm run check
   ```

   That runs ESLint, TypeScript, tests, and the production build.

5. **Open a pull request** targeting **`master`** (not `main`). Describe what changed and why.

## Code style

- **ESLint** — `npm run lint` (auto-fix: `npm run lint:fix`). Config: `eslint.config.mjs`.
- **Prettier** — `npm run format` for formatting. Config: `.prettierrc`.
- Match existing module patterns in `src/server/` (see `src/server/CLAUDE.md` for module conventions used in this repo).

Do not commit sensitive install configuration or personal Reddit login material.

Maintainers merge when CI on the PR is green and the change is reviewed.