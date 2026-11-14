import { createHash } from 'node:crypto';
import type { Answers, PublicProfile, PublicUser } from '@pramansetu/shared';
import type { UserDoc } from './store';

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalisePhone(value: string): string {
  return value
    .replace(/\D/g, '')
    .replace(/^91(?=\d{10}$)/, '')
    .slice(-10);
}

export function maskPhone(phone?: string): string {
  if (!phone) return '';
  if (phone.length < 4) return '••••';
  return `${'•'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

export function maskEmail(email?: string): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return '••••';
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** IPs are stored only as a salted hash, for abuse investigation. */
export function hashIp(ip: string | undefined, salt: string): string {
  return createHash('sha256')
    .update(`${salt}:${ip ?? 'unknown'}`)
    .digest('hex')
    .slice(0, 32);
}

export function publicProfile(profile: PublicProfile): PublicProfile {
  return {
    id: profile.id,
    nickname: profile.nickname,
    relation: profile.relation,
    avatarColor: profile.avatarColor,
    answers: profile.answers as Answers,
    notSure: profile.notSure,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function publicUser(user: UserDoc): PublicUser {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    language: user.language,
    role: user.role,
    status: user.status ?? 'active',
    mfaEnabled: Boolean(user.mfaSecret && user.mfaEnrolledAt),
    profiles: user.profiles.map(publicProfile),
    notificationPrefs: user.notificationPrefs,
    speechPrefs: user.speechPrefs,
    createdAt: user.createdAt,
  };
}

export function identifierOf(input: { phone?: string; email?: string }): {
  identifier: string;
  channel: 'phone' | 'email';
} {
  if (input.phone) return { identifier: normalisePhone(input.phone), channel: 'phone' };
  return { identifier: (input.email ?? '').toLowerCase().trim(), channel: 'email' };
}

export interface DiffEntryLike {
  field: string;
  before: unknown;
  after: unknown;
}

/** Top-level field diff with stable ordering. */
export function diffObjects(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): DiffEntryLike[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const ignored = new Set(['id', 'version', 'updatedAt', 'createdAt']);
  const diff: DiffEntryLike[] = [];
  for (const key of [...keys].sort()) {
    if (ignored.has(key)) continue;
    const previous = before?.[key];
    const next = after?.[key];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    diff.push({ field: key, before: previous, after: next });
  }
  return diff;
}

export function pick<T extends object>(source: T, keys: Array<keyof T>): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
