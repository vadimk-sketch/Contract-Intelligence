import { customAlphabet } from 'nanoid'

// time-orderable-ish: timestamp prefix + random suffix
const random = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 14)

export function newId(prefix: string): string {
  const ts = Date.now().toString(36)
  return `${prefix}_${ts}${random()}`
}

export function shortToken(len = 24): string {
  const r = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', len)
  return r()
}
