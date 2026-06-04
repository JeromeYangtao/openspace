import type { Database } from 'better-sqlite3';
import { channelRepo, userChannelRepo } from '../db/repos.js';
import type { AuthUser } from './session.js';

export function canAccessChannel(db: Database, channelId: string, user: AuthUser): boolean {
  if (user.role === 'admin') return true;
  const channel = channelRepo.getById(db, channelId);
  if (!channel) return false;
  if (channel.name === 'general' && channel.type === 'channel') return true;
  return userChannelRepo.hasUser(db, channelId, user.id);
}

export function canManageChannel(db: Database, channelId: string, user: AuthUser): boolean {
  if (user.role === 'admin') return true;
  return userChannelRepo.hasUser(db, channelId, user.id);
}

export function visibleChannelsForUser(db: Database, user: AuthUser) {
  const channels = channelRepo.list(db);
  if (user.role === 'admin') return channels;
  return channels.filter(
    (channel) =>
      (channel.name === 'general' && channel.type === 'channel') ||
      userChannelRepo.hasUser(db, channel.id, user.id),
  );
}
