import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Tests never touch the real ~/.hub/device.key
process.env.HUB_DEVICE_KEY = join(mkdtempSync(join(tmpdir(), 'hub-launcher-device-')), 'device.key')
