import { $ } from 'bun'
import { Service } from 'hub-service'
import { Apps } from './launcher/app'
process.on('SIGTERM', () => process.exit(0)) // Docker shutdown event

const apps = new Apps()
await apps.start()

const group = 'Launcher'
new Service()
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
    async () => {
      setTimeout(() => process.exit(0), 500)
    },
    { permissions: { group, name: 'Stop apps' } },
  )
  .stream('launcher/info', () => apps.infoStream.makeIterator(), {
    permissions: { group, name: 'View app information' },
  })
  .stream('launcher/status', () => apps.statusStream.makeIterator(), {
    permissions: { group, name: 'View app information' },
  })
  .post('launcher/pro', key => apps.pro(key), { permissions: { group, name: 'Install apps' } })
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
