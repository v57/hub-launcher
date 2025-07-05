import { type Subprocess, $ } from 'bun'
import { install, checkForUpdates, update, uninstall, launch, type AppSetup } from './manager'
import { LazyState } from 'channel/more'

interface AppInfo {
  name: string
  active: boolean
  restarts: boolean
  updateAvailable?: boolean
  instances?: number
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
  crashes: number
  processes: ProcessStatus[]
  started?: Date
}
interface ProcessStatus {
  pid: number
  cpu: number
  memory: number
}
class RunningApp {
  data: App
  infoStream: LazyState<InfoStatus>
  status: AppStatus
  processes: Subprocess[] = []
  launched = 0
  constructor(data: App, infoStream: LazyState<InfoStatus>) {
    this.data = data
    this.infoStream = infoStream
    this.status = {
      name: data.name,
      crashes: 0,
      processes: [],
    }
  }
  async install() {
    console.log('Installing', this.data.name)
    await install(this.data)
  }
  async update() {
    if (this.status.updating) return
    this.status.updating = true
    this.infoStream.setNeedsUpdate()
    console.log('Updating', this.data.name)
    try {
      await update(this.data)
      if (this.data.active) {
        await this.stop()
        delete this.status.updating
        this.infoStream.setNeedsUpdate()
        this.start()
      }
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
    const instances = this.data.instances ?? 1
    if (instances > 1024) throw `too many instances for ${this.data.name}`
    while (instances > this.launched) {
      this.startOne()
    }
  }
  private async startOne() {
    this.launched += 1
    if (this.data.restarts) {
      while (true) {
        try {
          await this.launch()
          this.launched -= 1
          return
        } catch {
          await new Promise(a => setTimeout(a, 1000))
        }
      }
    } else {
      try {
        await this.launch()
      } catch {}
      this.launched -= 1
    }
  }
  private async launch() {
    console.log('Launching', this.data.name)
    try {
      this.data.active = true
      this.status.started = new Date()
      this.infoStream.setNeedsUpdate()
      const process = launch(this.data)
      this.processes.push(process)
      try {
        const code = await process.exited
        this.infoStream.setNeedsUpdate()
        this.processes.removeFirst(a => a === process)
        this.status.processes.removeFirst(a => a.pid === process.pid)
        if (code === 0 || process.killed) return
        console.log('Process completed', code, process.killed)
      } catch (e) {
        this.processes.removeFirst(a => a === process)
        this.status.processes.removeFirst(a => a.pid === process.pid)
        throw e
      }
    } catch (e) {
      delete this.status.started
      this.status.crashes += 1
      this.infoStream.setNeedsUpdate()
      console.log('Process exited with error')
      console.log(e)
      throw e
    }
  }
  async stop() {
    console.log('Stopping', this.data.name)
    this.data.active = false
    for (const process of this.processes) {
      process.kill()
      await new Promise<void>(r => process.exited.finally(() => r()))
    }
    this.infoStream.setNeedsUpdate()
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
      process.kill()
      await new Promise<void>(r => process.exited.finally(() => r()))
      this.infoStream.setNeedsUpdate()
    }
  }
}

export class Apps {
  list: RunningApp[]
  statusStream = new LazyState<Status>(() => this.status()).delay(0.5).alwaysNeedsUpdate()
  infoStream = new LazyState<InfoStatus>(() => this.info())
  constructor() {
    this.list = []
  }
  async load(): Promise<App[]> {
    try {
      return await Bun.file('launch.json').json()
    } catch {
      return [
        {
          name: 'Hub Lite',
          type: 'bun',
          command: 'start',
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
        if (status) {
          status.cpu = Number(i[1])
          status.memory = Number(i[2])
        } else {
          app.status.processes.push({
            pid,
            cpu: Number(i[1]),
            memory: Number(i[2]),
          })
        }
      }
    }
  }
  async info() {
    return { apps: this.list.map(a => a.data) }
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
    await this.optional('Hub Lite')?.stop()
    await this.create(
      {
        name: 'Hub Pro',
        type: 'bun',
        command: 'start',
        repo: 'v57/hub-pro',
        active: true,
        restarts: true,
      },
      false,
    )
    await this.create(
      {
        name: 'Hub Auth',
        type: 'bun',
        repo: 'v57/hub-auth',
        active: true,
        restarts: true,
        env: { HUBOWNER: key },
      },
      false,
    )
    await this.uninstall('Hub Lite', false)
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
