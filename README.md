<h1>
  <img alt="Containerization logo" src="./icon.png" width="70" valign="middle">
  &nbsp;Launcher
</h1>

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

## Run from Docker
```
docker build -t hub .
docker run -d --name hub -p 1997:1997 -e HUBLISTEN=0.0.0.0:1997 --restart=always hub
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

interface SystemdApp {
  name: string
  type: 'systemd'
  unit: string
  install?: string[] | string
  checkForUpdates?: string[] | string
  update?: string[] | string
  uninstall?: string[] | string
  sudo?: boolean
  active?: boolean
  restarts?: boolean
}

type AppSetup = BunApp | ShellApp | SystemdApp
```

### Managing hub-net

Use the `systemd` app type for `hub-net`. Launcher manages package commands and
the unit lifecycle; `hub-net` remains a normal system service and works without
Launcher. Uninstall commands should remove package files only. They must not
remove `/var/lib/hub-net`, which owns the persistent agent identity and
WireGuard key.

```json
{
  "name": "Hub Network",
  "type": "systemd",
  "unit": "hub-net.service",
  "install": "sudo /opt/hub-net/install",
  "checkForUpdates": "/opt/hub-net/check-for-updates",
  "update": "sudo /opt/hub-net/update",
  "uninstall": "sudo /opt/hub-net/uninstall",
  "active": true
}
```

`sudo` defaults to `true` for `systemctl` calls and uses non-interactive mode,
so missing privilege fails promptly instead of hanging Launcher. Set
`"sudo": false` only when Launcher itself already runs with sufficient
privilege. Package scripts remain explicit install metadata; Launcher does not
hold or generate agent identity material.

Failed service starts include a bounded `systemctl status` snapshot in
`lastError`, preserving the agent's setup diagnostic without starting an
unbounded journal reader. Privileged Linux acceptance uses temporary units to
verify both generic agent stderr and an actual `hub-net` WireGuard probe
failure caused by denying `AF_NETLINK`:

```sh
sudo HUB_LAUNCHER_SYSTEMD_ACCEPTANCE=1 bun test integration/systemd_failure.test.ts
```

## Status shape

```ts
interface AppStatus {
  name: string
  checkingForUpdates?: boolean
  updating?: boolean
  /** Last install, update, start, or process failure. Cleared after success. */
  lastError?: string
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
