import { describe, expect, test } from 'bun:test'
import {
  CommandError,
  systemctlCommand,
  systemctlStatusCommand,
  type SystemdApp,
} from './manager'

const setup: SystemdApp = {
  type: 'systemd',
  unit: 'hub-net.service',
}

describe('systemd app manager', () => {
  test('keeps command output in status-safe errors', () => {
    const error = new CommandError(
      ['systemctl', 'start', 'hub-net.service'],
      1,
      'hubnet: platform preflight: missing CAP_NET_ADMIN',
    )
    expect(error.message).toContain('missing CAP_NET_ADMIN')
    expect(error.status).toBe(1)
  })
  test('uses non-interactive sudo by default', () => {
    expect(systemctlCommand(setup, 'start')).toEqual([
      'sudo',
      '--non-interactive',
      'systemctl',
      'start',
      'hub-net.service',
    ])
  })

  test('supports an already privileged Launcher', () => {
    expect(systemctlCommand({ ...setup, sudo: false }, 'stop')).toEqual([
      'systemctl',
      'stop',
      'hub-net.service',
    ])
  })

  test('does not append a unit to daemon-reload', () => {
    expect(systemctlCommand(setup, 'daemon-reload', false)).toEqual([
      'sudo',
      '--non-interactive',
      'systemctl',
      'daemon-reload',
    ])
  })

  test('builds bounded status diagnostics for failed starts', () => {
    expect(systemctlStatusCommand(setup)).toEqual([
      'sudo',
      '--non-interactive',
      'systemctl',
      'status',
      '--no-pager',
      '--full',
      '--lines=20',
      'hub-net.service',
    ])
  })

  test('rejects command injection through unit names', () => {
    expect(() => systemctlCommand({ ...setup, unit: 'hub-net; reboot' }, 'start')).toThrow(
      'invalid systemd unit',
    )
  })
})
