import { transitionOrder, type OrderEvent } from './orderStateMachine'
import type { Order, OrderRequest, PendingOrder } from './types'

type Listener = () => void

export type OrderStoreSnapshot = Readonly<{
  version: number
  orders: readonly Order[]
  changedOrders: readonly Order[]
}>

const EMPTY_SNAPSHOT: OrderStoreSnapshot = {
  version: 0,
  orders: [],
  changedOrders: [],
}

/** In-memory source of truth for the complete order lifecycle. */
export class OrderStore {
  private readonly listeners = new Set<Listener>()
  private readonly ordersById = new Map<string, Order>()
  private readonly orderIdsNewestFirst: string[] = []
  private currentSnapshot = EMPTY_SNAPSHOT

  getSnapshot = (): OrderStoreSnapshot => this.currentSnapshot

  getOrder(clientOrderId: string): Order | undefined {
    return this.ordersById.get(clientOrderId)
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  add(request: OrderRequest): PendingOrder {
    if (request.clientOrderId.trim().length === 0) {
      throw new TypeError('clientOrderId cannot be empty.')
    }
    if (this.ordersById.has(request.clientOrderId)) {
      throw new Error(`Order ${request.clientOrderId} already exists.`)
    }

    const order: PendingOrder = { ...request, status: 'pending' }
    this.ordersById.set(order.clientOrderId, order)
    this.orderIdsNewestFirst.unshift(order.clientOrderId)
    this.publish(order)
    return order
  }

  apply(event: OrderEvent): Order {
    const currentOrder = this.ordersById.get(event.clientOrderId)
    if (!currentOrder) {
      throw new Error(`Order ${event.clientOrderId} does not exist.`)
    }

    const nextOrder = transitionOrder(currentOrder, event)
    this.ordersById.set(nextOrder.clientOrderId, nextOrder)
    this.publish(nextOrder)
    return nextOrder
  }

  private publish(changedOrder: Order): void {
    this.currentSnapshot = {
      version: this.currentSnapshot.version + 1,
      orders: this.orderIdsNewestFirst.map(
        (clientOrderId) => this.ordersById.get(clientOrderId)!,
      ),
      changedOrders: [changedOrder],
    }
    this.listeners.forEach((listener) => listener())
  }
}
