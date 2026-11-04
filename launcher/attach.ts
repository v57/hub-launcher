type DeviceRequest = { status: string; codeValue?: string; attachedTo?: string }
interface AttachingService {
  hubKey?: string
  device?: { key(): Promise<{ publicKey: string }> }
  deviceRequest?(): AsyncIterable<DeviceRequest>
}
type SafetyCode = (hubKey: string, deviceKey: string, codeValue: string) => string

/** What to print for where this device stands: the code to compare, once the hub picked one, until a parent signed */
export function attachMessage(request: DeviceRequest, hubKey: string | undefined, deviceKey: string, safetyCode: SafetyCode): string | undefined {
  if (request.attachedTo) return request.status === 'approved' ? 'This device is attached.' : undefined
  if (!request.codeValue || !hubKey) return undefined
  return `Approve this device in the Hub app, on the Devices page. Safety code: ${safetyCode(hubKey, deviceKey, request.codeValue)}`
}

/** Prints the safety code an owner compares when taking this device as a child, whenever what it says changes */
export async function printAttachCode(service: AttachingService) {
  // Missing in hub-service versions before child devices
  if (!service.deviceRequest || !service.device) return
  const { safetyCode } = (await import('hub-service')) as unknown as { safetyCode: SafetyCode }
  let last: string | undefined
  for (;;) {
    try {
      const deviceKey = (await service.device.key()).publicKey
      for await (const request of service.deviceRequest()) {
        const message = attachMessage(request, service.hubKey, deviceKey, safetyCode)
        if (message && message !== last) console.log(message)
        if (message) last = message
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}
