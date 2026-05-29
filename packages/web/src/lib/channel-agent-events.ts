const CHANNEL_AGENTS_CHANGED = 'openspace:channel-agents-changed';

export function notifyChannelAgentsChanged(channelId: string): void {
  window.dispatchEvent(
    new CustomEvent<{ channelId: string }>(CHANNEL_AGENTS_CHANGED, {
      detail: { channelId },
    }),
  );
}

export function onChannelAgentsChanged(
  channelId: string,
  callback: () => void,
): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<{ channelId?: string }>;
    if (custom.detail?.channelId === channelId) callback();
  };

  window.addEventListener(CHANNEL_AGENTS_CHANGED, handler);
  return () => window.removeEventListener(CHANNEL_AGENTS_CHANGED, handler);
}
