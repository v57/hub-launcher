<h1>
  <img alt="Containerization logo" src="./icon.png" width="70" valign="middle">
  &nbsp;Launcher
</h1>

> Made for [Hub](https://hub.v57.dev)

Manage and run the apps in your Hub network. It's primarily used to launch Hub and it's services and keep them alive. 

Implemented features:
- Installs the [Hub server](https://github.com/v57/hub-server) by default and prints its pairing code, which makes the first Hub app that enters it the hub's owner
- Installs hub-server at its release tag (`hubServerTag` in `launcher/hub-server.ts`), never from `main`: Update moves it to the tag a newer launcher names
- Moves an older Hub Lite or Hub Pro install to hub-server (Hub Pro's data is kept)
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

## Installing on a Hub

The launcher is what puts a Hub on a machine, so it isn't in the app catalogue: it is installed by the `hub` CLI
(`bunx v57/hub`, which keeps it in `~/Hub/Launcher`), by the Docker image, or by running it from a clone. On its
first start it installs hub-server, keeps it running and prints the pairing code. The `hub` CLI starts, stops,
updates, backs up and autostarts it (see the [hub CLI](https://github.com/v57/hub)).

Every app the launcher installs is cloned into `apps/<repository name>` under the launcher's folder and runs there,
so an app's service key (`auth`) and data stay in that folder.

Environment:

| Variable | Default | |
|---|---|---|
| `HUB` | `1997` | Hub address the launcher connects to (port or `ws://`/`wss://` URL) |
| `HUB_INSTANCE` | `hub-launcher` | Instance name of the launcher's service on its device |
| `HUB_DEVICE_ATTACH` | none | Device id of the parent the launcher's device asks to be attached to |
| `HUB_DEVICE_KEY` | `~/.hub/device.key` (`/var/lib/hub/device.key` for root on Linux) | Device key file shared with the apps |
| `HUBLISTEN` | hub-server's default | Read by hub-server, which inherits the launcher's environment; the Docker image sets `0.0.0.0:1997` |

Every app inherits the launcher's environment, plus `HUB_INSTANCE` (the app's name), `HUB_DEVICE_KEY` and the app's
own `env` and secrets. hub-server alone also gets `HUBLAUNCHER`, the launcher's public key.

Secrets: the launcher needs none of its own. Its service key is the `auth` file in its folder (made 0600 at start).
Apps' secret values (`settings.secrets`) are kept in `launch.json` and never sent back by `launcher/info`.

Approval: hub-server lets the key named by `HUBLAUNCHER` host `launcher/*` without an owner's approval and gives it a
stored `prefix` grant of `launcher/`; it is never an owner. The launcher's device asks to be a child of a device of
the owner (see "This device on the hub" below), which the owner approves in the Hub app. A launcher connecting to a
hub that didn't get its key as `HUBLAUNCHER` waits on the Hub app's **Requests** page until an owner allows its paths.

## API

Every path is described for `hub/api/list` in `descriptions.ts` (titles, descriptions, input and output schemas).
The Hub protocol's API descriptions are in section 15 of `Docs/Devices/protocol.md` in the Hub workspace.

| Path | Kind | Title | Takes | Returns |
|---|---|---|---|---|
| `launcher/update` | post | Update the launcher | nothing | nothing; runs `git pull`, new code runs after a restart |
| `launcher/update/check` | post | Check for a launcher update | nothing | `boolean`: the launcher's repository has new commits |
| `launcher/update/check/all` | post | Check apps for updates | nothing | nothing; marks apps `updateAvailable` in `launcher/info` |
| `launcher/update/all` | post | Update apps | nothing | nothing; updates marked apps, restarts active ones, stops at the first failure |
| `launcher/stop` | post | Stop all apps | nothing | nothing; hub-server included, the launcher keeps running |
| `launcher/app/logs` | post | App logs | app name, or `{ name, limit? }` (1 to 500, default 200) | `{ time, stream: 'stdout' \| 'stderr', text }[]`, oldest first |
| `launcher/pair/new` | post | New pairing code | nothing | pairing code, like `K7Q-2MX` |
| `launcher/app/start` | post | Start an app | app name | nothing; saved as active |
| `launcher/app/stop` | post | Stop an app | app name | nothing; saved as inactive |
| `launcher/app/restart` | post | Restart an app | app name | nothing |
| `launcher/app/create` | post | Install an app | `AppSetup` (bun, sh or systemd, see Launch config) | nothing; starts it when active |
| `launcher/app/uninstall` | post | Uninstall an app | app name | nothing; an unknown name does nothing |
| `launcher/app/settings` | post | Change app settings | `{ app, settings: { env?, secrets? } }` | nothing; restarts the app when active |
| `launcher/app/cluster` | post | Set app instances | `{ name, count }` (at most 1024) | nothing |
| `launcher/info` | stream | Installed apps | nothing | `{ apps }`: each app's setup with `updateAvailable` and settings, without secrets |
| `launcher/status` | stream | App status | nothing | `{ apps: AppStatus[] }`, at most every half second while it changes |

Errors are strings such as `app not found`, `too many instances` or the failing command's output.

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

### New pairing code

```ts
const code = await service.send('launcher/pair/new') // 'K7Q-2MX'
```

Runs `hub-server --pair`, which replaces the old code. Only an owner may call it, to add another owner. The code
never goes over the hub otherwise: before the first owner, the launcher prints it and `hub pair` reads it from
hub-server's `data/pairing-code` on the same device.

## This device on the hub

The launcher and its apps share a device key in a file (`~/.hub/device.key`, `/var/lib/hub/device.key` for root on Linux),
so any of them can read it. That device asks to be a **child** on every connect (`Docs/Devices/protocol.md` section 14): it
holds what the owner gives it and is never an owner. The launcher prints a safety code; the owner compares it and approves
in the Hub app, on the Devices page. Set `HUB_DEVICE_ATTACH=<device id>` to name the parent. Its key gets `launcher/*` by a
grant, which only hub-server hears of (`HUBLAUNCHER`), and no owner rights.

## Permissions

Installing and uninstalling apps, changing their settings (env and secrets), updating and clustering are for owners
only (`launcher/routes.ts`): they run code on this machine, and an env such as `HUBOWNER` on the Hub makes a key an
owner. The launcher checks the hub's caller itself, so a grant doesn't open them. Starting, stopping, restarting and
viewing apps can still be granted.

Every launcher path carries a permission in the `Launcher` group (the Hub app's **Permissions** table shows them as
`Launcher: <name>`). A path with a permission is closed to everyone but owners and callers granted it, in both
`default-deny` and `default-allow` hubs, so on a new hub only owners can use the launcher.

| Path | Permission | Who may call |
|---|---|---|
| `launcher/update`, `launcher/update/all` | Update apps | owners only |
| `launcher/pair/new` | Pair owners | owners only |
| `launcher/app/create` | Install apps | owners only |
| `launcher/app/uninstall` | Uninstall apps | owners only |
| `launcher/app/settings` | Change app settings | owners only |
| `launcher/app/cluster` | Cluster apps | owners only |
| `launcher/update/check`, `launcher/update/check/all` | Check for updates | owners, and callers granted the path |
| `launcher/stop`, `launcher/app/stop` | Stop apps | owners, and callers granted the path |
| `launcher/app/start` | Start apps | owners, and callers granted the path |
| `launcher/app/restart` | Restart apps | owners, and callers granted the path |
| `launcher/info`, `launcher/status`, `launcher/app/logs` | View app information | owners, and callers granted the path |

For the owners-only paths the launcher also checks `auth: 'owner'` on the hub's caller, so no grant opens them.
To let another device watch and restart apps, an owner grants those paths, in the Hub app (a permission group, or the
device's grants) or with the hub's grant API:

```ts
await owner.send('hub/grant/add', { subject: { device: '<device id>' }, object: { path: 'launcher/app/restart' } })
```

A `prefix` grant of `launcher/` gives every path above that isn't owners-only.

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
  /** When a crashed app is started again */
  nextRestart?: Date
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
    "name": "Hub",
    "type": "bun",
    "repo": "v57/hub-server",
    "commit": "1.1.0",
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

## Testing

```sh
bun install
bun test
```

`bunfig.toml` preloads `testing/setup.ts`, which points `HUB_DEVICE_KEY` at a temporary file, so tests never touch
the machine's device key. The tests cover the app manager, hub-server pinning and migration, the lockfile's pinned
SDK, the device and attach flow, the routes' owner checks and that every registered path is described with schemas
in the subset (`descriptions.test.ts`). The systemd acceptance test runs only on Linux as root with
`HUB_LAUNCHER_SYSTEMD_ACCEPTANCE=1` (see "Managing hub-net" above).
