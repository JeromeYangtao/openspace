import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRecoverableCodexErrorNotification,
  shouldDisposeIdleCodexAppServerClient,
} from '../src/agents/codex-app-server-adapter.js';
import { isFatalErrorEvent } from '../src/agents/error-classification.js';
import type { CLIEvent } from '../src/agents/types.js';

test('classifies Codex willRetry errors as recoverable', () => {
  assert.equal(
    isRecoverableCodexErrorNotification({
      willRetry: true,
      error: { message: 'upstream disconnected' },
      threadId: 'thread',
      turnId: 'turn',
    }),
    true,
  );
});

test('does not classify Codex non-retry errors as recoverable', () => {
  assert.equal(
    isRecoverableCodexErrorNotification({
      willRetry: false,
      error: { message: 'retry limit reached' },
      threadId: 'thread',
      turnId: 'turn',
    }),
    false,
  );
});

test('engine fatal error classifier ignores recoverable errors', () => {
  const recoverable: CLIEvent = {
    type: 'error',
    message: 'upstream reconnecting',
    code: 'codex_app_server_error',
    recoverable: true,
  };
  const warningStyle: CLIEvent = {
    type: 'error',
    message: 'warning',
    fatal: false,
  };
  const fatal: CLIEvent = {
    type: 'error',
    message: 'retry exhausted',
    code: 'codex_app_server_error',
  };

  assert.equal(isFatalErrorEvent(recoverable), false);
  assert.equal(isFatalErrorEvent(warningStyle), false);
  assert.equal(isFatalErrorEvent(fatal), true);
});

test('idle Codex app-server clients are disposable only when truly idle', () => {
  assert.equal(
    shouldDisposeIdleCodexAppServerClient({
      disposed: false,
      activeTurn: false,
      pendingRequests: 0,
      hasChild: true,
      timerGeneration: 1,
      currentGeneration: 1,
    }),
    true,
  );

  assert.equal(
    shouldDisposeIdleCodexAppServerClient({
      disposed: false,
      activeTurn: true,
      pendingRequests: 0,
      hasChild: true,
      timerGeneration: 1,
      currentGeneration: 1,
    }),
    false,
  );

  assert.equal(
    shouldDisposeIdleCodexAppServerClient({
      disposed: false,
      activeTurn: false,
      pendingRequests: 1,
      hasChild: true,
      timerGeneration: 1,
      currentGeneration: 1,
    }),
    false,
  );

  assert.equal(
    shouldDisposeIdleCodexAppServerClient({
      disposed: false,
      activeTurn: false,
      pendingRequests: 0,
      hasChild: true,
      timerGeneration: 1,
      currentGeneration: 2,
    }),
    false,
  );
});
