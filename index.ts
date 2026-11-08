import { $ } from 'bun'
import { Service } from 'hub-service'
import { Apps } from './launcher/app'
import { printAttachCode } from './launcher/attach'
import { reportDevice } from './launcher/reporter'
import { routes } from './launcher/routes'
import { descriptions } from './descriptions'
import { chmod } from 'node:fs/promises'

const apps = new Apps()
await apps.start()

process.once('SIGTERM', async () => {
  await apps.stop()
  process.exit(0)
}) // Docker shutdown event

type Request = { caller?: { owner?: boolean } }
// The launcher's key, made before the SDK created key files 0600 (security audit L11)
await chmod('auth', 0o600).catch(() => {})
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
    { ...routes.update, ...descriptions.post['launcher/update'] },
  )
  .post(
    'launcher/update/check',
    async () => {
      const res = await $`git fetch --dry-run`
      return res.stderr.length > 0
    },
    { ...routes.updateCheck, ...descriptions.post['launcher/update/check'] },
  )
  .post('launcher/update/check/all', () => apps.checkForUpdates(), { ...routes.updateCheck, ...descriptions.post['launcher/update/check/all'] })
  .post('launcher/update/all', () => apps.update(), { ...routes.update, ...descriptions.post['launcher/update/all'] })
  .post(
    'launcher/stop',
    () => {
      apps.stop()
    },
    { ...routes.stop, ...descriptions.post['launcher/stop'] },
  )
  .stream('launcher/info', () => apps.infoStream.makeIterator(), { ...routes.info, ...descriptions.stream['launcher/info'] })
  .stream('launcher/status', () => apps.statusStream.makeIterator(), { ...routes.info, ...descriptions.stream['launcher/status'] })
  .post(
    'launcher/app/logs',
    (body: string | { name: string; limit?: number }) => {
      const { name, limit } = typeof body === 'string' ? { name: body, limit: undefined } : body
      return apps.get(name).recentLogs(limit)
    },
    { ...routes.info, ...descriptions.post['launcher/app/logs'] },
  )
  .post(
    'launcher/pair/new',
    // A new owner is added by an existing one. Without an owner, `hub pair` runs hub-server --pair on this device.
    async (_: unknown, request?: Request) => {
      if (request?.caller?.owner !== true) throw 'owner only'
      return apps.newPairingCode()
    },
    { ...routes.pair, ...descriptions.post['launcher/pair/new'] },
  )
  .post(
    'launcher/app/stop',
    async name => {
      await apps.get(name).stop()
      await apps.save()
    },
    { ...routes.stop, ...descriptions.post['launcher/app/stop'] },
  )
  .post(
    'launcher/app/start',
    async name => {
      apps.get(name).start()
      await apps.save()
    },
    { ...routes.start, ...descriptions.post['launcher/app/start'] },
  )
  .post(
    'launcher/app/restart',
    async name => {
      await apps.get(name).stop()
      apps.get(name).start()
    },
    { ...routes.restart, ...descriptions.post['launcher/app/restart'] },
  )
  .post('launcher/app/create', app => apps.create(app), { ...routes.install, ...descriptions.post['launcher/app/create'] })
  .post('launcher/app/uninstall', app => apps.uninstall(app), { ...routes.uninstall, ...descriptions.post['launcher/app/uninstall'] })
  .post(
    'launcher/app/settings',
    async ({ app, settings }) => {
      await apps.get(app).setSettings(settings)
      await apps.save()
    },
    { ...routes.settings, ...descriptions.post['launcher/app/settings'] },
  )
  .post(
    'launcher/app/cluster',
    async ({ name, count }) => {
      await apps.get(name).setInstances(count)
      await apps.save()
    },
    { ...routes.cluster, ...descriptions.post['launcher/app/cluster'] },
  )
  .start()

reportDevice(service)
printAttachCode(service)
