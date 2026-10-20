import { DeviceUsage, describeDevice, sshCapability, type DeviceData, type DeviceDescription } from './device'

/** The reporter API of hub-service. Older hub-service versions don't have it. */
interface Reporter {
  device?: { name: string; key?(): Promise<{ sign(data: string): string }> }
  describeDevice?(description: DeviceDescription): Promise<boolean>
  reportDeviceData?(interval: number, collect: () => Promise<DeviceData>): () => void
}

/** Live data interval, in milliseconds */
const dataInterval = 5_000
/** Capabilities (disk space, tools) are collected again this often, in milliseconds */
const describeInterval = 10 * 60_000

/**
 * Describes the device and sends live CPU and memory data. The hub keeps the first connected reporter of each
 * device, so with several launchers on one device the data is published once.
 */
export function reportDevice(service: Reporter): () => void {
  const describe = service.describeDevice?.bind(service)
  const reportData = service.reportDeviceData?.bind(service)
  if (!describe || !reportData || !service.device) return () => {}
  const device = service.device
  const name = device.name
  let running = true
  const update = async () => {
    try {
      const description = await describeDevice(name)
      if (device.key) {
        const key = await device.key()
        const ssh = await sshCapability(data => key.sign(data))
        if (ssh) description.capabilities = { ...description.capabilities, ssh }
      }
      await describe(description)
    } catch (error) {
      console.error('Failed to describe the device:', error)
    }
  }
  void update()
  const timer = setInterval(() => running && void update(), describeInterval)
  const usage = new DeviceUsage()
  const stopData = reportData(dataInterval, () => usage.sample())
  return () => {
    running = false
    clearInterval(timer)
    stopData()
  }
}
