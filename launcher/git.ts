import { $ } from 'bun'
import fs from 'fs/promises'

export class Git {
  address: string
  constructor(address: string) {
    this.address = encodeURI(address) // prevents injections
  }
  get directory() {
    return `apps/${this.address.split('/').at(-1)}`
  }
  async clone() {
    try {
      await fs.mkdir('apps')
    } catch {}
    const target = this.directory
    const exists = await fs.exists(target)
    if (exists) return
    await $`git clone "${this.address}" "${target}"`
  }
  async changeCommit(name?: string) {
    if (!name) return
    await $`git reset --hard ${encodeURI(name)}`.cwd(this.directory)
  }
  async update() {
    await $`git pull"`.cwd(this.directory)
  }
}
