import { $ } from 'bun'
import { Service } from 'hub-service'
import { Apps } from './launcher/app'
process.on('SIGTERM', () => process.exit(0)) // Docker shutdown event

const apps = new Apps()
await apps.start()

new Service()
  .post('launcher/update', async () => {
    await $`git pull`
  })
  .post('launcher/update/check', async () => {
    const res = await $`git fetch --dry-run`
    return res.stderr.length > 0
  })
  .post('launcher/update/check/all', () => apps.checkForUpdates())
  .post('launcher/update/all', () => apps.update())
  .post('launcher/stop', async () => {
    setTimeout(() => process.exit(0), 500)
  })
  .stream('launcher/info', () => apps.infoStream.makeIterator())
  .stream('launcher/status', () => apps.statusStream.makeIterator())
  .post('launcher/pro', key => apps.pro(key))
  .post('launcher/app/stop', async name => {
    await apps.get(name).stop()
    await apps.save()
  })
  .post('launcher/app/start', async name => {
    apps.get(name).start()
    await apps.save()
  })
  .post('launcher/app/create', app => apps.create(app))
  .post('launcher/app/uninstall', app => apps.uninstall(app))
  .post('launcher/app/settings', async ({ app, settings }) => {
    await apps.get(app).setSettings(settings)
    await apps.save()
  })
  .post('launcher/app/cluster', async ({ name, count }) => {
    await apps.get(name).setInstances(count)
    await apps.save()
  })
  .start()
