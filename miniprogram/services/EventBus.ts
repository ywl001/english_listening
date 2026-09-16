import { AppEvent, EventPayloadMap } from "./event-type";

type EventHandler<T> = (payload: T) => void;

class EventBus {
  private handlers: {
    [K in AppEvent]?: Array<EventHandler<EventPayloadMap[K]>>;
  } = {};

  /**
   * Register an event handler
   * @param event The event to listen for
   * @param handler The handler function
   */
  on<K extends AppEvent>(
    event: K,
    handler: EventHandler<EventPayloadMap[K]>
  ): void {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    (this.handlers[event] as Array<EventHandler<EventPayloadMap[K]>>).push(handler);
  }

  /**
   * Unregister an event handler
   * @param event The event to remove listener from
   * @param handler The handler function to remove
   */
  off<K extends AppEvent>(
    event: K,
    handler: EventHandler<EventPayloadMap[K]>
  ): void {
    if (!this.handlers[event]) return;
    
    const index = (this.handlers[event] as Array<EventHandler<EventPayloadMap[K]>>)
      .indexOf(handler);
    
    if (index > -1) {
      (this.handlers[event] as Array<EventHandler<EventPayloadMap[K]>>).splice(index, 1);
    }
  }

  /**
   * Emit an event
   * @param event The event to emit
   * @param payload The payload to pass to handlers
   */
  emit<K extends AppEvent>(
    event: K,
    ...args: EventPayloadMap[K] extends void ? [] : [payload: EventPayloadMap[K]]
  ): void {
    if (!this.handlers[event]) return;
    
    const payload = args[0] as EventPayloadMap[K];
    (this.handlers[event] as Array<EventHandler<EventPayloadMap[K]>>)
      .forEach(handler => handler(payload));
  }
}
const eventBus = new EventBus()
export default eventBus