import { $ } from 'bun'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'

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
      await mkdir('apps')
    } catch {}
    const target = this.directory
    if (existsSync(target)) return
    await $`git clone "${this.address}" "${target}"`
  }
  /** The commit HEAD is at */
  async head(): Promise<string> {
    return (await $`git rev-parse HEAD`.cwd(this.directory).quiet().text()).trim()
  }
  /** The commit a tag or commit names, fetching tags first when the clone doesn't know it */
  async resolve(ref: string, fetch = false): Promise<string> {
    if (!/^[\w][\w.\-/]*$/.test(ref)) throw new Error(`invalid ref ${ref}`)
    const commit = ref + '^{commit}'
    const known = await $`git rev-parse --verify --quiet ${commit}`.cwd(this.directory).quiet().nothrow()
    if (!fetch && known.exitCode === 0) return known.text().trim()
    await $`git fetch --tags --force origin`.cwd(this.directory).quiet()
    return (await $`git rev-parse --verify ${commit}`.cwd(this.directory).quiet().text()).trim()
  }
  /** Moves to a tag or commit. Returns whether HEAD changed. */
  async changeCommit(ref?: string, fetch = false): Promise<boolean> {
    if (!ref) return false
    const before = await this.head()
    const commit = await this.resolve(ref, fetch)
    if (commit === before) return false
    await $`git reset --hard ${commit}`.cwd(this.directory).quiet()
    return true
  }
  /** Whether a pinned app is elsewhere than `ref`, after fetching its tags */
  async isAway(ref: string): Promise<boolean> {
    try {
      return (await this.resolve(ref, true)) !== (await this.head())
    } catch {
      return false
    }
  }
  async checkForUpdates(): Promise<boolean> {
    try {
      await $`git fetch origin >/dev/null`.cwd(this.directory).text()
      const response = await $`git rev-list HEAD..origin/$(git rev-parse --abbrev-ref HEAD) --count`
        .cwd(this.directory)
        .text()
      return Number(response) > 0
    } catch (error) {
      return false
    }
  }
  async update() {
    await $`git pull`.cwd(this.directory)
  }
}
