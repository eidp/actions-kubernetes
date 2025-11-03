# actions-kubernetes

GitHub Actions for Kubernetes operations.

## Structure

This is a pnpm workspace monorepo. The structure is:

- `packages/shared/` - Shared utilities and types used across all actions
- `create-context/` - Creates Kubernetes context for authentication (action)
- `deploy-preview/` - Deploys preview environments (action)
- `teardown-preview/` - Tears down preview environments (action)
- `verify-up/` - Verifies Kubernetes resources are up (action)

Each action has:
- `action.yml` - Action metadata and interface
- `README.md` - Auto-generated documentation
- `EXAMPLES.md` - Optional examples and additional docs
- `src/` - TypeScript source code
- `__tests__/` - Vitest tests
- `dist/` - Bundled JavaScript (committed to repo)
- `package.json` - Workspace package definition

The shared package (`@actions-kubernetes/shared`) exports:
- Constants and labels
- Kubernetes connectivity utilities
- Deployment comment management
- PR comment utilities
- Slash command handling

## Development

### Writing Actions

**Preferred approach**: TypeScript actions with `@actions/core` and `@actions/github`.

TypeScript source goes in `<action-name>/src/main.ts`. Build with:
```bash
pnpm run build
```

This uses `@vercel/ncc` to bundle TypeScript into `dist/index.js`.

Import shared utilities using the scoped package name:
```typescript
import { Labels } from '@actions-kubernetes/shared/constants'
import { verifyKubernetesConnectivity } from '@actions-kubernetes/shared/k8s-connectivity'
```

### Documentation

Action documentation is **automatically generated** from `action.yml` by a pre-commit hook (`generate-action-docs`).

To extend generated docs with examples or additional content, create `<action-name>/EXAMPLES.md`. This content is appended to the auto-generated README.

### Build Commands

- `pnpm run build` - Bundle all TypeScript actions to dist/
- `pnpm run test:ci` - Run Vitest tests
- `pnpm run lint` - Run ESLint
- `pnpm run format:write` - Format code with Prettier
- `pnpm run all` - Format, lint, test, coverage, and package

### Pre-commit Hooks

- `generate-action-docs` - Auto-generates README.md from action.yml
- `codespell` - Spell checking

Never skip pre-commit hooks.