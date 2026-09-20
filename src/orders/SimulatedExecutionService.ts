import { OrderStore } from './OrderStore'
import type { AcknowledgedOrder, OrderRequest } from './types'

export type SimulatedExecutionServiceOptions = Readonly<{
  store: OrderStore
  acknowledgementDelayMs?: number
  completionDelayMs?: number
  venueRejectionProbability?: number
  random?: () => number
  now?: () => number
  createExecutionOrderId?: () => string
  resolveFillPrice?: (order: AcknowledgedOrder) => number
}>

/** A deterministic, injectable stand-in for an asynchronous execution API. */
export class SimulatedExecutionService {
  private readonly store: OrderStore
  private readonly acknowledgementDelayMs: number
  private readonly completionDelayMs: number
  private readonly venueRejectionProbability: number
  private readonly random: () => number
  private readonly now: () => number
  private readonly createExecutionOrderId: () => string
  private readonly resolveFillPrice: (order: AcknowledgedOrder) => number
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor({
    store,
    acknowledgementDelayMs = 150,
    completionDelayMs = 350,
    venueRejectionProbability = 0.15,
    random = Math.random,
    now = Date.now,
    createExecutionOrderId = () => `execution-${crypto.randomUUID()}`,
    resolveFillPrice = (order) => order.quote.price,
  }: SimulatedExecutionServiceOptions) {
    assertNonNegativeDelay(acknowledgementDelayMs, 'acknowledgementDelayMs')
    assertNonNegativeDelay(completionDelayMs, 'completionDelayMs')
    if (
      !Number.isFinite(venueRejectionProbability) ||
      venueRejectionProbability < 0 ||
      venueRejectionProbability > 1
    ) {
      throw new RangeError('venueRejectionProbability must be between 0 and 1.')
    }

    this.store = store
    this.acknowledgementDelayMs = acknowledgementDelayMs
    this.completionDelayMs = completionDelayMs
    this.venueRejectionProbability = venueRejectionProbability
    this.random = random
    this.now = now
    this.createExecutionOrderId = createExecutionOrderId
    this.resolveFillPrice = resolveFillPrice
  }

  submit(request: OrderRequest): void {
    if (this.disposed) throw new Error('The execution service has been disposed.')

    this.store.add(request)
    this.schedule(
      () => this.acknowledge(request.clientOrderId),
      this.acknowledgementDelayMs,
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }

  private acknowledge(clientOrderId: string): void {
    const order = this.store.getOrder(clientOrderId)
    if (!order || order.status !== 'pending') return

    this.store.apply({
      type: 'order_acknowledged',
      clientOrderId,
      executionOrderId: this.createExecutionOrderId(),
      occurredAt: this.now(),
    })
    this.schedule(() => this.complete(clientOrderId), this.completionDelayMs)
  }

  private complete(clientOrderId: string): void {
    const order = this.store.getOrder(clientOrderId)
    if (!order || order.status !== 'acknowledged') return

    if (this.nextRandom() < this.venueRejectionProbability) {
      this.store.apply({
        type: 'order_rejected',
        clientOrderId,
        reason: 'venue_rejected',
        message: 'The simulated venue rejected the order.',
        occurredAt: this.now(),
      })
      return
    }

    this.store.apply({
      type: 'order_filled',
      clientOrderId,
      fillPrice: this.resolveFillPrice(order),
      filledQuantityInBaseCurrency: order.quantityInBaseCurrency,
      occurredAt: this.now(),
    })
  }

  private schedule(callback: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      callback()
    }, delayMs)
    this.timers.add(timer)
  }

  private nextRandom(): number {
    const sample = this.random()
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('The random source must return values in [0, 1).')
    }
    return sample
  }
}

function assertNonNegativeDelay(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`)
  }
}
