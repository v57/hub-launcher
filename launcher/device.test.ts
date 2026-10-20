import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DeviceUsage,
  describeDevice,
  parseDisks,
  parseHostKey,
  parseOSRelease,
  parsePmset,
  parseSSHPort,
  parseSimulators,
  parseVMStat,
  sshCapability,
} from './device'
import { reportDevice } from './reporter'

describe('device description', () => {
  test('lists user volumes from df on macOS', () => {
    const output = `Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s5s1 482766932 13337964 145941068 9% /
devfs 215 215 0 100% /dev
/dev/disk3s6 482766932 1048608 145941068 1% /System/Volumes/VM
/dev/disk5s1 976562500 700000000 276562500 72% /Volumes/Backup Disk
/dev/disk7s1 1000 10 990 1% /Volumes/Recovery`
    expect(parseDisks(output, 'darwin')).toEqual([
      { name: '/', total: 482766932 * 1024, free: 145941068 * 1024 },
      { name: 'Backup Disk', total: 976562500 * 1024, free: 276562500 * 1024 },
    ])
  })

  test('lists block devices from df on Linux', () => {
    const output = `Filesystem 1024-blocks Used Available Capacity Mounted on
overlay 100 50 50 50% /
tmpfs 10 0 10 0% /dev/shm
/dev/sda1 1000 100 900 10% /mnt/data
/dev/sda2 100 10 90 10% /boot/efi
/dev/loop0 10 10 0 100% /snap/core/1`
    expect(parseDisks(output, 'linux')).toEqual([
      { name: '/', total: 102400, free: 51200 },
      { name: '/mnt/data', total: 1024000, free: 921600 },
    ])
  })

  test('reads pmset', () => {
    expect(parsePmset(`Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t68%; charging; 1:24 remaining present: true`)).toEqual({
      power: 'ac',
      battery: 0.68,
      charging: true,
    })
    expect(parsePmset(`Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t40%; discharging; 3:00 remaining`)).toEqual({
      power: 'battery',
      battery: 0.4,
      charging: false,
    })
    expect(parsePmset(`Now drawing from 'AC Power'`)).toEqual({ power: 'ac' })
  })

  test('reads os-release', () => {
    expect(parseOSRelease('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n')).toBe('Ubuntu 24.04.1 LTS')
    expect(parseOSRelease('NAME=x')).toBeUndefined()
  })

  test('reads simulator names', () => {
    const json = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
          { name: 'iPhone 18 Pro', isAvailable: true },
          { name: 'iPad Air', isAvailable: true },
        ],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ name: 'iPhone 18 Pro', isAvailable: true }],
      },
    })
    expect(parseSimulators(json)).toEqual(['iPad Air', 'iPhone 18 Pro'])
    expect(parseSimulators('nope')).toEqual([])
  })

  test('reads vm_stat', () => {
    const output = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    52592.
Pages wired down:                             100.
Pages purgeable:                                10.
Anonymous pages:                              1000.
Pages occupied by compressor:                 50.`
    expect(parseVMStat(output)).toBe((1000 - 10 + 100 + 50) * 16384)
    expect(parseVMStat('nothing')).toBeUndefined()
  })

  test('detects tools by running them', async () => {
    const runner = async (command: string[]) => {
      switch (command[0]) {
        case 'xcodebuild':
          return { code: 0, stdout: 'Xcode 27.0\nBuild version 27A1\n' }
        case 'swift':
          return { code: 0, stdout: 'swift-driver version: 1.0 Apple Swift version 6.3 (swiftlang-6.3)\n' }
        case 'docker':
          return { code: 0, stdout: 'Docker version 28.0.1\n' }
        default:
          return undefined
      }
    }
    const description = await describeDevice('Mac Studio', runner)
    expect(description.name).toBe('Mac Studio')
    expect(description.arch).toBe(process.arch)
    expect(description.capabilities!.cpu!.cores).toBeGreaterThan(0)
    expect(description.capabilities!.memory).toBeGreaterThan(0)
    const tools = description.capabilities!.tools!
    if (process.platform === 'darwin') expect(tools.xcode).toBe('27.0')
    expect(tools.swift).toBe('6.3')
    expect(tools.docker).toBeTrue()
    expect(tools.adb).toBeFalse()
  })

  test('samples CPU between 0 and 1', async () => {
    const usage = new DeviceUsage()
    await new Promise(r => setTimeout(r, 50))
    const data = await usage.sample(async () => undefined)
    expect(data.memoryUsed).toBeGreaterThan(0)
    if (data.cpu !== undefined) {
      expect(data.cpu).toBeGreaterThanOrEqual(0)
      expect(data.cpu).toBeLessThanOrEqual(1)
    }
  })
})

describe('ssh capability', () => {
  const hostKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
  test('parses host keys and ports', () => {
    expect(parseHostKey(`${hostKey} root@mac\n`)).toBe(hostKey)
    expect(parseHostKey('garbage')).toBeUndefined()
    expect(parseSSHPort('#Port 22\nPort 2222\n')).toBe(2222)
    expect(parseSSHPort('#Port 2200\n')).toBe(22)
  })

  test('signs the host key with the device key when sshd listens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hub-launcher-ssh-'))
    try {
      const ecdsa = 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEm1'
      const paths = {
        hostKeys: ['ed25519', 'ecdsa', 'rsa'].map(type => join(directory, `ssh_host_${type}_key.pub`)),
        config: join(directory, 'sshd_config'),
      }
      await Bun.write(paths.hostKeys[0]!, `${hostKey} root@host\n`)
      await Bun.write(paths.hostKeys[1]!, `${ecdsa}\n`)
      await Bun.write(paths.config, 'Port 2022\n')
      const keys = generateKeyPairSync('ed25519')
      const signer = (data: string) => sign(null, Buffer.from(data), keys.privateKey).toString('base64')
      const ports: number[] = []
      const ssh = await sshCapability(signer, paths, async port => (ports.push(port), true))
      expect(ports).toEqual([2022])
      expect(ssh!.port).toBe(2022)
      expect(ssh!.hostKey).toBe(hostKey)
      expect(verify(null, Buffer.from(`ssh1:${hostKey}`), keys.publicKey, Buffer.from(ssh!.hostKeySignature, 'base64'))).toBeTrue()
      // Every readable key, most preferred first; the missing RSA key is skipped
      expect(ssh!.hostKeys!.map(key => key.hostKey)).toEqual([hostKey, ecdsa])
      for (const key of ssh!.hostKeys!) {
        expect(verify(null, Buffer.from(`ssh1:${key.hostKey}`), keys.publicKey, Buffer.from(key.hostKeySignature, 'base64'))).toBeTrue()
      }
      expect(await sshCapability(signer, paths, async () => false)).toBeUndefined()
      // Without Ed25519 the next key type is the preferred one
      const ecdsaOnly = await sshCapability(signer, { ...paths, hostKeys: paths.hostKeys.slice(1) }, async () => true)
      expect(ecdsaOnly!.hostKey).toBe(ecdsa)
      expect(await sshCapability(signer, { ...paths, hostKeys: [join(directory, 'missing')] }, async () => true)).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('device reporter', () => {
  test('describes the device and reports live data', async () => {
    const descriptions: any[] = []
    let collect: (() => Promise<any>) | undefined
    let stopped = false
    const stop = reportDevice({
      device: { name: 'Mac Studio' },
      async describeDevice(description) {
        descriptions.push(description)
        return true
      },
      reportDeviceData(_interval, callback) {
        collect = callback
        return () => (stopped = true)
      },
    })
    const end = Date.now() + 15_000
    while (!descriptions.length && Date.now() < end) await new Promise(r => setTimeout(r, 20))
    expect(descriptions[0].name).toBe('Mac Studio')
    expect((await collect!()).memoryUsed).toBeGreaterThan(0)
    stop()
    expect(stopped).toBeTrue()
  }, 20_000)

  test('does nothing with a hub-service without the reporter API', () => {
    expect(() => reportDevice({})()).not.toThrow()
  })
})
