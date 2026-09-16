import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { WSClient } from '../src/lib/ws.ts';

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  failSend = false;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor() {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
  }
  send(data: string) {
    if (this.failSend) throw new Error('network failure');
    this.sent.push(JSON.parse(data));
  }
  pong() {
    this.onmessage?.({ data: '{"type":"pong"}' });
  }
}

let client: WSClient;
let now: number;
let nextTimer: number;
let timers: Map<number, { at: number; callback: () => void }>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const originalNow = Date.now;
function replace(name: string, value: unknown) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
function advance(ms: number) {
  const end = now + ms;
  while (true) {
    const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at;
    timers.delete(next[0]);
    next[1].callback();
  }
  now = end;
}
function socket() {
  return FakeSocket.instances.at(-1)!;
}
const message = { type: 'send_message' as const, channel_id: 'channel', content: 'hello' };

beforeEach(() => {
  now = 1000;
  nextTimer = 0;
  timers = new Map();
  FakeSocket.instances = [];
  replace('WebSocket', FakeSocket);
  replace(
    'window',
    Object.assign(new EventTarget(), { location: { protocol: 'http:', host: 'localhost' } }),
  );
  replace('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  replace('setTimeout', (callback: () => void, ms: number) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + ms, callback });
    return id;
  });
  replace('clearTimeout', (id: number) => timers.delete(id));
  Date.now = () => now;
  client = new WSClient();
});
afterEach(() => {
  client.close();
  Date.now = originalNow;
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

test('silent OPEN connection times out and restores only current subscriptions', () => {
  client.send({ type: 'subscribe_channel', channel_id: 'channel' });
  socket().open();
  const old = socket();
  advance(20_000);
  assert.deepEqual(old.sent.at(-1), { type: 'ping' });
  advance(10_000);
  assert.equal(client.getStatus(), 'closed');
  assert.equal(client.send(message), false);
  const replacement = socket();
  replacement.open();
  assert.deepEqual(replacement.sent, [{ type: 'subscribe_channel', channel_id: 'channel' }]);
  old.onclose?.();
  old.onerror?.();
  old.onopen?.();
  assert.equal(client.getStatus(), 'open');
  advance(1000);
  assert.equal(FakeSocket.instances.length, 2);
});

test('pong keeps an idle connection alive', () => {
  client.connect();
  socket().open();
  for (let i = 0; i < 10; i++) {
    advance(20_000);
    socket().pong();
  }
  assert.equal(client.send(message), true);
  assert.equal(FakeSocket.instances.length, 1);
});

test('send after suspended timers rejects stale OPEN connection and preserves draft contract', () => {
  client.connect();
  socket().open();
  now += 60_000;
  assert.equal(client.send(message), false);
  assert.equal(socket().sent.length, 0);
  assert.equal(client.getStatus(), 'closed');
});

test('returning to visible page recovers stale connection', () => {
  client.connect();
  socket().open();
  now += 60_000;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(client.getStatus(), 'closed');
  advance(1000);
  assert.equal(FakeSocket.instances.length, 2);
});

test('hanging connection attempt times out', () => {
  client.connect();
  advance(11_000);
  assert.equal(FakeSocket.instances.length, 2);
});

test('send exception triggers recovery', () => {
  client.connect();
  socket().open();
  socket().failSend = true;
  assert.equal(client.send(message), false);
  advance(1000);
  assert.equal(FakeSocket.instances.length, 2);
});

test('explicit close cancels timers and resume listeners; old callbacks cannot close new connection', () => {
  client.connect();
  socket().open();
  const old = socket();
  client.close();
  window.dispatchEvent(new Event('online'));
  advance(60_000);
  assert.equal(FakeSocket.instances.length, 1);
  client.connect();
  socket().open();
  old.onclose?.();
  assert.equal(client.getStatus(), 'open');
});
