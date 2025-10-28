// See: https://jestjs.io/docs/configuration

/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: [
    './create-context/src/**',
    './deploy-preview/src/**',
    './teardown-preview/src/**',
    './verify-up/src/**'
  ],
  coverageDirectory: './coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['json-summary', 'text', 'lcov'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js'],
  moduleNameMapper: {
    '^@kubernetes/client-node$':
      '<rootDir>/__mocks__/@kubernetes/client-node.ts'
  },
  preset: 'ts-jest',
  reporters: ['default'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/dist/', '/node_modules/'],
  transformIgnorePatterns: ['node_modules/(?!(parse-duration)/)'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.eslint.json',
        useESM: false
      }
    ],
    '^.+\\.js$': [
      'ts-jest',
      {
        useESM: false
      }
    ]
  },
  verbose: true
}
