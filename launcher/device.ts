import { arch, cpus, freemem, release, totalmem } from 'node:os'

/** What the launcher reports for its device (`hub/device/describe`). */
export interface DeviceDescription {
  name?: string
  os?: string
  arch?: string
  capabilities?: {
    cpu?: { cores?: number; model?: string }
    memory?: number
    disks?: Disk[]
    power?: 'ac' | 'battery'
    tools?: Tools
  }
}
interface Disk {
  name: string
  total?: number
  free?: number
}
interface Tools {
  xcode?: string
  swift?: string
  simulators?: string[]
  adb?: boolean
  docker?: boolean
}
/** Live data (`hub/device/data`) */
export interface DeviceData {
  cpu?: number
  memoryUsed?: number
  battery?: number
  charging?: boolean
  [key: string]: unknown
}

interface Output {
  code: number
  stdout: string
}
type Run = (command: string[]) => Promise<Output | undefined>

/** Runs a command with a timeout. Undefined when it is missing or times out. */
export async function run(command: string[], timeout = 10_000): Promise<Output | undefined> {
  try {
    const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
    const timer = setTimeout(() => process.kill(), timeout)
    const [code, stdout] = await Promise.all([process.exited, new Response(process.stdout).text()])
    clearTimeout(timer)
    return { code, stdout }
  } catch {
    return
  }
}

async function text(runner: Run, command: string[]): Promise<string | undefined> {
  const output = await runner(command)
  if (output?.code !== 0) return
  return output.stdout.trim() || undefined
}

export async function describeDevice(name: string | undefined, runner: Run = run): Promise<DeviceDescription> {
  const processors = cpus()
  const [os, disks, power, tools] = await Promise.all([
    osVersion(runner),
    listDisks(runner),
    powerSource(runner),
    listTools(runner),
  ])
  const capabilities: NonNullable<DeviceDescription['capabilities']> = {
    cpu: { cores: processors.length, model: processors[0]?.model?.trim() || undefined },
    memory: totalmem(),
    disks,
    tools,
  }
  if (power) capabilities.power = power
  return { name, os, arch: arch(), capabilities }
}

async function osVersion(runner: Run): Promise<string> {
  if (process.platform === 'darwin') return (await text(runner, ['sw_vers', '-productVersion'])) ?? release()
  if (process.platform === 'linux') {
    try {
      return parseOSRelease(await Bun.file('/etc/os-release').text()) ?? release()
    } catch {}
  }
  return release()
}

/** PRETTY_NAME from /etc/os-release */
export function parseOSRelease(content: string): string | undefined {
  const line = content.split('\n').find(line => line.startsWith('PRETTY_NAME='))
  return line?.slice('PRETTY_NAME='.length).replace(/^"|"$/g, '') || undefined
}

async function listDisks(runner: Run): Promise<Disk[]> {
  const output = await text(runner, ['df', '-kP'])
  return output ? parseDisks(output, process.platform) : []
}

const macSystemVolumes = new Set(['Recovery', 'Preboot', 'VM', 'Update', 'xarts', 'iSCPreboot', 'Hardware'])

/** User-visible volumes from `df -kP`: the root and, on macOS, /Volumes; on Linux, block devices. */
export function parseDisks(output: string, platform: string): Disk[] {
  const disks: Disk[] = []
  for (const line of output.split('\n').slice(1)) {
    // Filesystem, blocks, used, available, capacity, mount point (may contain spaces)
    const match = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/)
    if (!match) continue
    const [, filesystem, blocks, , available, mount] = match
    let name: string | undefined
    if (mount === '/') name = '/'
    else if (platform === 'darwin') {
      const volume = mount!.startsWith('/Volumes/') ? mount!.slice('/Volumes/'.length) : undefined
      if (volume && !macSystemVolumes.has(volume)) name = volume
    } else if (filesystem!.startsWith('/dev/') && !filesystem!.startsWith('/dev/loop') && !mount!.startsWith('/boot')) {
      name = mount
    }
    if (!name) continue
    disks.push({ name, total: Number(blocks) * 1024, free: Number(available) * 1024 })
  }
  return disks
}

async function powerSource(runner: Run): Promise<'ac' | 'battery' | undefined> {
  if (process.platform === 'darwin') {
    const output = await text(runner, ['pmset', '-g', 'batt'])
    return output ? parsePmset(output).power : undefined
  }
  if (process.platform === 'linux') {
    try {
      const online = (await Bun.file('/sys/class/power_supply/AC/online').text()).trim()
      return online === '1' ? 'ac' : 'battery'
    } catch {}
  }
}

/** Power source and battery from `pmset -g batt`. */
export function parsePmset(output: string): { power?: 'ac' | 'battery'; battery?: number; charging?: boolean } {
  const result: { power?: 'ac' | 'battery'; battery?: number; charging?: boolean } = {}
  if (output.includes("'AC Power'")) result.power = 'ac'
  else if (output.includes("'Battery Power'")) result.power = 'battery'
  const battery = output.match(/(\d+)%;\s*([a-zA-Z ]+);/)
  if (battery) {
    result.battery = Number(battery[1]) / 100
    result.charging = battery[2]!.trim() === 'charging' || battery[2]!.trim() === 'charged'
  }
  return result
}

async function listTools(runner: Run): Promise<Tools> {
  const tools: Tools = {}
  const [xcode, swift, simulators, adb, docker] = await Promise.all([
    process.platform === 'darwin' ? text(runner, ['xcodebuild', '-version']) : undefined,
    text(runner, ['swift', '--version']),
    process.platform === 'darwin' ? text(runner, ['xcrun', 'simctl', 'list', 'devices', 'available', '-j']) : undefined,
    runner(['adb', 'version']),
    runner(['docker', '--version']),
  ])
  const xcodeVersion = xcode?.match(/^Xcode (\S+)/)?.[1]
  if (xcodeVersion) tools.xcode = xcodeVersion
  const swiftVersion = swift?.match(/Swift version (\S+)/)?.[1]
  if (swiftVersion) tools.swift = swiftVersion
  if (simulators) {
    const names = parseSimulators(simulators)
    if (names.length) tools.simulators = names
  }
  tools.adb = adb?.code === 0
  tools.docker = docker?.code === 0
  return tools
}

/** Distinct available simulator names from `xcrun simctl list devices available -j`. */
export function parseSimulators(json: string): string[] {
  try {
    const devices: Record<string, { name: string; isAvailable?: boolean }[]> = JSON.parse(json).devices ?? {}
    const names = new Set<string>()
    for (const list of Object.values(devices)) {
      for (const device of list) if (device.isAvailable !== false) names.add(device.name)
    }
    return [...names].sort()
  } catch {
    return []
  }
}

/** Live CPU (0–1, since the previous call) and memory use. */
export class DeviceUsage {
  private previous = cpuTimes()
  async sample(runner: Run = run): Promise<DeviceData> {
    const current = cpuTimes()
    const total = current.total - this.previous.total
    const idle = current.idle - this.previous.idle
    this.previous = current
    const data: DeviceData = { memoryUsed: totalmem() - freemem() }
    if (process.platform === 'darwin') {
      const output = await text(runner, ['vm_stat'])
      const used = output ? parseVMStat(output) : undefined
      if (used !== undefined) data.memoryUsed = used
    }
    if (total > 0) data.cpu = Math.round(Math.max(0, Math.min(1, 1 - idle / total)) * 1000) / 1000
    if (process.platform === 'darwin') {
      const output = await text(runner, ['pmset', '-g', 'batt'])
      const battery = output ? parsePmset(output) : {}
      if (battery.battery !== undefined) {
        data.battery = battery.battery
        data.charging = battery.charging
      }
    }
    return data
  }
}

/**
 * Memory in use from `vm_stat`, as Activity Monitor counts it: app memory (anonymous minus purgeable pages),
 * wired and compressed. macOS reports file cache as used in `os.freemem()`.
 */
export function parseVMStat(output: string): number | undefined {
  const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1])
  const pages = (name: string) => Number(output.match(new RegExp(`${name}:\\s+(\\d+)`))?.[1])
  const used = pages('Anonymous pages') - pages('Pages purgeable') + pages('Pages wired down') + pages('Pages occupied by compressor')
  if (!pageSize || !Number.isFinite(used)) return
  return used * pageSize
}

function cpuTimes() {
  let total = 0
  let idle = 0
  for (const cpu of cpus()) {
    const times = cpu.times
    total += times.user + times.nice + times.sys + times.idle + times.irq
    idle += times.idle
  }
  return { total, idle }
}
