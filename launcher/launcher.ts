import { Git } from './git'
import { $, type Subprocess } from 'bun'

export type AppSetup = TBun | TSh

export function install(setup: AppSetup): Promise<any> {
  return (installation as any)[setup.type](setup)
}
export function launch(setup: AppSetup): Subprocess<'ignore', 'pipe', 'inherit'> {
  return (launcher as any)[setup.type](setup)
}

const installation = {
  async bun(setup: IBun) {
    const git = new Git(`https://github.com/${setup.repo}`)
    await git.clone()
    await git.changeCommit(setup.commit)
    await $`bun i --production`.cwd(git.directory)
  },
  async sh(setup: ISh) {
    if (!setup.install) return
    if (typeof setup.install === 'string') {
      await Bun.spawn(setup.install.split(' ')).exited
    } else {
      for (const command of setup.install) {
        await Bun.spawn(command.split(' ')).exited
      }
    }
  },
}
const launcher = {
  bun(setup: IBun) {
    const git = new Git(`https://github.com/${setup.repo}`)
    return Bun.spawn({
      cmd: ['bun', setup.command ?? '.'],
      cwd: git.directory,
    })
  },
  sh(setup: ISh) {
    return Bun.spawn(setup.run.split(' '))
  },
}

interface TBun extends IBun {
  type: 'bun'
}
interface TSh extends ISh {
  type: 'sh'
}

interface IGithub {
  repo: string
  commit?: string
}

interface IBun extends IGithub {
  command?: string
}

interface ISh {
  directory?: string
  install?: string[] | string
  run: string
}
