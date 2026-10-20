import { type Subprocess, $ } from 'bun'
import { resolve } from 'node:path'
import {
  install,
  checkForUpdates,
  update,
  uninstall,
  launch,
  isSystemd,
  startSystemd,
  stopSystemd,
  type AppSetup,
  type AppSettings,
} from './manager'
import { LazyState } from 'channel/more'
import * as hubService from 'hub-service'
import { publicKey } from 'hub-service'
import { AppLogs, type LogLine } from './logs'

interface AppInfo {
  name: string
  active: boolean
  restarts: boolean
  updateAvailable?: boolean
  instances?: number
  settings?: AppSettings
}
type App = AppInfo & AppSetup

interface Status {
  apps: AppStatus[]
}
interface InfoStatus {
  apps: App[]
}
interface AppStatus {
  name: string
  checkingForUpdates?: boolean
  updating?: boolean
  lastError?: string
  crashes: number
  processes: ProcessStatus[]
  started?: Date
  /** When a crashed app is started again */
  nextRestart?: Date
}
interface ProcessStatus {
  pid: number
  cpu: number
  memory: number
}
export interface RestartPolicy {
  /** Delay before the first restart, in milliseconds */
  initialDelay: number
  /** Longest delay between restarts, in milliseconds */
  maxDelay: number
  /** A run this long resets the delay, in milliseconds */
  stableAfter: number
}
const defaultRestartPolicy: RestartPolicy = { initialDelay: 1000, maxDelay: 60_000, stableAfter: 60_000 }

/** A process that exited on its own with a non-zero code or a signal. */
export class CrashError extends Error {
  constructor(
    readonly code: number | null,
    readonly signal: string | null,
    readonly output: string,
  ) {
    super(`${signal ? `killed by ${signal}` : `exited with code ${code}`}${output ? `: ${output}` : ''}`)
    this.name = 'CrashError'
  }
}

export class RunningApp {
  data: App
  infoStream: LazyState<InfoStatus>
  status: AppStatus
  processes: Subprocess[] = []
  launched = 0
  logs: AppLogs
  restartPolicy: RestartPolicy
  /** Crashes since the last stable run, for the restart delay */
  private consecutiveCrashes = 0
  /** Processes the launcher stopped itself. Bun reports any signal death as `killed`. */
  private stopping = new WeakSet<Subprocess>()
  constructor(data: App, infoStream: LazyState<InfoStatus>, restartPolicy: RestartPolicy = defaultRestartPolicy) {
    this.data = data
    this.infoStream = infoStream
    this.restartPolicy = restartPolicy
    this.logs = new AppLogs(data.name)
    this.status = {
      name: data.name,
      crashes: 0,
      processes: [],
    }
  }
  async install() {
    console.log('Installing', this.data.name)
    try {
      await install(this.data)
      delete this.status.lastError
    } catch (error) {
      this.recordError('install', error)
      throw error
    }
  }
  async update() {
    if (this.status.updating) return
    this.status.updating = true
    this.infoStream.setNeedsUpdate()
    console.log('Updating', this.data.name)
    try {
      await update(this.data)
      delete this.status.lastError
      await this.restartIfNeeded()
    } catch (error) {
      this.recordError('update', error)
      throw error
    } finally {
      delete this.status.updating
    }
  }
  async uninstall() {
    console.log('Uninstalling', this.data.name)
    await uninstall(this.data)
  }
  async checkForUpdates(): Promise<boolean> {
    if (this.status.checkingForUpdates) return false
    this.status.checkingForUpdates = true
    try {
      const available = await checkForUpdates(this.data)
      if (available) this.data.updateAvailable = true
      return available
    } catch {
      return false
    } finally {
      delete this.status.checkingForUpdates
    }
  }
  start() {
    if (isSystemd(this.data)) {
      if (this.launched) return
      this.launched = 1
      this.data.active = true
      this.status.started = new Date()
      void startSystemd(this.data).catch(error => {
        this.launched = 0
        delete this.status.started
        this.status.crashes += 1
        this.recordError('start', error)
        this.infoStream.setNeedsUpdate()
        console.error('Failed to start', this.data.name, error)
      })
      return
    }
    const instances = this.data.instances ?? 1
    if (instances > 1024) throw `too many instances for ${this.data.name}`
    while (instances > this.launched) {
      this.startOne()
    }
  }
  async setSettings(settings: AppSettings) {
    if (!this.data.settings) {
      this.data.settings = settings
    } else {
      let s = this.data.settings
      if (settings.env) s.env = settings.env
      if (settings.secrets) {
        if (!s.secrets) {
          s.secrets = settings.secrets
        } else {
          // only overriding provided secrets
          for (const [key, value] of Object.entries(settings.secrets)) {
            s.secrets[key] = value
          }
        }
      }
    }
    await this.restartIfNeeded()
  }
  info() {
    if (!this.data.settings?.secrets) return this.data
    // deleting secrets
    const data = { ...this.data }
    data.settings = { ...data.settings }
    delete data.settings.secrets
    return data
  }
  async restartIfNeeded() {
    if (!this.data.active) return
    await this.stop()
    delete this.status.updating
    this.infoStream.setNeedsUpdate()
    this.start()
  }
  private async startOne() {
    this.launched += 1
    try {
      while (true) {
        const started = Date.now()
        try {
          await this.launch()
          this.consecutiveCrashes = 0
          return
        } catch {
          if (!this.data.restarts || !this.data.active) return
          if (Date.now() - started >= this.restartPolicy.stableAfter) this.consecutiveCrashes = 0
          this.consecutiveCrashes += 1
          const delay = this.restartDelay(this.consecutiveCrashes)
          this.status.nextRestart = new Date(Date.now() + delay)
          this.infoStream.setNeedsUpdate()
          console.log('Restarting', this.data.name, `in ${delay}ms`)
          await new Promise(a => setTimeout(a, delay))
          delete this.status.nextRestart
          // Stopped while waiting
          if (!this.data.active) return
        }
      }
    } finally {
      this.launched -= 1
    }
  }
  /** Exponential backoff: initialDelay, doubling up to maxDelay. */
  restartDelay(crashes: number): number {
    const { initialDelay, maxDelay } = this.restartPolicy
    return Math.min(initialDelay * 2 ** Math.max(0, Math.min(crashes - 1, 30)), maxDelay)
  }
  private async launch() {
    console.log('Launching', this.data.name)
    try {
      this.data.active = true
      delete this.status.lastError
      this.status.started = new Date()
      this.infoStream.setNeedsUpdate()
      const startedAt = Date.now()
      const process = launch(this.data, this.data.settings, appEnvironment(this.data.name))
      this.processes.push(process)
      const output = Promise.all([this.logs.pump(process.stdout, 'stdout'), this.logs.pump(process.stderr, 'stderr')])
      try {
        const code = await process.exited
        // A grandchild can keep the pipes open after the process exits
        await Promise.race([output, new Promise(a => setTimeout(a, 200))])
        this.infoStream.setNeedsUpdate()
        this.processes.removeFirst(a => a === process)
        this.status.processes.removeFirst(a => a.pid === process.pid)
        if (this.stopping.has(process)) return
        if (code === 0 && !process.signalCode) return
        const stderr = this.logs
          .tail(5, 'stderr', startedAt)
          .map(line => line.text)
          .join('\n')
        throw new CrashError(code, process.signalCode ?? null, stderr)
      } catch (e) {
        this.processes.removeFirst(a => a === process)
        this.status.processes.removeFirst(a => a.pid === process.pid)
        throw e
      }
    } catch (e) {
      delete this.status.started
      this.status.crashes += 1
      this.recordError('run', e)
      this.infoStream.setNeedsUpdate()
      console.log('Process exited with error')
      console.log(e)
      throw e
    }
  }
  private recordError(operation: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    this.status.lastError = `${operation}: ${detail}`
    this.infoStream.setNeedsUpdate()
  }
  async stop() {
    console.log('Stopping', this.data.name)
    this.data.active = false
    if (isSystemd(this.data)) {
      await stopSystemd(this.data)
      this.launched = 0
      delete this.status.started
      this.infoStream.setNeedsUpdate()
      return
    }
    const processes = [...this.processes]
    await Promise.allSettled(
      processes.map(async process => {
        this.terminate(process)
        await new Promise<void>(r => process.exited.finally(() => r()))
      }),
    )
    this.infoStream.setNeedsUpdate()
  }
  private terminate(process: Subprocess) {
    this.stopping.add(process)
    try {
      process.kill()
    } catch {}
  }
  recentLogs(limit = 200): LogLine[] {
    return this.logs.tail(Math.max(1, Math.min(limit, 500)))
  }
  async setInstances(instances: number) {
    if (instances > 1024) throw 'too many instances'
    const i = instances > 0 ? instances : 1
    if (i > 1) {
      this.data.instances = instances
    } else {
      delete this.data.instances
    }
    while (i > this.launched) {
      this.startOne()
      this.infoStream.setNeedsUpdate()
    }
    while (this.launched > i) {
      const process = this.processes.at(-1)
      if (!process) return
      this.terminate(process)
      await new Promise<void>(r => process.exited.finally(() => r()))
      this.infoStream.setNeedsUpdate()
    }
  }
}

// Missing in hub-service versions before the device layer
const deviceKeyPath: (() => string) | undefined = (hubService as { deviceKeyPath?: () => string }).deviceKeyPath

/**
 * What every app gets from the launcher: the shared device key, so its services are certified by this device,
 * and the app name as a stable instance name (cluster instances share it, as replicas of one service).
 */
export function appEnvironment(name: string): Record<string, string> {
  const env: Record<string, string> = { HUB_INSTANCE: name }
  if (deviceKeyPath) env.HUB_DEVICE_KEY = resolve(deviceKeyPath())
  return env
}

export class Apps {
  list: RunningApp[]
  statusStream = new LazyState<Status>(() => this.status()).delay(0.5).alwaysNeedsUpdate().dedupe('json')
  infoStream = new LazyState<InfoStatus>(() => this.info()).dedupe('json')
  constructor() {
    this.list = []
  }
  async load(): Promise<App[]> {
    try {
      return await Bun.file('launch.json').json()
    } catch {
      return [
        {
          name: 'Hub',
          type: 'bun',
          repo: 'v57/hub-lite',
          active: true,
          restarts: true,
        },
      ]
    }
  }
  async start() {
    const configs = await this.load()
    for (const config of configs) {
      const app = new RunningApp(config, this.infoStream)
      if (config.active) {
        await app.install()
        app.start()
      }
      this.list.push(app)
    }
  }
  async create(config: App, save: boolean = true) {
    const installed = this.optional(config.name)
    if (installed) {
      installed.data.active = config.active
      installed.data.restarts = config.restarts
      if (config.active) installed.start()
    } else {
      const app = new RunningApp(config, this.infoStream)
      await app.install()
      this.list.push(app)
      if (config.active) app.start()
      this.infoStream.setNeedsUpdate()
    }
    if (save) await this.save()
  }
  async checkForUpdates(): Promise<void> {
    let tasks: Promise<boolean>[] = []
    for (const app of this.list) {
      if (!app.data.updateAvailable) tasks.push(app.checkForUpdates())
    }
    for (const result of await Promise.allSettled(tasks)) {
      if (result.status == 'fulfilled' && result.value) {
        await this.save()
        this.infoStream.setNeedsUpdate()
        return
      }
    }
  }
  async update(): Promise<void> {
    for (const app of this.list) {
      if (app.data.updateAvailable) {
        delete app.data.updateAvailable
        await app.update()
        this.infoStream.setNeedsUpdate()
      }
    }
  }
  async stop(): Promise<void> {
    await Promise.allSettled(this.list.map(app => app.stop()))
    this.infoStream.setNeedsUpdate()
    await new Promise(r => setTimeout(r, 500))
  }
  async uninstall(name: string, save: boolean = true) {
    const app = this.optional(name)
    if (!app) return
    await app.stop()
    await app.uninstall()
    const index = this.list.findIndex(a => a.data.name === name)
    if (index >= 0) {
      this.list.splice(index, 1)
      this.infoStream.setNeedsUpdate()
      if (save) await this.save()
    }
  }
  async save() {
    await Bun.file('launch.json').write(
      JSON.stringify(
        this.list.map(a => a.data),
        null,
        2,
      ),
    )
  }
  async updateUsage() {
    const pids: number[] = this.list.flatMap(a => a.processes.map(a => a.pid))
    if (!pids.length) return
    const res =
      await $`ps -p ${pids.join(',')} -o pid,%cpu,rss,vsz | awk 'NR>1 {printf "%s/%s/%.2f\n", $1, $2, $3/1024, $4/1024}`.text()

    for (const a of res.split('\n')) {
      const i = a.split('/')
      const pid = Number(i[0])
      if (pid) {
        const app = this.list.find(a => a.processes.findIndex(a => a.pid === pid) !== -1)
        if (!app) continue
        const status: ProcessStatus | undefined = app.status.processes.find(a => a.pid === pid)
        let cpu = Math.ceil(Number(i[1]))
        if (cpu < 2) cpu = 0
        const memory = Math.ceil(Number(i[2]))
        if (status) {
          status.cpu = cpu
          status.memory = memory
        } else {
          app.status.processes.push({ pid, cpu, memory })
        }
      }
    }
  }
  async info() {
    return { apps: this.list.map(a => a.info()) }
  }
  async status() {
    try {
      await this.updateUsage()
    } catch {}
    return { apps: this.list.map(a => a.status) }
  }
  get(name: string): RunningApp {
    const i = this.list.findIndex(a => a.status.name === name)
    if (i === -1) throw 'app not found'
    return this.list[i]
  }
  optional(name: string): RunningApp | undefined {
    const i = this.list.findIndex(a => a.status.name === name)
    if (i === -1) return
    return this.list[i]
  }
  async pro(key: string) {
    console.log('Upgrading to Hub Pro')
    await this.optional('Hub')?.stop()
    await this.create(
      {
        name: 'Hub Pro',
        type: 'bun',
        repo: 'v57/hub-pro',
        active: true,
        restarts: true,
        env: { HUBOWNER: key, HUBLAUNCHER: await publicKey() },
      },
      false,
    )
    await this.uninstall('Hub', false)
    await this.save()
  }
}

declare global {
  interface Array<T> {
    removeFirst(check: (element: T) => boolean): void
  }
}

if (!Array.prototype.removeFirst) {
  Array.prototype.removeFirst = function <T>(this: T[], check: (element: T) => boolean) {
    const index = this.findIndex(check)
    if (index === -1) return
    this.splice(index, 1)
  }
}
