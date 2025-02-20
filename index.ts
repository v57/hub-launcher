import { $ } from 'bun'
import { Service } from 'hub-service'
import { Apps } from './launcher/app'

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
  .post('launcher/stop', async () => {
    setTimeout(() => process.exit(0), 500)
  })
  .post('launcher/status', () => apps.status())
  .start()
