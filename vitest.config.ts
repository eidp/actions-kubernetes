import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['json-summary', 'text', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'create-context/src/**',
        'deploy-preview/src/**',
        'teardown-preview/src/**',
        'verify-up/src/**',
        'packages/shared/src/**'
      ],
      exclude: ['**/node_modules/**', '**/dist/**', '**/__tests__/**']
    }
  },
  resolve: {
    alias: {
      '@actions-kubernetes/shared': resolve(__dirname, 'packages/shared/src'),
      '@kubernetes/client-node': resolve(
        __dirname,
        '__mocks__/@kubernetes/client-node.ts'
      )
    }
  }
})
