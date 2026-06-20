> Made for [Hub](https://hub.v57.dev)

Manage and run the apps in your Hub network. It's primarily used to launch Hub and it's services and keep them alive. 

Implemented features:
- Installs [Hub Lite](https://github.com/v57/hub-lite) server by default with the option to upgrade to [Pro](https://github.com/v57/hub-pro)
- Add installation, uninstallation, check for updates, update and launch shell scripts and use it from Hub app
- Use bun preset to easily install bun and use scripts from GitHub
- Watch process cpu and memory usage
- Set environment values for each process
- Secret environment values
- Check for updates and update your commands easily from Hub
- Start and stop processes when you need
- Set number of processes you want to run

## Run from Source
```sh
bun install && bun .
```

## Run from [Hub cli](https://github.com/v57/hub)
```sh
bunx v57/hub
```

Stop with
```sh
bunx v57/hub stop
```

# Api usage
### Watch app info

```ts
for await (const info of service.values('launcher/info')) {
  // { apps: App[] }
}
```

### Watch app status

```ts
for await (const status of service.values('launcher/status')) {
  // { apps: AppStatus[] }
}
```

### Update and restart apps

```ts
await service.send('launcher/update/check')
await service.send('launcher/update/check/all')
await service.send('launcher/update/all')
await service.send('launcher/stop')
```

### Manage individual apps

```ts
await service.send('launcher/app/start', 'Hub Lite')
await service.send('launcher/app/stop', 'Hub Lite')
await service.send('launcher/app/restart', 'Hub Lite')
await service.send('launcher/app/uninstall', 'Hub Lite')
```

### Install or configure apps

```ts
await service.send('launcher/app/create', {
  name: 'My App',
  type: 'bun',
  repo: 'v57/my-app',
  active: true,
})

await service.send('launcher/app/settings', {
  app: 'My App',
  settings: {
    env: {
      PORT: '3000',
    },
  },
})

await service.send('launcher/app/cluster', {
  name: 'My App',
  count: 3,
})
```

### Upgrade Hub

```ts
await service.send('launcher/pro', 'your-owner-key')
```

## Launch config

`launch.json` stores the managed apps.

```ts
interface AppSettings {
  env?: Record<string, string | undefined>
  secrets?: Record<string, string | undefined>
}

interface BunApp {
  name: string
  type: 'bun'
  repo: string
  command?: string
  commit?: string
  env?: Record<string, string>
  envValues?: Record<string, string>
  active?: boolean
  restarts?: boolean
  instances?: number
  settings?: AppSettings
}

interface ShellApp {
  name: string
  type: 'sh'
  run: string
  directory?: string
  install?: string[] | string
  checkForUpdates?: string[] | string
  update?: string[] | string
  uninstall?: string[] | string
  env?: Record<string, string>
  envValues?: Record<string, string>
  active?: boolean
  restarts?: boolean
  instances?: number
  settings?: AppSettings
}

type AppSetup = BunApp | ShellApp
```

## Status shape

```ts
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
```

## Example launch file

```json
[
  {
    "name": "Hub Lite",
    "type": "bun",
    "command": "start",
    "repo": "v57/hub-lite",
    "active": true
  },
  {
    "name": "Google",
    "type": "bun",
    "repo": "v57/hub-google",
    "active": true
  },
  {
    "name": "MongoDB",
    "type": "sh",
    "run": "/usr/local/bin/mongod --dbpath ~/mongo",
    "active": true
  }
]
```
