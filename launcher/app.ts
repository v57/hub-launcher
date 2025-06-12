import { type Subprocess, $ } from 'bun'
import { install, checkForUpdates, update, uninstall, launch, type AppSetup } from './manager'
import { LazyState } from 'channel/more'

interface AppInfo {
  name: string
  active: boolean
  restarts: boolean
  updateAvailable?: boolean
}
type App = AppInfo & AppSetup

interface AppStatus {
  name: string
  isRunning: boolean
  checkingForUpdates?: boolean
  updating?: boolean
  crashes: number
  cpu?: number
  memory?: number
  started?: Date
}
class RunningApp {
  data: App
  infoStream: LazyState<unknown>
  status: AppStatus
  process?: Subprocess
  constructor(data: App, infoStream: LazyState<unknown>) {
    this.data = data
    this.infoStream = infoStream
    this.status = {
      name: data.name,
      isRunning: false,
      crashes: 0,
    }
  }
  async install() {
    console.log('Installing', this.data.name)
    await install(this.data)
  }
  async update() {
    if (this.status.updating) return
    this.status.updating = true
    console.log('Updating', this.data.name)
    try {
      await update(this.data)
      if (this.status.isRunning) {
        await this.stop()
        await this.start()
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
  async start() {
    if (this.data.restarts) {
      while (true) {
        try {
          await this.launch()
          return
        } catch {
          await new Promise(a => setTimeout(a, 1000))
        }
      }
    } else {
      try {
        await this.launch()
      } catch {}
    }
  }
  async launch() {
    console.log('Launching', this.data.name)
    try {
      this.data.active = true
      this.status.isRunning = true
      this.status.started = new Date()
      this.infoStream.setNeedsUpdate()
      const process = launch(this.data)
      this.process = process
      const code = await process.exited
      this.status.isRunning = false
      this.infoStream.setNeedsUpdate()
      delete this.process
      if (code === 0 || process.killed) return
      console.log('Process completed', code, process.killed)
    } catch (e) {
      delete this.status.started
      this.status.isRunning = false
      delete this.process
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
    this.process?.kill()
    this.infoStream.setNeedsUpdate()
  }
}

export class Apps {
  list: RunningApp[]
  statusStream = new LazyState(() => this.status()).delay(0.5).alwaysNeedsUpdate()
  infoStream = new LazyState(() => this.info())
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
      if (config.active && !installed.status.isRunning) {
        installed.start()
      }
    } else {
      const app = new RunningApp(config, this.infoStream)
      await app.install()
      this.list.push(app)
      if (config.active) {
        app.start()
      }
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
      if (app.data.updateAvailable) await app.update()
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
    const pids: number[] = this.list.map(a => a.process?.pid ?? 0).filter(a => a)
    if (!pids.length) return
    const res = await $`ps -p ${pids.join(
      ',',
    )} -o pid,%cpu,rss,vsz | awk 'NR>1 {printf "%s/%s/%.2f\n", $1, $2, $3/1024, $4/1024}`.text()
    for (const a of res.split('\n')) {
      const i = a.split('/')
      const pid = Number(i[0])
      if (pid) {
        const app = this.list.find(a => a.process?.pid === pid)
        if (app) {
          app.status.cpu = Number(i[1])
          app.status.memory = Number(i[2])
        }
      }
    }
  }
  async info() {
    return { apps: this.list.map(a => a.data) }
  }
  async status() {
    await this.updateUsage()
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
