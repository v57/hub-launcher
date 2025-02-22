import { Git } from './git'
import { $, type Subprocess } from 'bun'
import { rm } from 'node:fs/promises'

interface ManagerType<T> {
  install(setup: T): Promise<void>
  uninstall(setup: T): Promise<void>
  launch(setup: T): Subprocess
}

// MARK: Bun manager
interface IGithub {
  repo: string
  commit?: string
}
interface IBun extends IGithub {
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
    await $`bun i --production`.cwd(git.directory)
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
    })
  },
}

// MARK: Shell manager
interface ISh {
  directory?: string
  install?: string[] | string
  uninstall?: string[] | string
  run: string
}
interface TSh extends ISh {
  type: 'sh'
}

const sh: ManagerType<ISh> = {
  async install(setup: ISh) {
    if (!setup.install) return
    if (typeof setup.install === 'string') {
      await Bun.spawn(setup.install.split(' ')).exited
    } else {
      for (const command of setup.install) {
        await Bun.spawn(command.split(' ')).exited
      }
    }
  },
  async uninstall(setup: ISh) {
    if (!setup.uninstall) return
    if (typeof setup.uninstall === 'string') {
      await Bun.spawn(setup.uninstall.split(' ')).exited
    } else {
      for (const command of setup.uninstall) {
        await Bun.spawn(command.split(' ')).exited
      }
    }
  },
  launch(setup: ISh) {
    return Bun.spawn(setup.run.split(' '))
  },
}

// MARK: Managers
const manager = { bun, sh }
export type AppSetup = TBun | TSh

export function install(setup: AppSetup): Promise<any> {
  return (manager as any)[setup.type].install(setup)
}
export function uninstall(setup: AppSetup): Subprocess<'ignore', 'pipe', 'inherit'> {
  return (manager as any)[setup.type].uninstall(setup)
}
export function launch(setup: AppSetup): Subprocess<'ignore', 'pipe', 'inherit'> {
  return (manager as any)[setup.type].launch(setup)
}
