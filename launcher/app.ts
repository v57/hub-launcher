import { install, launch, type AppSetup } from './launcher'

interface AppInfo {
  name: string
  active: boolean
}
type App = AppInfo & AppSetup

interface AppStatus {
  isRunning: boolean
  crashes: number
}
class RunningApp {
  data: App
  status: AppStatus
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
    await launch(this.data).exited
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
