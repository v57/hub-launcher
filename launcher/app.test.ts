import { describe, expect, test } from 'bun:test'
import { LazyState } from 'channel/more'
import { RunningApp, CrashError } from './app'

const policy = { initialDelay: 20, maxDelay: 80, stableAfter: 60_000 }

function makeApp(run: string, restarts: boolean) {
  const info = new LazyState(() => ({ apps: [] }))
  return new RunningApp({ name: 'test', type: 'sh', run, active: true, restarts }, info, policy)
}

async function waitFor(check: () => boolean, timeout = 3000) {
  const end = Date.now() + timeout
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('running apps', () => {
  test('restarts a crashed app with backoff and counts crashes', async () => {
    const app = makeApp('echo started; echo boom >&2; exit 3', true)
    app.start()
    await waitFor(() => app.status.crashes >= 3)
    expect(app.status.lastError).toContain('exited with code 3')
    expect(app.status.lastError).toContain('boom')
    await app.stop()
    await waitFor(() => app.launched === 0)
    const crashes = app.status.crashes
    await new Promise(r => setTimeout(r, 150))
    expect(app.status.crashes).toBe(crashes)
  })

  test('restarts an app killed by a signal', async () => {
    const app = makeApp('kill -9 $$', true)
    app.start()
    await waitFor(() => app.status.crashes >= 2)
    expect(app.status.lastError).toContain('SIGKILL')
    await app.stop()
    await waitFor(() => app.launched === 0)
  })

  test('does not restart without restarts', async () => {
    const app = makeApp('exit 1', false)
    app.start()
    await waitFor(() => app.launched === 0)
    expect(app.status.crashes).toBe(1)
    await new Promise(r => setTimeout(r, 100))
    expect(app.status.crashes).toBe(1)
  })

  test('does not restart an app that exits cleanly', async () => {
    const app = makeApp('exit 0', true)
    app.start()
    await waitFor(() => app.launched === 0)
    expect(app.status.crashes).toBe(0)
  })

  test('does not count a stop as a crash', async () => {
    const app = makeApp('echo ready; sleep 30', true)
    app.start()
    await waitFor(() => app.logs.lines.some(line => line.text === 'ready'))
    await app.stop()
    await waitFor(() => app.launched === 0)
    expect(app.status.crashes).toBe(0)
  })

  test('captures stdout and stderr', async () => {
    const app = makeApp('echo one; echo two >&2; printf three', false)
    app.start()
    await waitFor(() => app.launched === 0)
    // The two pipes are read concurrently, so only the order within a stream is fixed
    expect(app.logs.tail(10, 'stdout').map(line => line.text)).toEqual(['one', 'three'])
    expect(app.logs.tail(10, 'stderr').map(line => line.text)).toEqual(['two'])
  })

  test('doubles the restart delay up to the limit', () => {
    const app = makeApp('true', false)
    expect([1, 2, 3, 4, 10].map(n => app.restartDelay(n))).toEqual([20, 40, 80, 80, 80])
  })

  test('describes crashes', () => {
    expect(new CrashError(2, null, '').message).toBe('exited with code 2')
    expect(new CrashError(null, 'SIGSEGV', 'trace').message).toBe('killed by SIGSEGV: trace')
  })
})
