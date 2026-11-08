import { describe, expect, test } from 'bun:test'
import { ServiceRequest } from 'hub-service/request'
import { routes } from './routes'

// Security audit M10: a member granted "Install apps" could run any command and make itself an owner
describe('launcher routes', () => {
  test('installing, changing settings, updating and pairing are for owners only', () => {
    for (const route of [routes.install, routes.uninstall, routes.settings, routes.update, routes.cluster, routes.pair]) {
      expect(route.auth).toBe('owner')
    }
  })

  test("a granted member's call is refused, an owner's goes through", () => {
    const member = new ServiceRequest({}, { key: 'member', owner: false, groups: ['Launcher'] } as any)
    expect(() => member.require(routes.install)).toThrow()
    const owner = new ServiceRequest({}, { key: 'owner', owner: true, groups: [] } as any)
    expect(() => owner.require(routes.install)).not.toThrow()
    expect(() => member.require(routes.info)).not.toThrow()
  })
})
