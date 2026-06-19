/**
 * WebSocket 客户端封装
 *
 * - 单例连接
 * - 自动重连（指数退避）
 * - 事件分发（基于 event.type 订阅）
 */

import type { ClientEvent, ServerEvent } from '@openspace/shared';

type Handler = (event: ServerEvent) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: 'connecting' | 'open' | 'closed' = 'closed';
  private statusListeners = new Set<(s: 'connecting' | 'open' | 'closed') => void>();
  private channelSubscriptions = new Set<string>();
  private reconnectEnabled = true;

  connect(): void {
    this.reconnectEnabled = true;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.setStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
      this.restoreSubscriptions();
    };

    ws.onclose = () => {
      this.setStatus('closed');
      if (this.reconnectEnabled) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // close 会紧随 error，交给 close 处理
    };

    ws.onmessage = (ev) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(ev.data as string) as ServerEvent;
      } catch {
        return;
      }
      for (const h of this.handlers) {
        try {
          h(event);
        } catch (e) {
          console.error('ws handler error', e);
        }
      }
    };
  }

  send(event: ClientEvent): boolean {
    if (event.type === 'subscribe_channel') {
      this.channelSubscriptions.add(event.channel_id);
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.connect();
        return true;
      }
      return this.sendNow(event);
    }

    if (event.type === 'unsubscribe_channel') {
      this.channelSubscriptions.delete(event.channel_id);
      if (this.ws?.readyState !== WebSocket.OPEN) return true;
      return this.sendNow(event);
    }

    if (event.type === 'send_message' && this.ws?.readyState !== WebSocket.OPEN) {
      this.connect();
      return false;
    }

    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    return this.sendNow(event);
  }

  private sendNow(event: ClientEvent): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  }

  private restoreSubscriptions() {
    for (const channelId of this.channelSubscriptions) {
      this.sendNow({ type: 'subscribe_channel', channel_id: channelId });
    }
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(listener: (s: 'connecting' | 'open' | 'closed') => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus() {
    return this.status;
  }

  private setStatus(s: 'connecting' | 'open' | 'closed') {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private scheduleReconnect() {
    if (!this.reconnectEnabled) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  close(opts: { reconnect?: boolean } = {}) {
    this.reconnectEnabled = opts.reconnect ?? false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }
}

export const wsClient = new WSClient();
