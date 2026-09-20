import { decodeClientMessage } from './decodeClientMessage'
import {
  MarketDataSimulator,
  type MarketDataSimulatorOptions,
} from './MarketDataSimulator'
import type {
  CurrencyPair,
  MarketDataMessage,
  ServerMessage,
  SubscriptionAckMessage,
} from './types'

export type SimulatorControl = Pick<MarketDataSimulator, 'start' | 'stop'>

export type FakeMarketDataServerSessionOptions = {
  readonly sendToClient: (message: ServerMessage) => void
  readonly simulatorOptions?: Omit<MarketDataSimulatorOptions, 'onMessage'>
  readonly createSimulator?: (
    onMessage: (message: MarketDataMessage) => void,
  ) => SimulatorControl
  readonly createSubscriptionId?: () => string
  readonly now?: () => number
}

/** Owns server-side protocol and subscription state for one socket connection. */
export class FakeMarketDataServerSession {
  private readonly sendToClient: (message: ServerMessage) => void
  private readonly createSimulator: (
    onMessage: (message: MarketDataMessage) => void,
  ) => SimulatorControl
  private readonly createSubscriptionId: () => string
  private readonly now: () => number

  private simulator: SimulatorControl | undefined
  private closed = false
  private subscription:
    | { readonly id: string; readonly instruments: readonly CurrencyPair[] }
    | undefined

  constructor({
    sendToClient,
    simulatorOptions,
    createSimulator,
    createSubscriptionId = () => `subscription-${crypto.randomUUID()}`,
    now = Date.now,
  }: FakeMarketDataServerSessionOptions) {
    this.sendToClient = sendToClient
    this.createSubscriptionId = createSubscriptionId
    this.now = now
    this.createSimulator =
      createSimulator ??
      ((onMessage) =>
        new MarketDataSimulator({
          ...simulatorOptions,
          onMessage,
        }))
  }

  receiveClientFrame(rawFrame: string): void {
    if (this.closed) return

    const result = decodeClientMessage(rawFrame)
    if (!result.ok) return

    const { requestId, instruments } = result.message

    if (!this.subscription) {
      this.subscription = {
        id: this.createSubscriptionId(),
        instruments: [...instruments],
      }
    }

    const acknowledgement: SubscriptionAckMessage = {
      type: 'subscription_ack',
      schemaVersion: 1,
      requestId,
      subscriptionId: this.subscription.id,
      instruments: this.subscription.instruments,
      sentAt: this.now(),
    }

    // Acknowledgement must be observable before the synchronous initial
    // snapshot emitted by simulator.start().
    this.sendToClient(acknowledgement)

    if (!this.simulator) {
      this.simulator = this.createSimulator(this.sendToClient)
      this.simulator.start()
    }
  }

  close(): void {
    if (this.closed) return

    this.closed = true
    this.simulator?.stop()
    this.simulator = undefined
    this.subscription = undefined
  }
}
