import { describe, test, expect } from 'bun:test'
import { detectPackageManager } from '../src/upgrade.js'

describe('detectPackageManager', () => {
  test('returns bun when argv[0] contains bun', () => {
    const original = process.argv[0]
    try {
      process.argv[0] = '/home/user/.bun/bin/bun'
      expect(detectPackageManager()).toBe('bun')
    } finally {
      process.argv[0] = original
    }
  })

  test('returns npm when argv[0] contains node', () => {
    const original = process.argv[0]
    try {
      process.argv[0] = '/usr/local/bin/node'
      expect(detectPackageManager()).toBe('npm')
    } finally {
      process.argv[0] = original
    }
  })

  test('defaults to npm for unknown runtime', () => {
    const original = process.argv[0]
    try {
      process.argv[0] = '/usr/bin/something-else'
      expect(detectPackageManager()).toBe('npm')
    } finally {
      process.argv[0] = original
    }
  })
})
