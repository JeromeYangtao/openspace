/**
 * WebSocket 客户端封装
 *
 * - 单例连接
 * - 自动重连（指数退避）
 * - 事件分发（基于 event.type 订阅）
 */

import type { ClientEvent, ServerEvent } from '@openspace/shared';

type Handler = (event: ServerEvent) => void;

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const CONNECTION_TIMEOUT_MS = 10_000;

export class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: 'connecting' | 'open' | 'closed' = 'closed';
  private statusListeners = new Set<(s: 'connecting' | 'open' | 'closed') => void>();
  private channelSubscriptions = new Set<string>();
  private reconnectEnabled = true;

  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private lastVerifiedAt = 0;
  private awaitingPong = false;
  private listeningForResume = false;

  private onResume = () => {
    if (document.visibilityState === 'hidden' || !this.reconnectEnabled) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (!this.isFresh()) this.recover(this.ws);
      else if (!this.awaitingPong) this.ping(this.ws);
    } else if (this.ws) {
      this.recover(this.ws);
    } else {
      this.connect();
    }
  };

  connect(): void {
    this.reconnectEnabled = true;
    if (!this.listeningForResume) {
      window.addEventListener('online', this.onResume);
      window.addEventListener('pageshow', this.onResume);
      document.addEventListener('visibilitychange', this.onResume);
      this.listeningForResume = true;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearHealthTimer();
    this.setStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.healthTimer = setTimeout(() => this.recover(ws), CONNECTION_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.lastVerifiedAt = Date.now();
      this.awaitingPong = false;
      this.scheduleHeartbeat(ws);
      this.reconnectAttempts = 0;
      this.setStatus('open');
      this.restoreSubscriptions();
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearHealthTimer();
      this.setStatus('closed');
      if (this.reconnectEnabled) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      this.recover(ws);
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let event: ServerEvent;
      try {
        event = JSON.parse(ev.data as string) as ServerEvent;
      } catch {
        return;
      }
      if (event.type === 'pong' && this.awaitingPong) {
        this.lastVerifiedAt = Date.now();
        this.awaitingPong = false;
        this.scheduleHeartbeat(ws);
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

  private isFresh(): boolean {
    return Date.now() - this.lastVerifiedAt < HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS;
  }

  private clearHealthTimer() {
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = null;
  }

  private scheduleHeartbeat(ws: WebSocket) {
    this.clearHealthTimer();
    this.healthTimer = setTimeout(() => this.ping(ws), HEARTBEAT_INTERVAL_MS);
  }

  private ping(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.clearHealthTimer();
    this.awaitingPong = true;
    this.healthTimer = setTimeout(() => this.recover(ws), HEARTBEAT_TIMEOUT_MS);
    this.sendNow({ type: 'ping' });
  }

  private recover(ws: WebSocket) {
    if (this.ws !== ws) return;
    // Detach first: a late close/error from this socket must not affect its replacement.
    this.ws = null;
    this.clearHealthTimer();
    this.awaitingPong = false;
    ws.close();
    this.setStatus('closed');
    this.scheduleReconnect();
  }

  private sendNow(event: ClientEvent): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    const ws = this.ws;
    // Timers may be suspended while the tab or computer sleeps. Check here too,
    // so a stale OPEN socket does not make the composer discard the draft.
    if (event.type === 'send_message' && !this.isFresh()) {
      this.recover(ws);
      return false;
    }
    try {
      ws.send(JSON.stringify(event));
      return true;
    } catch {
      this.recover(ws);
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
    this.clearHealthTimer();
    window.removeEventListener('online', this.onResume);
    window.removeEventListener('pageshow', this.onResume);
    document.removeEventListener('visibilitychange', this.onResume);
    this.listeningForResume = false;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus('closed');
    if (this.reconnectEnabled) this.scheduleReconnect();
  }
}

export const wsClient = new WSClient();
