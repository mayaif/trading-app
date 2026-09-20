import type { MarketDataMessage, ServerMessage } from './types'

export type StreamProcessorState =
  | 'awaiting_ack'
  | 'awaiting_snapshot'
  | 'live'
  | 'out_of_sync'

export type AcceptedResult = {
  readonly status: 'accepted'
  readonly message: ServerMessage
}

export type IgnoredResult = {
  readonly status: 'ignored'
  readonly reason:
    | 'unexpected_acknowledgement'
    | 'duplicate_or_old_sequence'
    | 'different_stream'
    | 'out_of_sync'
}

export type GapResult = {
  readonly status: 'gap'
  readonly streamId: string
  readonly expectedSequence: number
  readonly receivedSequence: number
}

export type ProtocolErrorResult = {
  readonly status: 'protocol_error'
  readonly reason: 'data_before_snapshot' | 'unexpected_snapshot'
}

export type ProcessingResult =
  | AcceptedResult
  | IgnoredResult
  | GapResult
  | ProtocolErrorResult

/**
 * Enforces the client-side ordering rules for one market-data subscription.
 *
 * The processor deliberately does not store quotes. It only decides whether a
 * decoded message is safe for a downstream store to apply.
 */
export class MarketDataStreamProcessor {
  private expectedRequestId: string
  private currentState: StreamProcessorState = 'awaiting_ack'
  private currentSubscriptionId: string | undefined
  private currentStreamId: string | undefined
  private currentSequence: number | undefined

  constructor(expectedRequestId: string) {
    assertNonEmptyId(expectedRequestId, 'expectedRequestId')
    this.expectedRequestId = expectedRequestId
  }

  get state(): StreamProcessorState {
    return this.currentState
  }

  get subscriptionId(): string | undefined {
    return this.currentSubscriptionId
  }

  get streamId(): string | undefined {
    return this.currentStreamId
  }

  get lastSequence(): number | undefined {
    return this.currentSequence
  }

  /** Prepares this instance for a new subscription attempt after reconnect. */
  reset(expectedRequestId: string): void {
    assertNonEmptyId(expectedRequestId, 'expectedRequestId')
    this.expectedRequestId = expectedRequestId
    this.currentState = 'awaiting_ack'
    this.currentSubscriptionId = undefined
    this.currentStreamId = undefined
    this.currentSequence = undefined
  }

  process(message: ServerMessage): ProcessingResult {
    if (message.type === 'subscription_ack') {
      return this.processAcknowledgement(message)
    }

    if (message.type === 'price_snapshot') {
      return this.processSnapshot(message)
    }

    return this.processSequencedMessage(message)
  }

  private processAcknowledgement(
    message: Extract<ServerMessage, { type: 'subscription_ack' }>,
  ): ProcessingResult {
    if (
      this.currentState !== 'awaiting_ack' ||
      message.requestId !== this.expectedRequestId
    ) {
      return { status: 'ignored', reason: 'unexpected_acknowledgement' }
    }

    this.currentSubscriptionId = message.subscriptionId
    this.currentState = 'awaiting_snapshot'
    return { status: 'accepted', message }
  }

  private processSnapshot(
    message: Extract<MarketDataMessage, { type: 'price_snapshot' }>,
  ): ProcessingResult {
    if (
      this.currentState !== 'awaiting_snapshot' &&
      this.currentState !== 'out_of_sync'
    ) {
      return { status: 'protocol_error', reason: 'unexpected_snapshot' }
    }

    this.currentStreamId = message.streamId
    this.currentSequence = message.sequence
    this.currentState = 'live'
    return { status: 'accepted', message }
  }

  private processSequencedMessage(
    message: Extract<MarketDataMessage, { type: 'price_update' | 'heartbeat' }>,
  ): ProcessingResult {
    if (
      this.currentState === 'awaiting_ack' ||
      this.currentState === 'awaiting_snapshot'
    ) {
      return { status: 'protocol_error', reason: 'data_before_snapshot' }
    }

    if (this.currentState === 'out_of_sync') {
      return { status: 'ignored', reason: 'out_of_sync' }
    }

    if (message.streamId !== this.currentStreamId) {
      return { status: 'ignored', reason: 'different_stream' }
    }

    // LIVE always has a sequence because only a snapshot can enter this state.
    const expectedSequence = this.currentSequence! + 1

    if (message.sequence < expectedSequence) {
      return { status: 'ignored', reason: 'duplicate_or_old_sequence' }
    }

    if (message.sequence > expectedSequence) {
      this.currentState = 'out_of_sync'
      return {
        status: 'gap',
        streamId: message.streamId,
        expectedSequence,
        receivedSequence: message.sequence,
      }
    }

    this.currentSequence = message.sequence
    return { status: 'accepted', message }
  }
}

function assertNonEmptyId(value: string, name: string): void {
  if (value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string.`)
  }
}
