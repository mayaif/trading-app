import { describe, expect, it, vi } from 'vitest'
import { FakeMarketDataServerSession } from './FakeMarketDataServerSession'
import type {
  MarketDataMessage,
  ServerMessage,
  SubscribeMessage,
} from './types'

const subscribeMessage: SubscribeMessage = {
  type: 'subscribe',
  schemaVersion: 1,
  requestId: 'request-001',
  instruments: ['EUR/USD'],
}

describe('FakeMarketDataServerSession', () => {
  function createHarness() {
    const messages: ServerMessage[] = []
    const start = vi.fn()
    const stop = vi.fn()
    const initialSnapshot: MarketDataMessage = {
      type: 'price_snapshot',
      schemaVersion: 1,
      streamId: 'stream-test',
      sequence: 1,
      sentAt: 1_726_656_000_001,
      quotes: [],
    }
    const session = new FakeMarketDataServerSession({
      sendToClient: (message) => messages.push(message),
      createSubscriptionId: () => 'subscription-001',
      now: () => 1_726_656_000_000,
      createSimulator: (onMessage) => ({
        start: () => {
          start()
          onMessage(initialSnapshot)
        },
        stop,
      }),
    })

    return { messages, session, start, stop }
  }

  it('acknowledges a valid subscription before starting market data', () => {
    const { messages, session, start } = createHarness()

    session.receiveClientFrame(JSON.stringify(subscribeMessage))

    expect(start).toHaveBeenCalledOnce()
    expect(messages.map((message) => message.type)).toEqual([
      'subscription_ack',
      'price_snapshot',
    ])
    expect(messages[0]).toEqual({
      type: 'subscription_ack',
      schemaVersion: 1,
      requestId: 'request-001',
      subscriptionId: 'subscription-001',
      instruments: ['EUR/USD'],
      sentAt: 1_726_656_000_000,
    })
  })

  it('does not start a duplicate simulator for repeated subscriptions', () => {
    const { messages, session, start } = createHarness()
    session.receiveClientFrame(JSON.stringify(subscribeMessage))
    session.receiveClientFrame(
      JSON.stringify({ ...subscribeMessage, requestId: 'request-002' }),
    )

    expect(start).toHaveBeenCalledOnce()
    expect(messages.filter((message) => message.type === 'subscription_ack')).toHaveLength(2)
    expect(
      messages
        .filter((message) => message.type === 'subscription_ack')
        .map((message) => message.subscriptionId),
    ).toEqual(['subscription-001', 'subscription-001'])
  })

  it.each([
    ['malformed JSON', '{bad json'],
    ['unknown instrument', JSON.stringify({ ...subscribeMessage, instruments: ['GBP/USD'] })],
    ['empty instruments', JSON.stringify({ ...subscribeMessage, instruments: [] })],
  ])('ignores %s without starting market data', (_description, frame) => {
    const { messages, session, start } = createHarness()

    session.receiveClientFrame(frame)

    expect(messages).toHaveLength(0)
    expect(start).not.toHaveBeenCalled()
  })

  it('stops the simulator and ignores frames after the session closes', () => {
    const { messages, session, stop } = createHarness()
    session.receiveClientFrame(JSON.stringify(subscribeMessage))
    session.close()
    const messageCountAfterClose = messages.length

    session.receiveClientFrame(
      JSON.stringify({ ...subscribeMessage, requestId: 'request-after-close' }),
    )

    expect(stop).toHaveBeenCalledOnce()
    expect(messages).toHaveLength(messageCountAfterClose)
  })
})
