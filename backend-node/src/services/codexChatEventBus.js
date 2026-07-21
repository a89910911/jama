const { EventEmitter } = require('events');

class CodexChatEventBus {
  constructor(options = {}) {
    this.emitter = new EventEmitter();
    this.buffers = new Map();
    this.maxEvents = options.maxEvents || 200;
    this.nextId = 1;
  }

  publish(sessionId, type, data = {}) {
    const event = {
      id: this.nextId++,
      session_id: String(sessionId),
      type,
      data,
      created_at: new Date().toISOString(),
    };
    const key = String(sessionId);
    const buffer = this.buffers.get(key) || [];
    buffer.push(event);
    if (buffer.length > this.maxEvents) buffer.splice(0, buffer.length - this.maxEvents);
    this.buffers.set(key, buffer);
    this.emitter.emit(key, event);
    return event;
  }

  listAfter(sessionId, afterId = 0) {
    return (this.buffers.get(String(sessionId)) || [])
      .filter((event) => Number(event.id) > Number(afterId || 0));
  }

  subscribe(sessionId, listener) {
    const key = String(sessionId);
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }
}

const codexChatEventBus = new CodexChatEventBus();

module.exports = { CodexChatEventBus, codexChatEventBus };
