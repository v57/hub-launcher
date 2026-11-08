import { describe, expect, test } from 'bun:test'
import { descriptions } from './descriptions'

// Every path and kind the service registers in SOURCE is described (protocol.md section 15), with schemas in the
// subset of hub-service docs/api-descriptions.md
const SOURCE = 'index.ts'
const source = await Bun.file(`${import.meta.dir}/${SOURCE}`).text()
const registrations = [...source.matchAll(/\.(post|stream)\(\s*'([^']+)'/g)].map(match => ({ kind: match[1] as 'post' | 'stream', path: match[2]! }))

const keywords = new Set(['type', 'title', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'default', 'examples'])
const types = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

/** Problems with a schema: keywords outside the subset, unknown types, required names that aren't properties */
function problems(schema: any, at = '$'): string[] {
  if (typeof schema === 'boolean') return []
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [`${at}: not a schema`]
  const found: string[] = []
  for (const key of Object.keys(schema)) if (!keywords.has(key)) found.push(`${at}: keyword ${key}`)
  for (const type of [schema.type ?? []].flat()) if (!types.has(type)) found.push(`${at}: type ${type}`)
  for (const name of schema.required ?? []) if (!schema.properties?.[name]) found.push(`${at}: required ${name} isn't a property`)
  for (const [name, property] of Object.entries(schema.properties ?? {})) found.push(...problems(property, `${at}.${name}`))
  if (schema.items) found.push(...problems(schema.items, `${at}[]`))
  if (schema.additionalProperties !== undefined) found.push(...problems(schema.additionalProperties, `${at}.*`))
  for (const option of schema.anyOf ?? []) found.push(...problems(option, `${at}|`))
  return found
}

describe('API descriptions', () => {
  test('every registered path and kind is described, and nothing else', () => {
    const described = (['post', 'stream'] as const).flatMap(kind => Object.keys(descriptions[kind] ?? {}).map(path => `${kind} ${path}`))
    expect(described.sort()).toEqual([...new Set(registrations.map(({ kind, path }) => `${kind} ${path}`))].sort())
  })
  test('each registration passes its own description', () => {
    for (const { kind, path } of registrations) expect(source).toContain(`descriptions.${kind}['${path}']`)
  })
  test('descriptions are real sentences and schemas stay in the subset', () => {
    for (const kind of ['post', 'stream'] as const) {
      for (const [path, entry] of Object.entries(descriptions[kind] ?? {})) {
        expect(entry.description?.length ?? 0, `${kind} ${path}`).toBeGreaterThan(20)
        expect(entry.title?.length ?? 0, `${kind} ${path}`).toBeLessThanOrEqual(128)
        expect(entry.description!.length, `${kind} ${path}`).toBeLessThanOrEqual(4096)
        for (const schema of [entry.inputSchema, entry.outputSchema]) if (schema) expect(problems(schema), `${kind} ${path}`).toEqual([])
      }
    }
  })
})
