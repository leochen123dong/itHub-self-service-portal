import { getChat } from './chatStore.js';

export type Rating = 'up' | 'down';

export interface RatingRecord {
  chatId: string;
  msgIndex: number;
  rating: Rating;
  userId: number;
  userName: string;
  at: number;
}

// One record per (chatId, msgIndex). Re-rating overwrites the previous value.
const ratings = new Map<string, RatingRecord>();

function key(chatId: string, msgIndex: number): string {
  return `${chatId}:${msgIndex}`;
}

export interface RateMessageInput {
  chatId: string;
  msgIndex: number;
  rating: Rating;
  userId: number;
  userName: string;
}

export function rateMessage(input: RateMessageInput): RatingRecord {
  const record: RatingRecord = {
    chatId: input.chatId,
    msgIndex: input.msgIndex,
    rating: input.rating,
    userId: input.userId,
    userName: input.userName,
    at: Date.now(),
  };
  ratings.set(key(input.chatId, input.msgIndex), record);
  return record;
}

export function getMessageRating(chatId: string, msgIndex: number): Rating | null {
  return ratings.get(key(chatId, msgIndex))?.rating ?? null;
}

export function getChatRatings(chatId: string): Record<number, Rating> {
  const out: Record<number, Rating> = {};
  for (const r of ratings.values()) {
    if (r.chatId === chatId) out[r.msgIndex] = r.rating;
  }
  return out;
}

export function listAllRatings(): RatingRecord[] {
  return Array.from(ratings.values()).sort((a, b) => b.at - a.at);
}

export interface AdminStats {
  total: number;
  up: number;
  down: number;
  rate: number;
  recentRatings: Array<{
    chatId: string;
    msgIndex: number;
    rating: Rating;
    at: number;
    userName: string;
  }>;
  topDown: Array<{
    chatId: string;
    msgIndex: number;
    content: string;
    userName: string;
    at: number;
  }>;
}

export function getStats(): AdminStats {
  const all = listAllRatings();
  const up = all.filter((r) => r.rating === 'up').length;
  const down = all.length - up;
  const rate = all.length === 0 ? 0 : up / all.length;

  const recentRatings = all.slice(0, 20).map((r) => ({
    chatId: r.chatId,
    msgIndex: r.msgIndex,
    rating: r.rating,
    at: r.at,
    userName: r.userName,
  }));

  // Top-down: pick the most recent 5 distinct 👎 messages with content joined
  // from the live chat store.
  const seen = new Set<string>();
  const topDown: AdminStats['topDown'] = [];
  for (const r of all) {
    if (r.rating !== 'down') continue;
    const k = key(r.chatId, r.msgIndex);
    if (seen.has(k)) continue;
    seen.add(k);
    const chat = getChat(r.chatId);
    const content = chat?.messages?.[r.msgIndex]?.content ?? '';
    topDown.push({
      chatId: r.chatId,
      msgIndex: r.msgIndex,
      content: content.length > 120 ? content.slice(0, 120) + '…' : content,
      userName: r.userName,
      at: r.at,
    });
    if (topDown.length >= 5) break;
  }

  return { total: all.length, up, down, rate, recentRatings, topDown };
}