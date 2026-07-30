import type { CLIEvent } from './types.js';

export function isFatalErrorEvent(event: CLIEvent): event is Extract<CLIEvent, { type: 'error' }> {
  return event.type === 'error' && event.recoverable !== true && event.fatal !== false;
}
