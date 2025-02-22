import { type Subprocess, $ } from 'bun'
import { install, uninstall, launch, type AppSetup } from './manager'

interface AppInfo {
  name: string
  active: boolean
  restarts: boolean
}
type App = AppInfo & AppSetup

interface AppStatus {
  name: string
  isRunning: boolean
  crashes: number
  cpu?: number
  memory?: number
}
class RunningApp {
  data: App
  status: AppStatus
  process?: Subprocess
  constructor(data: App) {
    this.data = data
    this.status = {
      name: data.name,
      isRunning: false,
      crashes: 0,
    }
  }
  async install() {
    await install(this.data)
  }
  async uninstall() {
    await uninstall(this.data)
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
      await this.launch()
    }
  }
  async launch() {
    try {
      this.data.active = true
      this.status.isRunning = true
      const process = launch(this.data)
      this.process = process
      const code = await process.exited
      this.status.isRunning = false
      delete this.process
      if (code === 0 || process.killed) return
      console.log('Process completed', code, process.killed)
    } catch (e) {
      this.status.isRunning = false
      delete this.process
      this.status.crashes += 1
      console.log('Process exited with error')
      throw e
    }
  }
  async stop() {
    this.data.active = false
    this.process?.kill()
  }
}

export class Apps {
  list: RunningApp[]
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
      const app = new RunningApp(config)
      await app.install()
      app.start()
      this.list.push(app)
    }
  }
  async create(config: App) {
    const app = new RunningApp(config)
    await app.install()
    app.start()
    this.list.push(app)
    this.save()
  }
  async uninstall(name: string) {
    const app = this.get(name)
    if (!app) return
    await app.stop()
    await app.uninstall()
    const index = this.list.findIndex(a => a.data.name === name)
    if (index >= 0) {
      this.list.splice(index, 1)
      await this.save()
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
  get(name: string) {
    const i = this.list.findIndex(a => a.status.name === name)
    if (i === -1) throw 'app not found'
    return this.list[i]
  }
}
