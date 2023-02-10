export const getGlobal = () =>
  typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global

export function base64(value: string): string {
  const globalThis = getGlobal()

  if (typeof globalThis.btoa === 'function')
    return globalThis.btoa(value)

  if (typeof globalThis.Buffer === 'function')
    return Buffer.from(value).toString('base64')

  throw new Error('Unable to locate global `btoa` or `Buffer`')
}

export function unbase64(value: string): string {
  const globalThis = getGlobal()

  if (typeof globalThis.atob === 'function')
    return globalThis.atob(value)

  if (typeof globalThis.Buffer === 'function')
    return Buffer.from(value, 'base64').toString()

  throw new Error('Unable to locate global `atob` or `Buffer`')
}
