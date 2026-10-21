import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSetup } from './manager'

/** The Hub server the launcher installs. hub-lite is retired and hub-pro was renamed to hub-server. */
export const hubServerRepo = 'v57/hub-server'
const retiredRepos = ['v57/hub-lite', 'v57/hub-pro']

interface LaunchEntry {
  name: string
  active: boolean
  restarts?: boolean
}
type Entry = LaunchEntry & AppSetup

export function defaultApps<T extends Entry>(): T[] {
  return [{ name: 'Hub', type: 'bun', repo: hubServerRepo, active: true, restarts: true } as T]
}

function repoOf(app: Entry): string | undefined {
  return app.type === 'bun' ? app.repo.toLowerCase().replace(/\.git$/, '') : undefined
}

export function isHubServer(app: Entry): boolean {
  return repoOf(app) === hubServerRepo
}

/** Folder of a GitHub app, as `Git.directory` names it */
function appFolder(apps: string, repo: string): string {
  return join(apps, repo.split('/').at(-1)!)
}

/**
 * Replaces hub-lite and hub-pro entries with hub-server. hub-lite stores nothing, so its folder is removed. hub-pro's
 * folder becomes hub-server's (its `data/` carries over) and points at the renamed repository.
 * Returns the migrated list, or undefined when there was nothing to migrate.
 */
export async function migrateHubServer<T extends Entry>(apps: T[], directory = 'apps'): Promise<T[] | undefined> {
  const retired = apps.filter(app => retiredRepos.includes(repoOf(app) ?? ''))
  if (!retired.length) return
  // hub-pro keeps the owners and devices, so it wins over hub-lite and over a hub-server without data
  const pro = retired.find(app => repoOf(app) === 'v57/hub-pro')
  const existing = apps.find(isHubServer)
  const server = appFolder(directory, hubServerRepo)
  if (pro) {
    const folder = appFolder(directory, 'v57/hub-pro')
    if (existsSync(folder)) {
      if (!existsSync(server)) {
        await rename(folder, server)
        await $`git remote set-url origin https://github.com/${hubServerRepo}`.cwd(server).quiet().nothrow()
      } else if (existsSync(join(folder, 'data')) && !existsSync(join(server, 'data'))) {
        await rename(join(folder, 'data'), join(server, 'data'))
        await rm(folder, { recursive: true, force: true })
      } else if (existsSync(join(folder, 'data'))) {
        console.warn(`Kept ${folder}: both hub-pro and hub-server have data`)
      } else {
        await rm(folder, { recursive: true, force: true })
      }
    }
  }
  for (const app of retired) {
    if (repoOf(app) === 'v57/hub-lite') await rm(appFolder(directory, 'v57/hub-lite'), { recursive: true, force: true })
  }

  const keep = existing ?? pro ?? retired[0]
  const result: T[] = []
  for (const app of apps) {
    if (app !== keep && (isHubServer(app) || retired.includes(app))) continue
    if (app === keep && app !== existing) {
      const { command, commit, ...rest } = app as T & { command?: string; commit?: string }
      const migrated = { ...rest, repo: hubServerRepo } as unknown as T
      const taken = apps.some(a => a.name === 'Hub' && !retired.includes(a) && !isHubServer(a))
      if (['Hub Lite', 'Hub Pro'].includes(app.name) && !taken) migrated.name = 'Hub'
      if (retired.some(a => a.active)) migrated.active = true
      result.push(migrated)
    } else {
      result.push(app)
    }
  }
  return result
}

/** `K7Q2MX` → `K7Q-2MX`; other text is returned as it is */
export function formatPairingCode(text: string): string | undefined {
  const code = text.replace(/[\s-]/g, '').toUpperCase()
  if (!code) return
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code
}

/** The code hub-server wrote to `data/pairing-code` while it waits for its first owner */
export async function readPairingCode(folder: string): Promise<string | undefined> {
  try {
    return formatPairingCode(await readFile(join(folder, 'data', 'pairing-code'), 'utf8'))
  } catch {
    return
  }
}
