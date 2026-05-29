import { create } from 'zustand';
import type { Channel } from '@openspace/shared';
import { listChannels } from '../lib/api';

interface ChannelsState {
  channels: Channel[];
  loaded: boolean;
  refresh: () => Promise<void>;
  upsert: (channel: Channel) => void;
  remove: (id: string) => void;
}

export const useChannelsStore = create<ChannelsState>((set) => ({
  channels: [],
  loaded: false,
  refresh: async () => {
    const channels = await listChannels();
    set({ channels, loaded: true });
  },
  upsert: (channel) =>
    set((s) => {
      const idx = s.channels.findIndex((c) => c.id === channel.id);
      if (idx >= 0) {
        const next = [...s.channels];
        next[idx] = channel;
        return { channels: next };
      }
      return { channels: [...s.channels, channel] };
    }),
  remove: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),
}));
