import { Git } from './git'
import { $, type Subprocess } from 'bun'
import { rm, exists } from 'node:fs/promises'

interface ManagerType<T> {
  install(setup: T): Promise<void>
  uninstall(setup: T): Promise<void>
  checkForUpdates(setup: T): Promise<boolean>
  launch(setup: T): Subprocess
}

interface IEnv {
  env?: Record<string, string>
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
  async uninstall(setup: IBun) {
    const git = new Git(`https://github.com/${setup.repo}`)
    await rm(git.directory, { recursive: true, force: true })
  },
  launch(setup: IBun) {
    const git = new Git(`https://github.com/${setup.repo}`)
    return Bun.spawn({
      cmd: ['bun', setup.command ?? '.'],
      cwd: git.directory,
      env: setup.env ? { ...process.env, ...setup.env } : undefined,
    })
  },
}

// MARK: Shell manager
interface ISh extends IEnv {
  directory?: string
  install?: string[] | string
  checkForUpdates?: string[] | string
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
  async uninstall(setup: ISh) {
    await runMany(setup.uninstall)
  },
  launch(setup: ISh) {
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

export function install(setup: AppSetup): Promise<any> {
  return (manager as any)[setup.type].install(setup)
}
export function uninstall(setup: AppSetup): Promise<any> {
  return (manager as any)[setup.type].uninstall(setup)
}
export function launch(setup: AppSetup): Subprocess<'ignore', 'pipe', 'inherit'> {
  return (manager as any)[setup.type].launch(setup)
}
