const group = 'Launcher'
const named = (name: string) => ({ permissions: { group, name } })
/**
 * Owners only (security audit M10, decisions 1.0 Hub 7): installing an app, changing its env or updating runs code on
 * this machine, and an env such as HUBOWNER on the Hub makes a key an owner, so a grant of these was a shell and a way
 * to owner. The service checks the hub's caller itself, so a grant an owner gives doesn't open them.
 */
const owner = (name: string) => ({ auth: 'owner' as const, ...named(name) })

/** Who may call each launcher path */
export const routes = {
  update: owner('Update apps'),
  updateCheck: named('Check for updates'),
  stop: named('Stop apps'),
  info: named('View app information'),
  pair: owner('Pair owners'),
  start: named('Start apps'),
  restart: named('Restart apps'),
  install: owner('Install apps'),
  uninstall: owner('Uninstall apps'),
  settings: owner('Change app settings'),
  cluster: owner('Cluster apps'),
}
