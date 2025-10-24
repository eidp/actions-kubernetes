// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { existsSync } from 'fs'

// List of TypeScript actions to build
// When creating a new TypeScript action:
// 1. Create the action directory with src/index.ts
// 2. Add the action name to this array
// 3. Rollup will automatically build it to <action>/dist/index.js
//
// Note: Composite actions (using shell scripts) don't need to be listed here
const actions = ['create-context', 'deploy-preview']

// Create a build configuration for each action
const configs = actions
  .filter((action) => existsSync(`${action}/src/index.ts`))
  .map((action) => ({
    input: `${action}/src/index.ts`,
    output: {
      esModule: true,
      file: `${action}/dist/index.js`,
      format: 'es',
      sourcemap: true
    },
    plugins: [
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        compilerOptions: {
          outDir: undefined,
          declaration: false
        }
      }),
      nodeResolve({ preferBuiltins: true }),
      commonjs()
    ]
  }))

export default configs
