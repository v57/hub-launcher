import type { Subprocess } from 'bun'
import { install, launch, type AppSetup } from './launcher'

interface AppInfo {
  name: string
  active: boolean
  restarts: boolean
}
type App = AppInfo & AppSetup

interface AppStatus {
  isRunning: boolean
  crashes: number
}
class RunningApp {
  data: App
  status: AppStatus
  process?: Subprocess
  constructor(data: App) {
    this.data = data
    this.status = {
      isRunning: false,
      crashes: 0,
    }
  }
  async install() {
    await install(this.data)
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
      const process = launch(this.data)
      this.process = process
      const code = await process.exited
      delete this.process
      console.log('Process completed', code, process.killed)
    } catch (e) {
      delete this.process
      this.status.crashes += 1
      console.log('Process exited with error')
      throw e
    }
  }
  async stop() {
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
}
