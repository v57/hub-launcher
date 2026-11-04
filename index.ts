import { $ } from 'bun'
import { Service } from 'hub-service'
import { Apps } from './launcher/app'
import { printAttachCode } from './launcher/attach'
import { reportDevice } from './launcher/reporter'

const apps = new Apps()
await apps.start()

process.once('SIGTERM', async () => {
  await apps.stop()
  process.exit(0)
}) // Docker shutdown event

const group = 'Launcher'
type Request = { caller?: { owner?: boolean } }
// The device's reporter on servers; a second launcher on the same device is ignored by the hub
const service = new Service({
  name: 'Hub Launcher',
  icon: { symbol: 'apple.terminal.on.rectangle', text: 'GO' },
  instance: process.env.HUB_INSTANCE ?? 'hub-launcher',
  reporter: true,
  // This device's key lies in a file every app can read, so it asks to be a child: it holds what the owner gives it
  device: { attach: process.env.HUB_DEVICE_ATTACH?.trim() || true },
} as ConstructorParameters<typeof Service>[0])
service
  .post(
    'launcher/update',
    async () => {
      await $`git pull`
    },
    { permissions: { group, name: 'Update apps' } },
  )
  .post(
    'launcher/update/check',
    async () => {
      const res = await $`git fetch --dry-run`
      return res.stderr.length > 0
    },
    { permissions: { group, name: 'Update apps' } },
  )
  .post('launcher/update/check/all', () => apps.checkForUpdates(), { permissions: { group, name: 'Update apps' } })
  .post('launcher/update/all', () => apps.update(), { permissions: { group, name: 'Update apps' } })
  .post(
    'launcher/stop',
    () => {
      apps.stop()
    },
    { permissions: { group, name: 'Stop apps' } },
  )
  .stream('launcher/info', () => apps.infoStream.makeIterator(), {
    permissions: { group, name: 'View app information' },
  })
  .stream('launcher/status', () => apps.statusStream.makeIterator(), {
    permissions: { group, name: 'View app information' },
  })
  .post(
    'launcher/app/logs',
    (body: string | { name: string; limit?: number }) => {
      const { name, limit } = typeof body === 'string' ? { name: body, limit: undefined } : body
      return apps.get(name).recentLogs(limit)
    },
    { permissions: { group, name: 'View app information' } },
  )
  .post(
    'launcher/pair/new',
    // A new owner is added by an existing one. Without an owner, `hub pair` runs hub-server --pair on this device.
    async (_: unknown, request?: Request) => {
      if (request?.caller?.owner !== true) throw 'owner only'
      return apps.newPairingCode()
    },
    { permissions: { group, name: 'Pair owners' } },
  )
  .post(
    'launcher/app/stop',
    async name => {
      await apps.get(name).stop()
      await apps.save()
    },
    { permissions: { group, name: 'Stop apps' } },
  )
  .post(
    'launcher/app/start',
    async name => {
      apps.get(name).start()
      await apps.save()
    },
    { permissions: { group, name: 'Start apps' } },
  )
  .post(
    'launcher/app/restart',
    async name => {
      await apps.get(name).stop()
      apps.get(name).start()
    },
    { permissions: { group, name: 'Restart apps' } },
  )
  .post('launcher/app/create', app => apps.create(app), { permissions: { group, name: 'Install apps' } })
  .post('launcher/app/uninstall', app => apps.uninstall(app), { permissions: { group, name: 'Uninstall apps' } })
  .post(
    'launcher/app/settings',
    async ({ app, settings }) => {
      await apps.get(app).setSettings(settings)
      await apps.save()
    },
    { permissions: { group, name: 'Install apps' } },
  )
  .post(
    'launcher/app/cluster',
    async ({ name, count }) => {
      await apps.get(name).setInstances(count)
      await apps.save()
    },
    { permissions: { group, name: 'Cluster apps' } },
  )
  .start()

reportDevice(service)
printAttachCode(service)
