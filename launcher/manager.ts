import { Git } from './git'
import { $, type Subprocess } from 'bun'
import { rm, exists } from 'node:fs/promises'

interface ManagerType<T> {
  install(setup: T): Promise<void>
  uninstall(setup: T): Promise<void>
  checkForUpdates(setup: T): Promise<boolean>
  update(setup: T): Promise<void>
  launch(setup: T, settings?: AppSettings): Subprocess
}

interface IEnv {
  env?: Record<string, string>
  envValues?: Record<string, string> // { string: placeholder }
}

// MARK: Bun manager
interface IGithub {
  repo: string
  commit?: string
}
interface IBun extends IGithub, IEnv {
  command?: string
}
interface TBun extends IBun {
  type: 'bun'
}
const bun: ManagerType<IBun> = {
  async install(setup: IBun) {
    const git = new Git(`https://github.com/${setup.repo}`)
    await git.clone()
    await git.changeCommit(setup.commit)
    const didInstall = await exists(`${git.directory}/node_modules`)
    if (!didInstall) await $`bun i --production`.cwd(git.directory)
  },
  async checkForUpdates(setup: IBun) {
    return new Git(`https://github.com/${setup.repo}`).checkForUpdates()
  },
  async update(setup: IBun) {
    const git = new Git(`https://github.com/${setup.repo}`)
    await git.update()
    await $`bun i --production`.cwd(git.directory)
  },
  async uninstall(setup: IBun) {
    const git = new Git(`https://github.com/${setup.repo}`)
    await rm(git.directory, { recursive: true, force: true })
  },
  launch(setup: IBun, settings?: AppSettings) {
    const git = new Git(`https://github.com/${setup.repo}`)
    let env = { ...process.env, ...setup.env, ...settings?.secrets, ...settings?.env }
    return Bun.spawn({
      cmd: ['bun', setup.command ?? '.'],
      cwd: git.directory,
      env: Object.keys(env).length ? env : undefined,
    })
  },
}

// MARK: Shell manager
interface ISh extends IEnv {
  directory?: string
  install?: string[] | string
  checkForUpdates?: string[] | string
  update?: string[] | string
  uninstall?: string[] | string
  run: string
}
interface TSh extends ISh {
  type: 'sh'
}

const sh: ManagerType<ISh> = {
  async install(setup: ISh) {
    await runMany(setup.install)
  },
  async checkForUpdates(setup: ISh) {
    try {
      await runMany(setup.checkForUpdates)
      return true
    } catch {
      return false
    }
  },
  async update(setup: ISh) {
    await runMany(setup.update)
  },
  async uninstall(setup: ISh) {
    await runMany(setup.uninstall)
  },
  launch(setup: ISh, settings?: AppSettings) {
    const home = (Bun.env.HOME as string) + '/'
    const cmds = setup.run.split(' ').map(a => (a.startsWith('~/') ? a.replace('~/', home) : a))
    const env = setup.env ? { ...process.env, ...setup.env } : undefined
    return Bun.spawn(cmds, { env, stdout: 'inherit', stderr: 'inherit' })
  },
}
function toArray<T>(value: T[] | T | undefined | null): T[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
}
async function runMany(value: string[] | string | undefined | null) {
  for (const command of toArray(value)) {
    await Bun.spawn(command.split(' ')).exited
  }
}

// MARK: Managers
const manager = { bun, sh }
export type AppSetup = TBun | TSh
export interface AppSettings {
  env?: Record<string, string | undefined>
  secrets?: Record<string, string | undefined>
}

export function install(setup: AppSetup): Promise<void> {
  return (manager as any)[setup.type].install(setup)
}
export function uninstall(setup: AppSetup): Promise<void> {
  return (manager as any)[setup.type].uninstall(setup)
}
export function checkForUpdates(setup: AppSetup): Promise<boolean> {
  return (manager as any)[setup.type].checkForUpdates(setup)
}
export function update(setup: AppSetup): Promise<void> {
  return (manager as any)[setup.type].update(setup)
}
export function launch(setup: AppSetup, settings: AppSettings | undefined): Subprocess<'ignore', 'pipe', 'inherit'> {
  return (manager as any)[setup.type].launch(setup, settings)
}
