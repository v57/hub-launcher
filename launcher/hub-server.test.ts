import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Git } from './git'
import {
  defaultApps,
  formatPairingCode,
  hubServerRepo,
  hubServerTag,
  migrateHubServer,
  pinHubServer,
  readPairingCode,
} from './hub-server'

let apps: string
beforeEach(() => {
  apps = join(mkdtempSync(join(tmpdir(), 'hub-launcher-apps-')), 'apps')
  mkdirSync(apps)
})
afterEach(() => rmSync(join(apps, '..'), { recursive: true, force: true }))

function folder(name: string, files: Record<string, string> = {}) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(apps, name, path, '..'), { recursive: true })
    writeFileSync(join(apps, name, path), text)
  }
  mkdirSync(join(apps, name), { recursive: true })
}

describe('hub-server migration', () => {
  test('installs hub-server by default', () => {
    expect(defaultApps()).toEqual([
      { name: 'Hub', type: 'bun', repo: hubServerRepo, commit: hubServerTag, active: true, restarts: true },
    ])
  })

  test('leaves lists without hub-lite or hub-pro alone', async () => {
    expect(await migrateHubServer([{ name: 'S3', type: 'bun', repo: 'v57/hub-s3', active: true }], apps)).toBeUndefined()
  })

  test('replaces hub-lite and removes its folder', async () => {
    folder('hub-lite', { 'index.ts': '' })
    const migrated = await migrateHubServer(
      [
        { name: 'Hub Lite', type: 'bun', command: 'start', repo: 'v57/hub-lite', active: true },
        { name: 'S3', type: 'bun', repo: 'v57/hub-s3', active: true },
      ],
      apps,
    )
    expect(migrated).toEqual([
      { name: 'Hub', type: 'bun', repo: hubServerRepo, active: true },
      { name: 'S3', type: 'bun', repo: 'v57/hub-s3', active: true },
    ])
    expect(existsSync(join(apps, 'hub-lite'))).toBe(false)
  })

  test('moves hub-pro with its data and points it at the renamed repository', async () => {
    folder('hub-pro', { 'data/auth': 'hub key', 'data/devices.json': '{}' })
    await $`git init -q && git remote add origin https://github.com/v57/hub-pro`.cwd(join(apps, 'hub-pro')).quiet()
    const env = { HUBOWNER: 'owner', HUBLAUNCHER: 'launcher' }
    const migrated = await migrateHubServer(
      [{ name: 'Hub Pro', type: 'bun', repo: 'v57/hub-pro', active: true, restarts: true, env }],
      apps,
    )
    expect(migrated).toEqual([{ name: 'Hub', type: 'bun', repo: hubServerRepo, active: true, restarts: true, env }])
    expect(existsSync(join(apps, 'hub-pro'))).toBe(false)
    expect(readFileSync(join(apps, 'hub-server', 'data', 'auth'), 'utf8')).toBe('hub key')
    const remote = await $`git remote get-url origin`.cwd(join(apps, 'hub-server')).text()
    expect(remote.trim()).toBe('https://github.com/v57/hub-server')
  })

  test('keeps hub-pro over hub-lite when both are listed', async () => {
    folder('hub-pro', { 'data/auth': 'hub key' })
    const migrated = await migrateHubServer(
      [
        { name: 'Hub', type: 'bun', repo: 'v57/hub-lite', active: false },
        { name: 'Hub Pro', type: 'bun', repo: 'v57/hub-pro', active: true },
      ],
      apps,
    )
    expect(migrated).toEqual([{ name: 'Hub', type: 'bun', repo: hubServerRepo, active: true }])
    expect(existsSync(join(apps, 'hub-server', 'data', 'auth'))).toBe(true)
  })

  test("moves hub-pro's data into an installed hub-server without data", async () => {
    folder('hub-pro', { 'data/auth': 'hub key' })
    folder('hub-server', { 'index.ts': '' })
    const migrated = await migrateHubServer(
      [
        { name: 'Hub Pro', type: 'bun', repo: 'v57/hub-pro', active: true },
        { name: 'Hub', type: 'bun', repo: hubServerRepo, active: true },
      ],
      apps,
    )
    expect(migrated).toEqual([{ name: 'Hub', type: 'bun', repo: hubServerRepo, active: true }])
    expect(readFileSync(join(apps, 'hub-server', 'data', 'auth'), 'utf8')).toBe('hub key')
    expect(existsSync(join(apps, 'hub-pro'))).toBe(false)
  })

  test('keeps both folders when both have data', async () => {
    folder('hub-pro', { 'data/auth': 'pro key' })
    folder('hub-server', { 'data/auth': 'server key' })
    await migrateHubServer([{ name: 'Hub Pro', type: 'bun', repo: 'v57/hub-pro', active: true }], apps)
    expect(readFileSync(join(apps, 'hub-pro', 'data', 'auth'), 'utf8')).toBe('pro key')
    expect(readFileSync(join(apps, 'hub-server', 'data', 'auth'), 'utf8')).toBe('server key')
  })
})

// Security audit M16: the launcher, the CLI's launcher and the Docker image installed hub-server from main
describe('hub-server release tag', () => {
  test('pins hub-server entries to the tag and leaves other apps alone', () => {
    const s3 = { name: 'S3', type: 'bun', repo: 'v57/hub-s3', active: true }
    expect(pinHubServer([s3])).toBeUndefined()
    expect(pinHubServer([{ name: 'Hub', type: 'bun', repo: hubServerRepo, commit: hubServerTag, active: true }])).toBeUndefined()
    expect(
      pinHubServer([{ name: 'Hub', type: 'bun', repo: hubServerRepo, commit: '1.0.0', active: true }, s3]),
    ).toEqual([{ name: 'Hub', type: 'bun', repo: hubServerRepo, commit: hubServerTag, active: true }, s3])
    expect(pinHubServer([{ name: 'Hub', type: 'bun', repo: hubServerRepo, active: true }])).toEqual([
      { name: 'Hub', type: 'bun', repo: hubServerRepo, commit: hubServerTag, active: true },
    ])
  })

  test('a clone of main moves to the tag, stays there, and follows a moved tag', async () => {
    const root = join(apps, '..')
    const origin = join(root, 'origin', 'hub-server')
    mkdirSync(origin, { recursive: true })
    const commit = async (message: string) => {
      writeFileSync(join(origin, 'file'), message)
      await $`git add file && git -c user.name=t -c user.email=t@t commit -qm ${message}`.cwd(origin).quiet()
      return (await $`git rev-parse HEAD`.cwd(origin).text()).trim()
    }
    await $`git init -q -b main`.cwd(origin).quiet()
    const release = await commit('release')
    await $`git tag 1.1.0`.cwd(origin).quiet()
    const next = await commit('main')
    const cwd = process.cwd()
    process.chdir(root)
    try {
      const git = new Git(origin)
      await git.clone()
      expect(await git.head()).toBe(next)
      expect(await git.isAway('1.1.0')).toBe(true)
      expect(await git.changeCommit('1.1.0')).toBe(true)
      expect(await git.head()).toBe(release)
      expect(await git.changeCommit('1.1.0')).toBe(false)
      expect(await git.isAway('1.1.0')).toBe(false)
      await $`git tag -f 1.1.0 ${next}`.cwd(origin).quiet()
      expect(await git.isAway('1.1.0')).toBe(true)
      expect(await git.changeCommit('1.1.0', true)).toBe(true)
      expect(await git.head()).toBe(next)
      expect(git.changeCommit('--upload-pack=x')).rejects.toThrow('invalid ref')
    } finally {
      process.chdir(cwd)
    }
  })
})

describe('pairing code', () => {
  test('formats codes as XXX-XXX', () => {
    expect(formatPairingCode('k7q2mx\n')).toBe('K7Q-2MX')
    expect(formatPairingCode('K7Q-2MX')).toBe('K7Q-2MX')
    expect(formatPairingCode(' \n')).toBeUndefined()
  })

  test("reads hub-server's data/pairing-code", async () => {
    expect(await readPairingCode(join(apps, 'hub-server'))).toBeUndefined()
    folder('hub-server', { 'data/pairing-code': 'K7Q2MX\n' })
    expect(await readPairingCode(join(apps, 'hub-server'))).toBe('K7Q-2MX')
  })
})

describe('launcher/pair/new', () => {
  test('runs hub-server --pair with the launcher key and returns the new code', async () => {
    // A stand-in hub-server: writes its pairing code and the HUBLAUNCHER it got
    folder('hub-server', {
      'index.ts': `
        import { mkdirSync, writeFileSync } from 'node:fs'
        if (!process.argv.includes('--pair')) process.exit(2)
        mkdirSync('data', { recursive: true })
        writeFileSync('data/pairing-code', 'abc123')
        writeFileSync('data/launcher', process.env.HUBLAUNCHER ?? '')
      `,
    })
    const cwd = process.cwd()
    process.chdir(join(apps, '..'))
    try {
      const { Apps, RunningApp, launcherKey } = await import('./app')
      const launcher = new Apps()
      launcher.list.push(new RunningApp({ name: 'Hub', type: 'bun', repo: hubServerRepo, active: false, restarts: false }, launcher.infoStream))
      expect(await launcher.newPairingCode()).toBe('ABC-123')
      expect(readFileSync(join(apps, 'hub-server', 'data', 'launcher'), 'utf8')).toBe(await launcherKey())
      expect(JSON.stringify(await launcher.info())).not.toContain('ABC')
    } finally {
      process.chdir(cwd)
    }
  })

  test('fails without hub-server', async () => {
    const { Apps } = await import('./app')
    await expect(new Apps().newPairingCode()).rejects.toBe('hub-server is not installed')
  })
})
