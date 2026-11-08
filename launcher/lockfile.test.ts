import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bunInstallCommand } from './manager'

// Security audit H5: a lockfile pinning hub-service from before auth v2 (0b048dc) left the launcher and every app it
// installs refused by new Hubs and sending credentials without a proof to old ones
const root = join(import.meta.dir, '..')
const tooOld = ['cc7b220', '84ce878', '7d1ebb9', 'fb6a591', '5bd7af0', 'ff5bec3', 'bea50b7']

describe('hub-service', () => {
  test('bun.lock pins it at auth v2 or later', async () => {
    const lock = await Bun.file(join(root, 'bun.lock')).text()
    const pin = lock.match(/"hub-service": \["hub-service@github:v57\/hub-service#([0-9a-f]+)"/)?.[1]
    expect(pin).toBeDefined()
    expect(tooOld).not.toContain(pin!)
  })
  test('the installed SDK proves hubs before it sends credentials', () => {
    expect(existsSync(join(root, 'node_modules', 'hub-service', 'hub-proof.ts'))).toBe(true)
  })
  test('apps install exactly what their lockfiles pin', async () => {
    expect(bunInstallCommand).toContain('--frozen-lockfile')
    const runs = (await Bun.file(join(root, 'Dockerfile')).text()).split('\n').filter(line => line.startsWith('RUN '))
    const installs = runs.filter(line => /\bbun (i|install|update|add)\b/.test(line))
    expect(installs.length).toBeGreaterThan(0)
    for (const line of installs) expect(line).toMatch(/^RUN bun install [^&;|]*--frozen-lockfile[^&;|]*$/)
  })
})
