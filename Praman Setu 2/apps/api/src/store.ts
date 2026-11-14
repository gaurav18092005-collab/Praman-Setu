import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import mongoose, { Schema } from 'mongoose';
import type {
  Answers,
  ApplicationRecord,
  Locale,
  LocalizedText,
  NotificationRecord,
  PublicProfile,
  Scheme,
} from '@pramansetu/shared';
import { config, isTest } from './config';
import { logger } from './logger';

export interface BaseDoc {
  id: string;
}

export type ProfileDoc = PublicProfile;

export type UserRole = 'user' | 'viewer' | 'editor' | 'admin' | 'superadmin';
export type UserStatus = 'active' | 'suspended';

export interface UserSpeechPrefs {
  speed: 0.8 | 1 | 1.2;
  autoReadQuestions: boolean;
}

export interface UserDoc extends BaseDoc {
  phone?: string;
  email?: string;
  name?: string;
  language: Locale;
  role: UserRole;
  status: UserStatus;
  /** Incremented on logout-all, role/status changes and account deletion. */
  tokenVersion: number;
  mfaSecret?: string | null;
  mfaRecoveryCodes?: string[];
  mfaEnrolledAt?: string | null;
  profiles: ProfileDoc[];
  notificationPrefs: {
    deadlines: boolean;
    schemeUpdates: boolean;
    documentNudges: boolean;
  };
  speechPrefs?: UserSpeechPrefs;
  createdAt: string;
  updatedAt: string;
}

export type SchemeDoc = Scheme;

export interface DiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

export interface SchemeVersionDoc extends BaseDoc {
  schemeId: string;
  version: number;
  snapshot: Scheme;
  changedBy: string;
  changedByName: string;
  changedAt: string;
  diff: DiffEntry[];
  changeNote: string;
}

export type ApplicationDoc = ApplicationRecord;

export type NotificationDoc = NotificationRecord;

/**
 * A refresh token is also a session. The collection keeps its historical name
 * (`refreshTokens`) so existing deployments migrate without a rename.
 */
export interface SessionDoc extends BaseDoc {
  userId: string;
  familyId: string;
  tokenVersion: number;
  tokenHash: string;
  /** True after the account has completed its second factor. */
  mfa: boolean;
  /** Last full OTP/MFA confirmation, used for admin step-up. */
  lastReauthAt: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  revokedAt?: string | null;
  replacedBy?: string | null;
  ipHash: string;
  userAgent: string;
}

export type OtpPurpose = 'login' | 'delete_account' | 'change_contact' | 'admin_stepup';

export interface OtpDoc extends BaseDoc {
  identifier: string;
  channel: 'phone' | 'email';
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: string;
  createdAt: string;
  attempts: number;
  consumedAt?: string | null;
  lastSentAt: string;
}

/** Per-key fixed-window counters, persisted across restarts and instances. */
export interface RateLimitDoc extends BaseDoc {
  key: string;
  windowStart: number;
  count: number;
  expiresAt: string;
}

/** Failed-code state that survives issuing a new code. */
export interface AuthAttemptDoc extends BaseDoc {
  identifier: string;
  failures: number;
  firstFailureAt: string;
  lockedUntil?: string | null;
  lockoutCount: number;
  updatedAt: string;
}

export interface OtpSendDoc extends BaseDoc {
  identifier: string;
  ipHash: string;
  purpose?: string;
  at: string;
}

export interface AuditDoc extends BaseDoc {
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  at: string;
  ipHash: string;
}

export interface TranslationDoc extends BaseDoc {
  locale: Locale;
  key: string;
  value: string;
  reviewed?: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface QuestionDoc extends BaseDoc {
  field: string;
  label: LocalizedText;
  helper: LocalizedText;
  order: number;
  updatedAt: string;
}

export interface CheckEventDoc extends BaseDoc {
  createdAt: string;
  answers: Answers;
  notSure: Record<string, boolean>;
  locale: Locale;
  eligibleSlugs: string[];
  needInfoSlugs: string[];
  notEligibleSlugs: string[];
  status: 'healthy' | 'empty';
  questionStep?: string;
}

export interface ContactDoc extends BaseDoc {
  name: string;
  contact: string;
  message: string;
  locale: Locale;
  createdAt: string;
  resolvedAt?: string | null;
}

export type Predicate<T> = (doc: T) => boolean;

export interface AtomicOperators {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: unknown;
  $gte?: unknown;
  $lt?: unknown;
  $lte?: unknown;
  $in?: unknown[];
}

export type AtomicFilter<T> = {
  [K in keyof T]?: T[K] | AtomicOperators;
};

function compareAtomicValues(actual: unknown, expected: unknown): number {
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() - expected.getTime();
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual < expected ? -1 : actual > expected ? 1 : 0;
  }
  return Number(actual) - Number(expected);
}

function matchesAtomic<T extends BaseDoc>(doc: T, filter: AtomicFilter<T>): boolean {
  return Object.entries(filter).every(([field, expected]) => {
    const actual = (doc as Record<string, unknown>)[field];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const operators = expected as AtomicOperators;
      if ('$eq' in operators) {
        const target = operators.$eq;
        if (target instanceof Date ? !(actual instanceof Date && actual.getTime() === target.getTime()) : actual !== target) {
          return false;
        }
      }
      if ('$ne' in operators) {
        const target = operators.$ne;
        if (target instanceof Date ? actual instanceof Date && actual.getTime() === target.getTime() : actual === target) {
          return false;
        }
      }
      if ('$gt' in operators && compareAtomicValues(actual, operators.$gt) <= 0) return false;
      if ('$gte' in operators && compareAtomicValues(actual, operators.$gte) < 0) return false;
      if ('$lt' in operators && compareAtomicValues(actual, operators.$lt) >= 0) return false;
      if ('$lte' in operators && compareAtomicValues(actual, operators.$lte) > 0) return false;
      if ('$in' in operators && !(operators.$in as unknown[]).includes(actual)) return false;
      return true;
    }
    return actual === expected;
  });
}

export interface Collection<T extends BaseDoc> {
  find(predicate?: Predicate<T>): Promise<T[]>;
  findOne(predicate: Predicate<T>): Promise<T | null>;
  get(id: string): Promise<T | null>;
  insert(doc: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  /** Compare-and-set: only patches a document that still matches the filter. */
  updateAtomic(filter: AtomicFilter<T>, patch: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  deleteWhere(predicate: Predicate<T>): Promise<number>;
  count(predicate?: Predicate<T>): Promise<number>;
}

export interface Store {
  kind: 'json' | 'mongo';
  users: Collection<UserDoc>;
  schemes: Collection<SchemeDoc>;
  schemeVersions: Collection<SchemeVersionDoc>;
  applications: Collection<ApplicationDoc>;
  notifications: Collection<NotificationDoc>;
  refreshTokens: Collection<SessionDoc>;
  otps: Collection<OtpDoc>;
  rateLimits: Collection<RateLimitDoc>;
  authAttempts: Collection<AuthAttemptDoc>;
  otpSends: Collection<OtpSendDoc>;
  auditLogs: Collection<AuditDoc>;
  translations: Collection<TranslationDoc>;
  questions: Collection<QuestionDoc>;
  checkEvents: Collection<CheckEventDoc>;
  contactMessages: Collection<ContactDoc>;
  close(): Promise<void>;
}

export function newId(): string {
  return randomUUID();
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class MemoryCollection<T extends BaseDoc> implements Collection<T> {
  constructor(
    private readonly items: T[],
    private readonly persist: () => Promise<void>,
  ) {}

  async find(predicate?: Predicate<T>): Promise<T[]> {
    const docs = predicate ? this.items.filter(predicate) : [...this.items];
    return docs.map((doc) => structuredClone(doc));
  }

  async findOne(predicate: Predicate<T>): Promise<T | null> {
    const doc = this.items.find(predicate);
    return doc ? structuredClone(doc) : null;
  }

  async get(id: string): Promise<T | null> {
    const doc = this.items.find((item) => item.id === id);
    return doc ? structuredClone(doc) : null;
  }

  async insert(doc: T): Promise<T> {
    this.items.push(structuredClone(doc));
    await this.persist();
    return structuredClone(doc);
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const updated = { ...this.items[index], ...structuredClone(patch), id } as T;
    this.items[index] = updated;
    await this.persist();
    return structuredClone(updated);
  }

  async updateAtomic(filter: AtomicFilter<T>, patch: Partial<T>): Promise<T | null> {
    // JavaScript runs this synchronous section to completion, so parallel
    // awaits cannot both match and patch the same document.
    const index = this.items.findIndex((item) => matchesAtomic(item, filter));
    if (index === -1) return null;
    const updated = { ...this.items[index], ...structuredClone(patch), id: this.items[index].id } as T;
    this.items[index] = updated;
    await this.persist();
    return structuredClone(updated);
  }

  async delete(id: string): Promise<boolean> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.items.splice(index, 1);
    await this.persist();
    return true;
  }

  async deleteWhere(predicate: Predicate<T>): Promise<number> {
    const before = this.items.length;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (predicate(this.items[index])) this.items.splice(index, 1);
    }
    const removed = before - this.items.length;
    if (removed) await this.persist();
    return removed;
  }

  async count(predicate?: Predicate<T>): Promise<number> {
    return predicate ? this.items.filter(predicate).length : this.items.length;
  }
}

type JsonData = Record<string, BaseDoc[]>;

class JsonStore implements Store {
  kind = 'json' as const;
  private data: JsonData = {};
  private writeQueue: Promise<void> = Promise.resolve();

  users!: Collection<UserDoc>;
  schemes!: Collection<SchemeDoc>;
  schemeVersions!: Collection<SchemeVersionDoc>;
  applications!: Collection<ApplicationDoc>;
  notifications!: Collection<NotificationDoc>;
  refreshTokens!: Collection<SessionDoc>;
  otps!: Collection<OtpDoc>;
  rateLimits!: Collection<RateLimitDoc>;
  authAttempts!: Collection<AuthAttemptDoc>;
  otpSends!: Collection<OtpSendDoc>;
  auditLogs!: Collection<AuditDoc>;
  translations!: Collection<TranslationDoc>;
  questions!: Collection<QuestionDoc>;
  checkEvents!: Collection<CheckEventDoc>;
  contactMessages!: Collection<ContactDoc>;

  constructor(private readonly file: string | null) {}

  static async create(file: string | null): Promise<JsonStore> {
    const store = new JsonStore(file);
    if (file) {
      try {
        const raw = await readFile(file, 'utf8');
        store.data = JSON.parse(raw) as JsonData;
      } catch {
        store.data = {};
      }
    }
    store.bindCollections();
    return store;
  }

  private bindCollections(): void {
    const bind = <T extends BaseDoc>(name: string): Collection<T> => {
      if (!this.data[name]) this.data[name] = [];
      return new MemoryCollection<T>(this.data[name] as T[], () => this.flush());
    };
    this.users = bind<UserDoc>('users');
    this.schemes = bind<SchemeDoc>('schemes');
    this.schemeVersions = bind<SchemeVersionDoc>('schemeVersions');
    this.applications = bind<ApplicationDoc>('applications');
    this.notifications = bind<NotificationDoc>('notifications');
    this.refreshTokens = bind<SessionDoc>('refreshTokens');
    this.otps = bind<OtpDoc>('otps');
    this.rateLimits = bind<RateLimitDoc>('rateLimits');
    this.authAttempts = bind<AuthAttemptDoc>('authAttempts');
    this.otpSends = bind<OtpSendDoc>('otpSends');
    this.auditLogs = bind<AuditDoc>('auditLogs');
    this.translations = bind<TranslationDoc>('translations');
    this.questions = bind<QuestionDoc>('questions');
    this.checkEvents = bind<CheckEventDoc>('checkEvents');
    this.contactMessages = bind<ContactDoc>('contactMessages');
  }

  private async flush(): Promise<void> {
    if (!this.file) return;
    const file = this.file;
    const payload = JSON.stringify(this.data);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      await writeFile(temp, payload, 'utf8');
      await rename(temp, file);
    });
    await this.writeQueue;
  }

  async close(): Promise<void> {
    await this.writeQueue;
  }
}

const modelSchemas: Record<string, Schema> = {};

function getModel(collection: string) {
  const modelName = `Praman_${collection}`;
  if (!mongoose.models[modelName]) {
    if (!modelSchemas[collection]) {
      const schema = new Schema(
        {
          id: { type: String, required: true, unique: true, index: true },
          ...(collection === 'authAttempts'
            ? { identifier: { type: String, required: true, unique: true, index: true } }
            : {}),
          ...(collection === 'refreshTokens'
            ? {
                userId: { type: String, index: true },
                tokenHash: { type: String, index: true },
                familyId: { type: String, index: true },
                expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
              }
            : {}),
          ...(collection === 'otps'
            ? {
                identifier: { type: String, index: true },
                expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
              }
            : {}),
          ...(collection === 'rateLimits'
            ? {
                key: { type: String, required: true, unique: true, index: true },
                expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
              }
            : {}),
          ...(collection === 'otpSends'
            ? { at: { type: Date, index: { expireAfterSeconds: 60 * 60 * 24 * 3 } } }
            : {}),
        },
        { strict: false, versionKey: false, collection },
      );
      modelSchemas[collection] = schema;
    }
    mongoose.model(modelName, modelSchemas[collection]);
  }
  return mongoose.model(modelName);
}

class MongoCollection<T extends BaseDoc> implements Collection<T> {
  constructor(private readonly collection: string) {}

  private model() {
    return getModel(this.collection);
  }

  private clean(doc: Record<string, unknown> | null): T | null {
    if (!doc) return null;
    const { _id: _unused, ...rest } = doc as Record<string, unknown> & { _id?: unknown };
    void _unused;
    return rest as unknown as T;
  }

  async find(predicate?: Predicate<T>): Promise<T[]> {
    const docs = (await this.model().find({}).lean()) as unknown as Array<Record<string, unknown>>;
    const cleaned = docs.map((doc) => this.clean(doc)).filter(Boolean) as T[];
    return predicate ? cleaned.filter(predicate) : cleaned;
  }

  async findOne(predicate: Predicate<T>): Promise<T | null> {
    const docs = await this.find(predicate);
    return docs[0] ?? null;
  }

  async get(id: string): Promise<T | null> {
    const doc = (await this.model().findOne({ id }).lean()) as unknown as Record<string, unknown>;
    return this.clean(doc);
  }

  async insert(doc: T): Promise<T> {
    const created = await this.model().create(doc as unknown as Record<string, unknown>);
    return this.clean(created.toObject() as unknown as Record<string, unknown>) as T;
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const { id: _ignored, ...rest } = patch as Partial<T> & { id?: string };
    void _ignored;
    const doc = (await this.model()
      .findOneAndUpdate({ id }, { $set: rest }, { new: true })
      .lean()) as unknown as Record<string, unknown>;
    return this.clean(doc);
  }

  async updateAtomic(filter: AtomicFilter<T>, patch: Partial<T>): Promise<T | null> {
    const { id: _ignored, ...rest } = patch as Partial<T> & { id?: string };
    void _ignored;
    const doc = (await this.model()
      .findOneAndUpdate(filter as Record<string, unknown>, { $set: rest }, { new: true })
      .lean()) as unknown as Record<string, unknown>;
    return this.clean(doc);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.model().deleteOne({ id });
    return result.deletedCount === 1;
  }

  async deleteWhere(predicate: Predicate<T>): Promise<number> {
    const matching = await this.find(predicate);
    if (!matching.length) return 0;
    const result = await this.model().deleteMany({
      id: { $in: matching.map((doc) => doc.id) },
    });
    return result.deletedCount ?? 0;
  }

  async count(predicate?: Predicate<T>): Promise<number> {
    if (!predicate) return this.model().countDocuments();
    return (await this.find(predicate)).length;
  }
}

class MongoStore implements Store {
  kind = 'mongo' as const;
  users = new MongoCollection<UserDoc>('users');
  schemes = new MongoCollection<SchemeDoc>('schemes');
  schemeVersions = new MongoCollection<SchemeVersionDoc>('schemeVersions');
  applications = new MongoCollection<ApplicationDoc>('applications');
  notifications = new MongoCollection<NotificationDoc>('notifications');
  refreshTokens = new MongoCollection<SessionDoc>('refreshTokens');
  otps = new MongoCollection<OtpDoc>('otps');
  rateLimits = new MongoCollection<RateLimitDoc>('rateLimits');
  authAttempts = new MongoCollection<AuthAttemptDoc>('authAttempts');
  otpSends = new MongoCollection<OtpSendDoc>('otpSends');
  auditLogs = new MongoCollection<AuditDoc>('auditLogs');
  translations = new MongoCollection<TranslationDoc>('translations');
  questions = new MongoCollection<QuestionDoc>('questions');
  checkEvents = new MongoCollection<CheckEventDoc>('checkEvents');
  contactMessages = new MongoCollection<ContactDoc>('contactMessages');

  constructor(private readonly mongooseInstance: typeof mongoose) {}

  async close(): Promise<void> {
    await this.mongooseInstance.disconnect();
  }
}

export async function createStore(options: { persist?: boolean } = {}): Promise<Store> {
  const persist = options.persist ?? !isTest;
  if (config.mongoUri) {
    logger.info('Connecting to MongoDB');
    const instance = await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    return new MongoStore(instance);
  }
  const file = persist ? resolve(process.cwd(), config.storeFile) : null;
  logger.info({ file }, 'Using local file-backed store');
  return JsonStore.create(file);
}
