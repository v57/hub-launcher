import { describe, expect, test } from 'bun:test'
import { attachMessage } from './attach'

const code = (hub: string, device: string, value: string) => `${hub}|${device}|${value}`

describe('what the launcher prints while attaching', () => {
  test('nothing before the hub picked a code', () => {
    expect(attachMessage({ status: 'waiting' }, 'hub', 'device', code)).toBeUndefined()
    expect(attachMessage({ status: 'pending', codeValue: 'v' }, undefined, 'device', code)).toBeUndefined()
  })
  test('the code to compare until a parent signed, also on a device already approved', () => {
    for (const status of ['pending', 'approved']) {
      expect(attachMessage({ status, codeValue: 'v' }, 'hub', 'device', code)).toContain('Safety code: hub|device|v')
    }
  })
  test('that it is attached once approved', () => {
    expect(attachMessage({ status: 'pending', codeValue: 'v', attachedTo: 'parent' }, 'hub', 'device', code)).toBeUndefined()
    expect(attachMessage({ status: 'approved', codeValue: 'v', attachedTo: 'parent' }, 'hub', 'device', code)).toBe('This device is attached.')
  })
})
