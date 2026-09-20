import { describe, expect, it } from 'vitest'
import { decodeClientMessage } from './decodeClientMessage'
import type { SubscribeMessage } from './types'

const validMessage: SubscribeMessage = {
  type: 'subscribe',
  schemaVersion: 1,
  requestId: 'request-001',
  instruments: ['EUR/USD'],
}

describe('decodeClientMessage', () => {
  it('accepts a valid subscription request', () => {
    expect(decodeClientMessage(JSON.stringify(validMessage))).toEqual({
      ok: true,
      message: validMessage,
    })
  })

  it('distinguishes malformed JSON from a contract violation', () => {
    expect(decodeClientMessage('{bad json')).toMatchObject({
      ok: false,
      reason: 'invalid_json',
    })
    expect(decodeClientMessage('{}')).toMatchObject({
      ok: false,
      reason: 'invalid_message',
    })
  })

  it.each([
    ['an empty request ID', { ...validMessage, requestId: ' ' }],
    ['an unsupported schema', { ...validMessage, schemaVersion: 2 }],
    ['an empty instrument list', { ...validMessage, instruments: [] }],
    ['an unknown instrument', { ...validMessage, instruments: ['GBP/USD'] }],
    ['duplicate instruments', { ...validMessage, instruments: ['EUR/USD', 'EUR/USD'] }],
  ])('rejects %s', (_description, message) => {
    expect(decodeClientMessage(JSON.stringify(message)).ok).toBe(false)
  })
})
