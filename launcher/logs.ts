export interface LogLine {
  time: number
  stream: 'stdout' | 'stderr'
  text: string
}

/** Keeps the last lines an app wrote and forwards them to the launcher's own output. */
export class AppLogs {
  lines: LogLine[] = []
  private name: string
  private limit: number
  constructor(name: string, limit = 500) {
    this.name = name
    this.limit = limit
  }
  /** Reads a child pipe line by line until it closes. */
  async pump(stream: ReadableStream<Uint8Array> | number | undefined | null, kind: LogLine['stream']) {
    if (!stream || typeof stream === 'number') return
    const decoder = new TextDecoder()
    let pending = ''
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        pending += decoder.decode(chunk, { stream: true })
        let index: number
        while ((index = pending.indexOf('\n')) !== -1) {
          this.add(kind, pending.slice(0, index))
          pending = pending.slice(index + 1)
        }
      }
    } catch {}
    pending += decoder.decode()
    if (pending) this.add(kind, pending)
  }
  add(stream: LogLine['stream'], text: string) {
    if (text.endsWith('\r')) text = text.slice(0, -1)
    this.lines.push({ time: Date.now(), stream, text })
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit)
    const line = `[${this.name}] ${text}`
    if (stream === 'stderr') console.error(line)
    else console.log(line)
  }
  /** The last lines, optionally of one stream and written at or after `since`. */
  tail(count: number, stream?: LogLine['stream'], since?: number): LogLine[] {
    let lines = this.lines
    if (stream || since !== undefined) {
      lines = lines.filter(line => (!stream || line.stream === stream) && (since === undefined || line.time >= since))
    }
    return lines.slice(-count)
  }
}
