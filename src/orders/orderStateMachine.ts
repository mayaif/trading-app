import type {
  AcknowledgedOrder,
  FilledOrder,
  Order,
  OrderRejectionReason,
  RejectedOrder,
} from './types'

export type OrderEvent =
  | Readonly<{
      type: 'order_acknowledged'
      clientOrderId: string
      executionOrderId: string
      occurredAt: number
    }>
  | Readonly<{
      type: 'order_filled'
      clientOrderId: string
      fillPrice: number
      filledQuantityInBaseCurrency: number
      occurredAt: number
    }>
  | Readonly<{
      type: 'order_rejected'
      clientOrderId: string
      reason: OrderRejectionReason
      message: string
      occurredAt: number
    }>

/** Applies one execution event while enforcing the permitted lifecycle. */
export function transitionOrder(order: Order, event: OrderEvent): Order {
  if (event.clientOrderId !== order.clientOrderId) {
    throw new Error('The execution event belongs to a different order.')
  }

  switch (order.status) {
    case 'pending':
      if (event.type === 'order_acknowledged') {
        assertNonEmpty(event.executionOrderId, 'executionOrderId')
        assertTimestamp(event.occurredAt, order.submittedAt)
        const acknowledged: AcknowledgedOrder = {
          ...order,
          status: 'acknowledged',
          executionOrderId: event.executionOrderId,
          acknowledgedAt: event.occurredAt,
        }
        return acknowledged
      }

      if (event.type === 'order_rejected') {
        assertRejection(event.message, event.occurredAt, order.submittedAt)
        const rejected: RejectedOrder = {
          ...order,
          status: 'rejected',
          rejectionStage: 'pre_acknowledgement',
          rejectedAt: event.occurredAt,
          rejectionReason: event.reason,
          rejectionMessage: event.message,
        }
        return rejected
      }
      break

    case 'acknowledged':
      if (event.type === 'order_filled') {
        assertPositive(event.fillPrice, 'fillPrice')
        assertPositive(
          event.filledQuantityInBaseCurrency,
          'filledQuantityInBaseCurrency',
        )
        if (event.filledQuantityInBaseCurrency !== order.quantityInBaseCurrency) {
          throw new Error('This demo supports full fills only.')
        }
        assertTimestamp(event.occurredAt, order.acknowledgedAt)
        const filled: FilledOrder = {
          ...order,
          status: 'filled',
          filledAt: event.occurredAt,
          fillPrice: event.fillPrice,
          filledQuantityInBaseCurrency: event.filledQuantityInBaseCurrency,
        }
        return filled
      }

      if (event.type === 'order_rejected') {
        assertRejection(event.message, event.occurredAt, order.acknowledgedAt)
        const rejected: RejectedOrder = {
          ...order,
          status: 'rejected',
          rejectionStage: 'post_acknowledgement',
          executionOrderId: order.executionOrderId,
          acknowledgedAt: order.acknowledgedAt,
          rejectedAt: event.occurredAt,
          rejectionReason: event.reason,
          rejectionMessage: event.message,
        }
        return rejected
      }
      break

    case 'filled':
    case 'rejected':
      throw new Error(`Cannot transition a terminal ${order.status} order.`)
  }

  throw new Error(`Cannot apply ${event.type} to a ${order.status} order.`)
}

function assertRejection(
  message: string,
  occurredAt: number,
  earliestTime: number,
): void {
  assertNonEmpty(message, 'rejection message')
  assertTimestamp(occurredAt, earliestTime)
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new TypeError(`${name} cannot be empty.`)
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`)
  }
}

function assertTimestamp(value: number, earliestTime: number): void {
  if (!Number.isFinite(value) || value < earliestTime) {
    throw new RangeError('Order event timestamps must be chronological.')
  }
}
