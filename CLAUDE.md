# actions-kubernetes

GitHub Actions for Kubernetes operations.

## Structure

Actions are located in top-level directories:
- `create-context/` - Creates Kubernetes context for authentication
- `deploy-preview/` - Deploys preview environments
- `teardown-preview/` - Tears down preview environments
- `verify-up/` - Verifies Kubernetes resources are up

Each action has:
- `action.yml` - Action metadata and interface
- `README.md` - Auto-generated documentation
- `EXAMPLES.md` - Optional examples and additional docs
- `src/` - TypeScript source code (for TypeScript actions)
- `__tests__/` - Jest tests

## Development

### Writing Actions

**Preferred approach**: TypeScript actions with `@actions/core` and `@actions/github`.

TypeScript source goes in `<action-name>/src/main.ts`. Build with:
```bash
npm run package
```

This uses `@vercel/ncc` to bundle TypeScript into `dist/index.js`.

### Documentation

Action documentation is **automatically generated** from `action.yml` by a pre-commit hook (`generate-action-docs`).

To extend generated docs with examples or additional content, create `<action-name>/EXAMPLES.md`. This content is appended to the auto-generated README.

### Build Commands

- `npm run package` - Bundle all TypeScript actions to dist/
- `npm run test` - Run Jest tests
- `npm run lint` - Run ESLint
- `npm run format:write` - Format code with Prettier
- `npm run all` - Format, lint, test, coverage, and package

### Pre-commit Hooks

- `generate-action-docs` - Auto-generates README.md from action.yml
- `codespell` - Spell checking

Never skip pre-commit hooks.