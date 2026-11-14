import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generateSync } from 'otplib';
import type { Express } from 'express';
import type { Store } from './store';
import { createApp } from './app';
import { config } from './config';
import { DEMO_ADMIN_MFA_SECRET, seedStore } from './seed';

const TEST_OTP = '123456';

let app: Express;
let store: Store;

beforeEach(async () => {
  const created = await createApp({
    persist: false,
    codeGenerator: () => TEST_OTP,
  });
  app = created.app;
  store = created.store;
});

function refreshCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? first.split(';')[0] ?? '' : '';
}

interface LoginSession {
  token: string;
  refreshCookie: string;
  agent: ReturnType<typeof request.agent>;
  user: {
    id: string;
    role: string;
    profiles: Array<{ id: string; nickname: string }>;
    mfaEnabled?: boolean;
  };
}

async function login(
  phone = config.seedDemoPhone,
  options: { agent?: ReturnType<typeof request.agent> } = {},
): Promise<LoginSession> {
  const agent = options.agent ?? request.agent(app);
  const otp = await agent.post('/api/auth/request-otp').send({ phone });
  expect(otp.status).toBe(200);
  expect(otp.body.code).toBeUndefined();
  const verified = await agent
    .post('/api/auth/verify-otp')
    .send({ phone, code: TEST_OTP });
  expect(verified.status).toBe(200);
  let token = verified.body.accessToken as string;
  let user = verified.body.user;
  if (verified.body.mfaRequired && verified.body.mfaEnabled) {
    const mfa = await agent
      .post('/api/auth/mfa/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: generateSync({ secret: DEMO_ADMIN_MFA_SECRET }) });
    expect(mfa.status).toBe(200);
    token = mfa.body.accessToken;
    user = mfa.body.user;
  }
  return {
    token,
    refreshCookie: refreshCookie(verified),
    agent,
    user,
  };
}

describe('public API', () => {
  it('reports health and serves ten live schemes', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const response = await request(app).get('/api/schemes');
    expect(response.status).toBe(200);
    expect(response.body.schemes).toHaveLength(10);
    expect(response.body.schemes[0]).toHaveProperty('rules');
    expect(response.body.lastVerifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('filters schemes by category and search', async () => {
    const pension = await request(app).get('/api/schemes?category=pension');
    expect(pension.body.schemes).toHaveLength(3);
    const search = await request(app).get('/api/schemes?q=kisan');
    expect(search.body.schemes).toHaveLength(1);
    expect(search.body.schemes[0].slug).toBe('pm-kisan-samman-nidhi');
  });

  it('returns scheme detail and public history', async () => {
    const detail = await request(app).get('/api/schemes/pm-kisan-samman-nidhi');
    expect(detail.status).toBe(200);
    expect(detail.body.scheme.portalUrl).toContain('pmkisan.gov.in');
    expect(detail.body.meta.versionCount).toBe(1);

    const history = await request(app).get('/api/schemes/pm-kisan-samman-nidhi/history');
    expect(history.status).toBe(200);
    expect(history.body.history).toHaveLength(1);
    expect(history.body.history[0].changedByName).toBe('Catalogue import');
  });

  it('404s unknown schemes', async () => {
    const response = await request(app).get('/api/schemes/does-not-exist');
    expect(response.status).toBe(404);
  });

  it('serves translations and questions', async () => {
    const translations = await request(app).get('/api/translations');
    expect(translations.status).toBe(200);
    expect(translations.body.translations.en['nav.home']).toBe('Home');
    expect(translations.body.translations.hi['nav.home']).toBe('होम');
    expect(Object.keys(translations.body.translations.en).length).toBeGreaterThan(100);
    expect(Object.keys(translations.body.translations.pa).length).toBeGreaterThan(100);
    expect(Object.keys(translations.body.translations.ur).length).toBeGreaterThan(100);
    expect(Object.keys(translations.body.translations.mr).length).toBeGreaterThan(100);
    const questions = await request(app).get('/api/questions');
    expect(questions.body.questions).toHaveLength(13);
  });

  it('keeps server read-aloud off by default and rejects TTS requests', async () => {
    const status = await request(app).get('/api/speech/status');
    expect(status.status).toBe(200);
    expect(status.body.enabled).toBe(false);
    expect(status.body.provider).toBe('none');

    const tts = await request(app)
      .post('/api/speech/tts')
      .send({ text: 'Read this page', locale: 'en' });
    expect(tts.status).toBe(503);
    expect(tts.body.error.code).toBe('tts_disabled');
  });
});

describe('eligibility', () => {
  const mother = {
    ageGroup: '60-79',
    gender: 'female',
    income: 'under1l',
    category: 'obc',
    minority: 'no',
    occupation: 'homemaker',
    maritalStatus: 'widowed',
    disability: 'none',
    bpl: 'yes',
    state: 'UP',
  };

  it('runs the deterministic engine and returns all three buckets', async () => {
    const response = await request(app)
      .post('/api/eligibility/check')
      .send({ answers: mother, profileName: 'Mother', locale: 'en' });
    expect(response.status).toBe(200);
    expect(response.body.counts.eligible).toBeGreaterThanOrEqual(2);
    expect(response.body.counts.total).toBe(10);
    expect(response.body.eligible.map((item: { slug: string }) => item.slug)).toContain(
      'ignoaps-old-age-pension',
    );
    expect(response.body.disclaimer.en).toContain('official portal');
    expect(response.body.generatedAt).toBeTruthy();
    expect(response.body.checklist.length).toBeGreaterThan(0);
  });

  it('returns need-more-info and unlock hints for “Not sure”', async () => {
    const response = await request(app)
      .post('/api/eligibility/check')
      .send({ answers: { ...mother, bpl: 'notSure' }, notSure: { bpl: true } });
    expect(response.status).toBe(200);
    const scheme = response.body.needMoreInfo.find(
      (item: { slug: string }) => item.slug === 'ignoaps-old-age-pension',
    );
    expect(scheme.status).toBe('need_more_info');
    expect(scheme.missingFields).toEqual(['bpl']);
    const hint = response.body.missingInfo.find((item: { field: string }) => item.field === 'bpl');
    expect(hint.unlocks.length).toBeGreaterThan(0);
  });

  it('returns a near miss for an ineligible ordinal rule', async () => {
    const response = await request(app)
      .post('/api/eligibility/check')
      .send({ answers: { ...mother, ageGroup: '26-59', maritalStatus: 'single' } });
    const scheme = response.body.notEligible.find(
      (item: { slug: string }) => item.slug === 'ignoaps-old-age-pension',
    );
    expect(scheme.nearMiss).toMatchObject({ field: 'ageGroup', gap: 1 });
  });

  it('is deterministic apart from the response timestamp', async () => {
    const first = await request(app).post('/api/eligibility/check').send({ answers: mother });
    const second = await request(app).post('/api/eligibility/check').send({ answers: mother });
    expect(first.body.counts).toEqual(second.body.counts);
    expect(first.body.eligible.length).toBe(second.body.eligible.length);
  });

  it('rejects unknown answer keys and Aadhaar numbers', async () => {
    const unknown = await request(app)
      .post('/api/eligibility/check')
      .send({ answers: { ...mother, aadhaarNumber: '1234' } });
    expect(unknown.status).toBe(400);

    const aadhaar = await request(app)
      .post('/api/eligibility/check')
      .send({ answers: { ...mother, state: '1234 5678 9012' } });
    expect(aadhaar.status).toBe(400);
    expect(aadhaar.body.error.code).toBe('aadhaar_rejected');
  });

  it('requires at least one answer value to be valid', async () => {
    const response = await request(app)
      .post('/api/eligibility/check')
      .send({ answers: { ageGroup: 42 } });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});

describe('authentication', () => {
  it('issues memory tokens, exposes me, and rotates cookie refresh tokens', async () => {
    const session = await login();
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.profiles).toHaveLength(2);
    expect(me.body.user.phone).toBe(config.seedDemoPhone);

    const refreshed = await session.agent.post('/api/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).toBeUndefined();
    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshCookie(refreshed)).not.toBe(session.refreshCookie);

    const reuse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('refresh_reused');

    const afterReuse = await session.agent.post('/api/auth/refresh');
    expect(afterReuse.status).toBe(401);
  });

  it('requires MFA before an admin session can use admin routes', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/request-otp').send({ phone: config.seedAdminPhone });
    const verified = await agent
      .post('/api/auth/verify-otp')
      .send({ phone: config.seedAdminPhone, code: TEST_OTP });
    expect(verified.status).toBe(200);
    expect(verified.body.mfaRequired).toBe(true);
    expect(verified.body.accessToken).toBeTruthy();

    const before = await request(app)
      .get('/api/admin/schemes')
      .set('Authorization', `Bearer ${verified.body.accessToken}`);
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe('mfa_required');

    const badMfa = await agent
      .post('/api/auth/mfa/verify')
      .set('Authorization', `Bearer ${verified.body.accessToken}`)
      .send({ code: '000000' });
    expect(badMfa.status).toBe(400);

    const mfa = await agent
      .post('/api/auth/mfa/verify')
      .set('Authorization', `Bearer ${verified.body.accessToken}`)
      .send({ code: generateSync({ secret: DEMO_ADMIN_MFA_SECRET }) });
    expect(mfa.status).toBe(200);
    expect(mfa.body.mfaRequired).toBe(false);

    const after = await request(app)
      .get('/api/admin/schemes')
      .set('Authorization', `Bearer ${mfa.body.accessToken}`);
    expect(after.status).toBe(200);
  });

  it('enforces a resend cooldown', async () => {
    await request(app).post('/api/auth/request-otp').send({ phone: '9123456780' });
    const second = await request(app).post('/api/auth/request-otp').send({ phone: '9123456780' });
    expect(second.status).toBe(429);
  });

  it('rejects a wrong OTP and locks after repeated attempts', async () => {
    await request(app).post('/api/auth/request-otp').send({ phone: '9123456781' });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wrong = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '9123456781', code: '000000' });
      expect(wrong.status).toBe(400);
    }
    const fifth = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '9123456781', code: '000000' });
    expect(fifth.status).toBe(429);
    const locked = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '9123456781', code: '123456' });
    expect(locked.status).toBe(429);
  });

  it('keeps a lockout after the app process restarts', async () => {
    await request(app).post('/api/auth/request-otp').send({ phone: '9123456782' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '9123456782', code: '000000' });
    }
    const restarted = await createApp({
      store,
      seed: false,
      codeGenerator: () => TEST_OTP,
    });
    const locked = await request(restarted.app)
      .post('/api/auth/verify-otp')
      .send({ phone: '9123456782', code: TEST_OTP });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('otp_locked');
  });

  it('expires codes after five minutes and never returns a fixed code', async () => {
    const requestOtp = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: '9123456783' });
    expect(requestOtp.status).toBe(200);
    expect(requestOtp.body.expiresInSeconds).toBe(5 * 60);
    expect(requestOtp.body.devCode).toBeUndefined();
    const live = (await store.otps.find((doc) => doc.identifier === '9123456783'))[0];
    expect(live).toBeTruthy();
    await store.otps.update(live!.id, {
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const expired = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '9123456783', code: TEST_OTP });
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('otp_expired');
  });

  it('invalidates the previous live code and enforces one purpose', async () => {
    const created = await createApp({
      persist: false,
      codeGenerator: ({ purpose }) => (purpose === 'login' ? '111111' : '222222'),
    });
    const loginOtp = await request(created.app)
      .post('/api/auth/request-otp')
      .send({ phone: config.seedDemoPhone, purpose: 'login' });
    expect(loginOtp.status).toBe(200);

    const demo = await request(created.app)
      .post('/api/auth/demo-login')
      .send({ role: 'user' });
    expect(demo.status).toBe(200);
    const actionOtp = await request(created.app)
      .post('/api/auth/request-otp')
      .set('Authorization', `Bearer ${demo.body.accessToken}`)
      .send({ phone: config.seedDemoPhone, purpose: 'change_contact' });
    expect(actionOtp.status).toBe(200);

    const oldLogin = await request(created.app)
      .post('/api/auth/verify-otp')
      .send({ phone: config.seedDemoPhone, purpose: 'login', code: '111111' });
    expect(oldLogin.status).toBe(400);
    expect(oldLogin.body.error.code).toBe('otp_invalid');

    const action = await request(created.app)
      .patch('/api/account/contact')
      .set('Authorization', `Bearer ${demo.body.accessToken}`)
      .send({ phone: config.seedDemoPhone, code: '222222' });
    expect(action.status).toBe(200);
  });

  it('only lets signed-in users request destructive-action codes', async () => {
    const anonymous = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: config.seedDemoPhone, purpose: 'delete_account' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('auth_required');

    const stepUpPurpose = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: config.seedAdminPhone, purpose: 'admin_stepup' });
    expect(stepUpPurpose.status).toBe(400);
    expect(stepUpPurpose.body.error.code).toBe('otp_purpose_invalid');

    const publicVerify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: config.seedDemoPhone, purpose: 'delete_account', code: TEST_OTP });
    expect(publicVerify.status).toBe(400);
    expect(publicVerify.body.error.code).toBe('otp_purpose_invalid');
  });

  it('cannot consume the same code twice', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/request-otp').send({ phone: config.seedDemoPhone });
    const first = await agent
      .post('/api/auth/verify-otp')
      .send({ phone: config.seedDemoPhone, code: TEST_OTP });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: config.seedDemoPhone, code: TEST_OTP });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('otp_invalid');
  });

  it('lists sessions, revokes one device, and logout-all invalidates access tokens', async () => {
    const first = await login();
    const second = await request(app).post('/api/auth/demo-login').send({ role: 'user' });
    expect(second.status).toBe(200);
    const secondCookie = refreshCookie(second);
    const sessions = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${first.token}`);
    expect(sessions.status).toBe(200);
    expect(sessions.body.sessions).toHaveLength(2);
    const current = sessions.body.sessions.find((row: { current: boolean }) => row.current);
    const other = sessions.body.sessions.find((row: { current: boolean }) => !row.current);
    expect(current).toBeTruthy();
    expect(other).toBeTruthy();

    const revoked = await request(app)
      .delete(`/api/auth/sessions/${other.id}`)
      .set('Authorization', `Bearer ${first.token}`);
    expect(revoked.status).toBe(204);
    const otherRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', secondCookie);
    expect(otherRefresh.status).toBe(401);

    const logoutAll = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${first.token}`);
    expect(logoutAll.status).toBe(204);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${first.token}`);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('session_revoked');
    const firstRefresh = await first.agent.post('/api/auth/refresh');
    expect(firstRefresh.status).toBe(401);
  });

  it('logout revokes the cookie refresh token', async () => {
    const session = await login();
    const logout = await session.agent.post('/api/auth/logout');
    expect(logout.status).toBe(204);
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(refresh.status).toBe(401);
  });

  it('supports the development-only demo login without granting MFA', async () => {
    const response = await request(app).post('/api/auth/demo-login').send({ role: 'admin' });
    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('superadmin');
    expect(response.body.mfaRequired).toBe(true);

    const citizen = await request(app).post('/api/auth/demo-login').send({ role: 'user' });
    expect(citizen.status).toBe(200);
    expect(citizen.body.mfaRequired).toBe(false);
    expect(citizen.body.accessToken).toBeTruthy();
  });

  it('repairs legacy demo accounts missing status before OTP sign-in', async () => {
    const demoUser = await store.users.findOne((user) => user.phone === config.seedDemoPhone);
    expect(demoUser).not.toBeNull();
    if (!demoUser) throw new Error('Demo user was not seeded');

    await store.users.update(demoUser.id, { status: undefined });
    await seedStore(store);

    const otp = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: config.seedDemoPhone });
    expect(otp.status).toBe(200);
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: config.seedDemoPhone, code: TEST_OTP });
    expect(verify.status).toBe(200);
  });

  it('does not allow demo sign-in for suspended accounts', async () => {
    const demoUser = await store.users.findOne((user) => user.phone === config.seedDemoPhone);
    expect(demoUser).not.toBeNull();
    if (!demoUser) throw new Error('Demo user was not seeded');
    await store.users.update(demoUser.id, { status: 'suspended' });

    const response = await request(app).post('/api/auth/demo-login').send({ role: 'user' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('account_inactive');
  });
});

describe('profiles and applications', () => {
  it('creates, updates and deletes a family profile', async () => {
    const session = await login();
    const created = await request(app)
      .post('/api/profiles')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        nickname: 'Father',
        relation: 'father',
        avatarColor: '#138808',
        answers: { ageGroup: '60-79', gender: 'male', bpl: 'yes' },
        notSure: {},
      });
    expect(created.status).toBe(201);
    const profileId = created.body.profile.id as string;

    const updated = await request(app)
      .put(`/api/profiles/${profileId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ answers: { occupation: 'retired' }, notSure: { income: true } });
    expect(updated.status).toBe(200);
    expect(updated.body.profile.answers.occupation).toBe('retired');
    expect(updated.body.profile.notSure.income).toBe(true);

    const removed = await request(app)
      .delete(`/api/profiles/${profileId}`)
      .set('Authorization', `Bearer ${session.token}`);
    expect(removed.status).toBe(204);
  });

  it('starts an application, updates its status and removals work', async () => {
    const session = await login();
    const profileId = session.user.profiles[0]?.id as string;
    const schemes = await request(app).get('/api/schemes');
    const scheme = schemes.body.schemes.find(
      (item: { slug: string }) => item.slug !== 'pm-kisan-samman-nidhi',
    );
    const created = await request(app)
      .post('/api/applications')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ profileId, schemeId: scheme.id, notes: 'Test application' });
    expect(created.status).toBe(201);

    const duplicate = await request(app)
      .post('/api/applications')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ profileId, schemeId: scheme.id });
    expect(duplicate.status).toBe(409);

    const updated = await request(app)
      .patch(`/api/applications/${created.body.application.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ status: 'submitted', referenceNo: 'REF-123', docsChecked: ['aadhaar'] });
    expect(updated.status).toBe(200);
    expect(updated.body.application.status).toBe('submitted');
    expect(updated.body.application.submittedOn).toBeTruthy();
    expect(updated.body.application.statusHistory).toHaveLength(2);

    const list = await request(app)
      .get('/api/applications')
      .set('Authorization', `Bearer ${session.token}`);
    expect(list.body.applications.length).toBeGreaterThanOrEqual(2);

    const deleted = await request(app)
      .delete(`/api/applications/${created.body.application.id}`)
      .set('Authorization', `Bearer ${session.token}`);
    expect(deleted.status).toBe(204);
  });

  it('returns notifications and marks one read', async () => {
    const session = await login();
    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${session.token}`);
    expect(list.status).toBe(200);
    expect(list.body.notifications.length).toBeGreaterThan(0);
    const id = list.body.notifications[0].id as string;
    const read = await request(app)
      .patch(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ read: true });
    expect(read.status).toBe(200);
    expect(read.body.notification.readAt).toBeTruthy();
  });

  it('exports then hard-deletes all account data after a purpose-bound OTP', async () => {
    const session = await login();
    const exported = await request(app)
      .get('/api/account/export')
      .set('Authorization', `Bearer ${session.token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toContain('pramansetu-my-data.json');
    expect(exported.body.user.phone).toBe(config.seedDemoPhone);

    const otp = await session.agent
      .post('/api/auth/request-otp')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ phone: config.seedDemoPhone, purpose: 'delete_account' });
    expect(otp.status).toBe(200);

    const missingCode = await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${session.token}`)
      .send({});
    expect(missingCode.status).toBe(400);

    const deleted = await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ code: TEST_OTP });
    expect(deleted.status).toBe(204);

    expect(await store.users.get(session.user.id)).toBeNull();
    expect(await store.applications.find((item) => item.userId === session.user.id)).toHaveLength(
      0,
    );

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.token}`);
    expect(me.status).toBe(401);
  });

  it('requires authentication for private routes', async () => {
    expect((await request(app).get('/api/profiles')).status).toBe(401);
    expect((await request(app).get('/api/applications')).status).toBe(401);
    expect((await request(app).get('/api/account/export')).status).toBe(401);
  });
});

describe('admin', () => {
  async function adminLogin() {
    return login(config.seedAdminPhone);
  }

  it('forbids non-admin users', async () => {
    const session = await login();
    const response = await request(app)
      .get('/api/admin/schemes')
      .set('Authorization', `Bearer ${session.token}`);
    expect(response.status).toBe(403);
    expect((await request(app).get('/api/admin/schemes')).status).toBe(401);
  });

  it('creates a version on edit, diffs fields and rolls back as a new version', async () => {
    const session = await adminLogin();
    const auth = { Authorization: `Bearer ${session.token}` };
    const list = await request(app).get('/api/admin/schemes?q=pm-kisan').set(auth);
    expect(list.body.schemes).toHaveLength(1);
    const scheme = list.body.schemes[0];
    const originalBenefit = scheme.benefit.en;

    const updated = await request(app)
      .put(`/api/admin/schemes/${scheme.id}`)
      .set(auth)
      .send({
        benefit: { ...scheme.benefit, en: 'Updated benefit for testing' },
        changeNote: 'Adjust wording',
      });
    expect(updated.status).toBe(200);
    expect(updated.body.scheme.version).toBe(2);
    expect(updated.body.version.diff[0].field).toBe('benefit');

    const history = await request(app).get(`/api/admin/schemes/${scheme.id}/history`).set(auth);
    expect(history.body.versions).toHaveLength(2);
    expect(history.body.versions[0].version).toBe(2);

    const compare = await request(app)
      .get(`/api/admin/schemes/${scheme.id}/compare?from=1&to=2`)
      .set(auth);
    expect(compare.status).toBe(200);
    expect(compare.body.diff[0].field).toBe('benefit');

    const rollback = await request(app)
      .post(`/api/admin/schemes/${scheme.id}/rollback/1`)
      .set(auth)
      .send({ changeNote: 'Restore verified text' });
    expect(rollback.status).toBe(200);
    expect(rollback.body.scheme.version).toBe(3);
    expect(rollback.body.scheme.benefit.en).toBe(originalBenefit);
    expect(rollback.body.version.changeNote).toBe('Restore verified text');

    const finalHistory = await request(app)
      .get(`/api/admin/schemes/${scheme.id}/history`)
      .set(auth);
    expect(finalHistory.body.versions).toHaveLength(3);

    const audit = await request(app).get('/api/admin/audit').set(auth);
    expect(
      audit.body.logs.some((log: { action: string }) => log.action === 'scheme.rollback'),
    ).toBe(true);
  });

  it('creates a draft scheme and validates rule operators', async () => {
    const session = await adminLogin();
    const auth = { Authorization: `Bearer ${session.token}` };
    const body = {
      slug: 'test-draft-scheme',
      category: 'welfare',
      name: { en: 'Test Draft', hi: 'परीक्षण मसौदा' },
      launchedBy: { en: 'Test Ministry', hi: 'परीक्षण मंत्रालय' },
      benefit: { en: 'Test benefit', hi: 'परीक्षण लाभ' },
      openAllYear: true,
      rules: [{ field: 'ageGroup', operator: 'gte', value: '18-25' }],
      documents: [
        {
          key: 'test-doc',
          label: { en: 'Test document', hi: 'परीक्षण दस्तावेज़' },
          hint: { en: 'Where to get it', hi: 'कहाँ से मिलेगा' },
        },
      ],
      procedure: [{ en: 'Apply online', hi: 'ऑनलाइन आवेदन करें' }],
      portalUrl: 'https://example.gov.in/',
      sourceUrls: ['https://example.gov.in/'],
      lastVerifiedOn: '2025-06-30',
      status: 'draft',
    };
    const created = await request(app).post('/api/admin/schemes').set(auth).send(body);
    expect(created.status).toBe(201);
    expect(created.body.scheme.version).toBe(1);

    const duplicate = await request(app).post('/api/admin/schemes').set(auth).send(body);
    expect(duplicate.status).toBe(409);

    const invalidRule = await request(app)
      .post('/api/admin/schemes')
      .set(auth)
      .send({
        ...body,
        slug: 'invalid-rule-scheme',
        rules: [{ field: 'category', operator: 'gte', value: 'sc' }],
      });
    expect(invalidRule.status).toBe(400);

    const draftList = await request(app).get('/api/admin/schemes?status=draft').set(auth);
    expect(draftList.body.schemes.length).toBeGreaterThanOrEqual(1);
    const publicList = await request(app).get('/api/schemes');
    expect(
      publicList.body.schemes.some((item: { slug: string }) => item.slug === 'test-draft-scheme'),
    ).toBe(false);
  });

  it('returns analytics with question drop-off and KPI data', async () => {
    const session = await adminLogin();
    await request(app)
      .post('/api/eligibility/check')
      .send({ answers: { ageGroup: '60-79', gender: 'female', bpl: 'yes' } });
    await request(app)
      .post('/api/eligibility/question-step')
      .send({ field: 'ageGroup', answers: { ageGroup: '60-79' } });
    await request(app)
      .post('/api/eligibility/question-step')
      .send({ field: 'gender', answers: { gender: 'female' } });

    const response = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${session.token}`);
    expect(response.status).toBe(200);
    expect(response.body.kpis.checks).toBe(1);
    expect(response.body.kpis.schemes).toBe(10);
    expect(response.body.topSchemes.length).toBeGreaterThan(0);
    expect(response.body.questionDropOff).toHaveLength(13);
    expect(response.body.applicationsByStatus).toHaveLength(7);
    expect(response.body.recentChanges.length).toBeGreaterThan(0);
  });

  it('notifies affected users when a live scheme changes', async () => {
    const session = await adminLogin();
    const auth = { Authorization: `Bearer ${session.token}` };
    const list = await request(app).get('/api/admin/schemes?q=pm-kisan').set(auth);
    const scheme = list.body.schemes[0];
    await request(app)
      .put(`/api/admin/schemes/${scheme.id}`)
      .set(auth)
      .send({ changeNote: 'Minor update' });

    const demo = await login();
    const notifications = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${demo.token}`);
    expect(
      notifications.body.notifications.some(
        (item: { type: string; schemeSlug: string }) =>
          item.type === 'scheme_updated' && item.schemeSlug === 'pm-kisan-samman-nidhi',
      ),
    ).toBe(true);
  });

  it('masks user PII and lets super-admins change roles', async () => {
    const session = await adminLogin();
    const users = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${session.token}`);
    expect(users.status).toBe(200);
    const demo = users.body.users.find((user: { phone: string }) => user.phone.endsWith('3210'));
    expect(demo.phone).not.toContain('98765');
    expect(demo.phone).toContain('•');

    const selfDemotion = await request(app)
      .patch(`/api/admin/users/${session.user.id}/role`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ role: 'viewer' });
    expect(selfDemotion.status).toBe(400);

    const promoted = await request(app)
      .patch(`/api/admin/users/${demo.id}/role`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ role: 'viewer' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.user.role).toBe('viewer');

    const viewerSession = await login();
    const read = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${viewerSession.token}`);
    expect(read.status).toBe(403);
    const write = await request(app)
      .post('/api/admin/schemes')
      .set('Authorization', `Bearer ${viewerSession.token}`)
      .send({});
    expect(write.status).toBe(403);
  });

  it('lets super-admins suspend accounts and reset MFA with step-up', async () => {
    const session = await login(config.seedAdminPhone);
    const users = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${session.token}`);
    const demo = users.body.users.find((user: { phone: string }) => user.phone.endsWith('3210'));

    const suspended = await request(app)
      .patch(`/api/admin/users/${demo.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ status: 'suspended' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.user.status).toBe('suspended');

    const blocked = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: config.seedDemoPhone });
    expect(blocked.status).toBe(200);
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: config.seedDemoPhone, code: TEST_OTP });
    expect(verify.status).toBe(403);
    expect(verify.body.error.code).toBe('account_inactive');

    const reset = await request(app)
      .patch(`/api/admin/users/${demo.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ status: 'active', resetMfa: true });
    expect(reset.status).toBe(200);
    expect(reset.body.user.status).toBe('active');
  });

  it('requires a fresh step-up and records it in the audit trail', async () => {
    const session = await adminLogin();
    const auth = { Authorization: `Bearer ${session.token}` };
    const users = await request(app).get('/api/admin/users').set(auth);
    const demo = users.body.users.find((user: { phone: string }) => user.phone.endsWith('3210'));
    const sessions = await request(app).get('/api/auth/sessions').set(auth);
    const current = sessions.body.sessions.find((row: { current: boolean }) => row.current);
    await store.refreshTokens.update(current.id, {
      lastReauthAt: new Date(Date.now() - 16 * 60_000).toISOString(),
    });

    const expired = await request(app)
      .patch(`/api/admin/users/${demo.id}/role`)
      .set(auth)
      .send({ role: 'viewer' });
    expect(expired.status).toBe(403);
    expect(expired.body.error.code).toBe('step_up_required');

    const stepUp = await request(app)
      .post('/api/auth/step-up')
      .set(auth)
      .send({ code: generateSync({ secret: DEMO_ADMIN_MFA_SECRET }) });
    expect(stepUp.status).toBe(200);
    expect(stepUp.body.expiresInSeconds).toBe(15 * 60);

    const retried = await request(app)
      .patch(`/api/admin/users/${demo.id}/role`)
      .set(auth)
      .send({ role: 'viewer' });
    expect(retried.status).toBe(200);

    const from = new Date(Date.now() - 60_000).toISOString();
    const auditRows = await request(app)
      .get(`/api/admin/audit?action=step_up&from=${encodeURIComponent(from)}&limit=10`)
      .set(auth);
    expect(auditRows.status).toBe(200);
    expect(auditRows.body.logs.length).toBeGreaterThan(0);
    expect(
      auditRows.body.logs.every(
        (row: { action: string; at: string }) => row.action === 'step_up' && row.at >= from,
      ),
    ).toBe(true);

    const future = new Date(Date.now() + 60_000).toISOString();
    const empty = await request(app)
      .get(`/api/admin/audit?from=${encodeURIComponent(future)}`)
      .set(auth);
    expect(empty.body.logs).toHaveLength(0);
  });

  it('updates translations and question copy with audit trails', async () => {
    const session = await adminLogin();
    const auth = { Authorization: `Bearer ${session.token}` };
    const translation = await request(app)
      .put('/api/admin/translations')
      .set(auth)
      .send({
        locale: 'hi',
        key: 'landing.hero.title',
        value: 'परीक्षण शीर्षक',
        reviewed: true,
      });
    expect(translation.status).toBe(200);
    expect(translation.body.translation.reviewed).toBe(true);

    const publicTranslations = await request(app).get('/api/translations');
    expect(publicTranslations.body.translations.hi['landing.hero.title']).toBe('परीक्षण शीर्षक');

    const question = await request(app)
      .put('/api/admin/questions/ageGroup')
      .set(auth)
      .send({
        field: 'ageGroup',
        label: { en: 'Your age', hi: 'आपकी आयु' },
        helper: { en: 'Helps pension checks', hi: 'पेंशन जाँच में मदद करता है' },
        order: 1,
      });
    expect(question.status).toBe(200);
    expect(question.body.question.label.hi).toBe('आपकी आयु');
  });
});

describe('contact', () => {
  it('stores feedback and rejects Aadhaar-like content', async () => {
    const ok = await request(app)
      .post('/api/contact')
      .send({ name: 'Asha', contact: 'asha@example.com', message: 'The checklist helped me.' });
    expect(ok.status).toBe(201);

    const bad = await request(app).post('/api/contact').send({
      name: 'Asha',
      contact: 'asha@example.com',
      message: 'My number is 1234 5678 9012',
    });
    expect(bad.status).toBe(400);

    const session = await login(config.seedAdminPhone);
    const list = await request(app)
      .get('/api/admin/contact')
      .set('Authorization', `Bearer ${session.token}`);
    expect(list.body.messages).toHaveLength(1);
  });
});
