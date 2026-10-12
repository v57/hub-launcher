import { afterAll, beforeAll, expect, test } from 'bun:test'
import { startSystemd, stopSystemd, type SystemdApp } from '../launcher/manager'

const enabled =
  process.platform === 'linux' &&
  process.getuid?.() === 0 &&
  process.env.HUB_LAUNCHER_SYSTEMD_ACCEPTANCE === '1'
const unit = 'hub-net-hn621.service'
const unitPath = `/run/systemd/system/${unit}`
const wireGuardUnit = 'hub-net-hn621-wireguard.service'
const wireGuardUnitPath = `/run/systemd/system/${wireGuardUnit}`
const marker = 'HN621_NFTABLES_FAILURE'
const setup: SystemdApp = { type: 'systemd', unit, sudo: false }
const wireGuardSetup: SystemdApp = { type: 'systemd', unit: wireGuardUnit, sudo: false }

async function systemctl(...args: string[]) {
  const process = Bun.spawn(['systemctl', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const code = await process.exited
  if (code !== 0) throw new Error(`systemctl ${args.join(' ')} exited ${code}`)
}

beforeAll(async () => {
  if (!enabled) return
  await Bun.write(
    unitPath,
    `[Service]\nType=oneshot\nExecStart=/bin/sh -c 'echo ${marker} >&2; exit 23'\n`,
  )
  await Bun.write(
    wireGuardUnitPath,
    `[Service]
Type=oneshot
User=hub-net
Group=hub-net
ExecStart=/usr/bin/hub-net
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RuntimeDirectory=hub-net
StateDirectory=hub-net
`,
  )
  await systemctl('daemon-reload')
})

afterAll(async () => {
  if (!enabled) return
  try {
    await stopSystemd(setup)
  } catch {}
  try {
    await stopSystemd(wireGuardSetup)
  } catch {}
  await Bun.file(unitPath).delete()
  await Bun.file(wireGuardUnitPath).delete()
  await systemctl('daemon-reload')
})

test.skipIf(!enabled)('failed systemd start includes agent diagnostics', async () => {
  await expect(startSystemd(setup)).rejects.toThrow(marker)
})

test.skipIf(!enabled)(
  'unavailable kernel tunnel includes WireGuard probe diagnostic',
  async () => {
    if (!(await Bun.file('/usr/bin/hub-net').exists())) {
      throw new Error('acceptance requires installed /usr/bin/hub-net')
    }
    await expect(startSystemd(wireGuardSetup)).rejects.toThrow('wireguard: open netlink probe')
  },
)
