import { $ } from 'bun'
import { type AppSetup, install, launch } from './launcher'
import { Service } from 'hub-service'

interface App {
  name: string
  active: boolean
}

async function loadServices(): Promise<(App & AppSetup)[]> {
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
