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

export interface SystemdApp extends IEnv {
  type: 'systemd'
  unit: string
  install?: string[] | string
  checkForUpdates?: string[] | string
  update?: string[] | string
  uninstall?: string[] | string
  /** Run systemctl through sudo. Disable when Launcher already runs as root. */
  sudo?: boolean
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
      stdout: 'pipe',
      stderr: 'pipe',
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
    let command = setup.directory ? `cd ${setup.directory}; ${setup.run}` : setup.run
    const env = setup.env ? { ...process.env, ...setup.env } : undefined
    return Bun.spawn(['sh', '-c', command], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
  },
}

export function systemctlCommand(setup: SystemdApp, action: string, includeUnit = true): string[] {
  if (!/^[A-Za-z0-9_.@-]+(?:\.service)?$/.test(setup.unit)) throw new Error('invalid systemd unit')
  const command = includeUnit ? ['systemctl', action, setup.unit] : ['systemctl', action]
  return setup.sudo === false ? command : ['sudo', '--non-interactive', ...command]
}

export function systemctlStatusCommand(setup: SystemdApp): string[] {
  const command = systemctlCommand(setup, 'status')
  command.splice(command.length - 1, 0, '--no-pager', '--full', '--lines=20')
  return command
}

export class CommandError extends Error {
  constructor(
    readonly command: string[],
    readonly status: number,
    readonly output: string,
  ) {
    super(
      `${command.join(' ')} exited with status ${status}${output ? `: ${output}` : ''}`,
    )
    this.name = 'CommandError'
  }
}

async function runCommand(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  const output = [stdout, stderr].map(value => value.trim()).filter(Boolean).join('\n')
  if (code !== 0) throw new CommandError(command, code, output)
}

const systemd: ManagerType<SystemdApp> = {
  async install(setup) {
    await runMany(setup.install)
    await runCommand(systemctlCommand(setup, 'daemon-reload', false))
  },
  async checkForUpdates(setup) {
    try {
      await runMany(setup.checkForUpdates)
      return true
    } catch {
      return false
    }
  },
  async update(setup) {
    await runMany(setup.update)
    await runCommand(systemctlCommand(setup, 'daemon-reload', false))
  },
  async uninstall(setup) {
    await runCommand(systemctlCommand(setup, 'disable'))
    await runMany(setup.uninstall)
    await runCommand(systemctlCommand(setup, 'daemon-reload', false))
  },
  launch(setup) {
    return Bun.spawn(systemctlCommand(setup, 'enable'), { stdout: 'pipe', stderr: 'pipe' })
  },
}
function toArray<T>(value: T[] | T | undefined | null): T[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
}
async function runMany(value: string[] | string | undefined | null) {
  for (const command of toArray(value)) {
    await runCommand(['sh', '-c', command])
  }
}

// MARK: Managers
const manager = { bun, sh, systemd }
export type AppSetup = TBun | TSh | SystemdApp
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
export function launch(setup: AppSetup, settings: AppSettings | undefined): Subprocess<'ignore', 'pipe', 'pipe'> {
  return (manager as any)[setup.type].launch(setup, settings)
}

export function isSystemd(setup: AppSetup): setup is SystemdApp {
  return setup.type === 'systemd'
}

export async function startSystemd(setup: SystemdApp): Promise<void> {
  await runCommand(systemctlCommand(setup, 'enable'))
  try {
    await runCommand(systemctlCommand(setup, 'start'))
  } catch (startError) {
    try {
      await runCommand(systemctlStatusCommand(setup))
    } catch (statusError) {
      if (statusError instanceof CommandError && statusError.output) {
        throw new CommandError(
          startError instanceof CommandError ? startError.command : systemctlCommand(setup, 'start'),
          startError instanceof CommandError ? startError.status : 1,
          statusError.output,
        )
      }
    }
    throw startError
  }
}

export async function stopSystemd(setup: SystemdApp): Promise<void> {
  await runCommand(systemctlCommand(setup, 'stop'))
}
