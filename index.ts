import { $ } from 'bun'
import { type AppSetup, install, launch } from './launcher'
import { Service } from 'hub-service'

interface App {
  name: string
  active: boolean
}

async function loadServices() {
  try {
    return (await Bun.file('launch.json').json()) as (App & AppSetup)[]
  } catch {
    return []
  }
}

let services = await loadServices()
for (const service of services) {
  console.log('Starting', service.name)
  await install(service)
  launch(service)
}
new Service()
  .post('launcher/update', async () => {
    await $`git pull`
  })
  .post('launcher/update/check', async () => {
    const res = await $`git fetch --dry-run`
    return res.stderr.length > 0
  })
  .start()
