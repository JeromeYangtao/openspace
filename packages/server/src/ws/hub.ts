/**
 * WebSocket Hub — 按 channel 组织连接订阅，提供广播能力。
 *
 * 结构:
 *   channelSubscribers: Map<channelId, Set<WebSocket>>
 *   socketChannels:     WeakMap<WebSocket, Set<channelId>>  (便于 socket 断开时快速清理)
 */

import type { WebSocket } from 'ws';
import type { ServerEvent } from '@openspace/shared';

class WSHub {
  private sockets = new Set<WebSocket>();
  private channelSubs = new Map<string, Set<WebSocket>>();
  private socketSubs = new WeakMap<WebSocket, Set<string>>();
  private socketCount = 0;

  subscribe(socket: WebSocket, channelId: string): void {
    let subs = this.channelSubs.get(channelId);
    if (!subs) {
      subs = new Set();
      this.channelSubs.set(channelId, subs);
    }
    subs.add(socket);

    let chs = this.socketSubs.get(socket);
    if (!chs) {
      chs = new Set();
      this.socketSubs.set(socket, chs);
    }
    chs.add(channelId);
  }

  unsubscribe(socket: WebSocket, channelId: string): void {
    this.channelSubs.get(channelId)?.delete(socket);
    this.socketSubs.get(socket)?.delete(channelId);
  }

  /** 连接注册（仅用于统计与 disconnect 清理） */
  register(socket: WebSocket): void {
    this.socketCount += 1;
    this.sockets.add(socket);
    this.socketSubs.set(socket, new Set());
  }

  /** 连接断开时清理所有订阅 */
  dispose(socket: WebSocket): void {
    this.socketCount -= 1;
    this.sockets.delete(socket);
    const chs = this.socketSubs.get(socket);
    if (chs) {
      for (const ch of chs) {
        this.channelSubs.get(ch)?.delete(socket);
      }
      this.socketSubs.delete(socket);
    }
  }

  /** 向一个频道的所有订阅者广播 */
  broadcast(channelId: string, event: ServerEvent): void {
    const subs = this.channelSubs.get(channelId);
    if (!subs || subs.size === 0) return;
    const payload = JSON.stringify(event);
    for (const s of subs) {
      if (s.readyState === 1 /* OPEN */) {
        try {
          s.send(payload);
        } catch {
          // 忽略偶发 send 异常，下次 dispose 会清理
        }
      }
    }
  }

  /**
   * 向所有连接广播（D-21 Sprint C：跨 project 全局事件，
   * 如 inbox / knowledge 同步推送、project list 变化）。
   * 不同于 broadcast(channelId, ...)，本接口忽略订阅，向全部 socket 发。
   */
  broadcastGlobal(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const s of this.sockets) {
      if (s.readyState === 1) {
        try {
          s.send(payload);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** 向指定 socket 发送 */
  send(socket: WebSocket, event: ServerEvent): void {
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // ignore
    }
  }

  /** 诊断：当前订阅状态 */
  snapshot(): { sockets: number; channels: Record<string, number> } {
    const channels: Record<string, number> = {};
    for (const [ch, subs] of this.channelSubs) {
      channels[ch] = subs.size;
    }
    return { sockets: this.socketCount, channels };
  }
}

export const hub = new WSHub();
