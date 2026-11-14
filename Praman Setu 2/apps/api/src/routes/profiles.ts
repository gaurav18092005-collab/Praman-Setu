import { Router } from 'express';
import {
  accountDeleteSchema,
  contactChangeSchema,
  normaliseAnswers,
  profileInputSchema,
  profileUpdateSchema,
  settingsSchema,
} from '@pramansetu/shared';
import {
  authenticate,
  clearRefreshCookie,
  requestMeta,
  revokeAllSessions,
  verifyOtpAction,
} from '../auth';
import { config } from '../config';
import { ApiError, asyncHandler } from '../errors';
import type { ProfileDoc, Store } from '../store';
import { newId } from '../store';
import { publicProfile, publicUser } from '../utils';

export function profilesRouter(store: Store): Router {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json({ profiles: req.user?.profiles.map(publicProfile) ?? [] });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      if (user.profiles.length >= 10) {
        throw new ApiError(400, 'You can save up to 10 profiles.', 'profile_limit');
      }
      const input = profileInputSchema.parse(req.body);
      const { answers, notSure } = normaliseAnswers(input.answers, input.notSure);
      const timestamp = new Date().toISOString();
      const profile: ProfileDoc = {
        id: newId(),
        nickname: input.nickname.trim(),
        relation: input.relation.trim(),
        avatarColor: input.avatarColor,
        answers,
        notSure,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const updated = await store.users.update(user.id, {
        profiles: [...user.profiles, profile],
        updatedAt: timestamp,
      });
      res
        .status(201)
        .json({ profile: publicProfile(profile), user: updated ? publicUser(updated) : null });
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const existing = user.profiles.find((profile) => profile.id === req.params.id);
      if (!existing) throw new ApiError(404, 'Profile not found.', 'profile_not_found');
      const input = profileUpdateSchema.parse(req.body);
      const mergedAnswers = { ...existing.answers, ...(input.answers ?? {}) };
      const mergedNotSure = { ...existing.notSure, ...(input.notSure ?? {}) };
      const { answers, notSure } = normaliseAnswers(mergedAnswers, mergedNotSure);
      const timestamp = new Date().toISOString();
      const next: ProfileDoc = {
        ...existing,
        ...(input.nickname !== undefined ? { nickname: input.nickname.trim() } : {}),
        ...(input.relation !== undefined ? { relation: input.relation.trim() } : {}),
        ...(input.avatarColor !== undefined ? { avatarColor: input.avatarColor } : {}),
        answers,
        notSure,
        updatedAt: timestamp,
      };
      const profiles = user.profiles.map((profile) =>
        profile.id === existing.id ? next : profile,
      );
      await store.users.update(user.id, { profiles, updatedAt: timestamp });
      res.json({ profile: publicProfile(next) });
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const exists = user.profiles.some((profile) => profile.id === req.params.id);
      if (!exists) throw new ApiError(404, 'Profile not found.', 'profile_not_found');
      const profiles = user.profiles.filter((profile) => profile.id !== req.params.id);
      const applications = await store.applications.find(
        (app) => app.userId === user.id && app.profileId === req.params.id,
      );
      for (const application of applications) {
        await store.applications.delete(application.id);
      }
      await store.users.update(user.id, {
        profiles,
        updatedAt: new Date().toISOString(),
      });
      res.status(204).send();
    }),
  );

  return router;
}

export function accountRouter(store: Store): Router {
  const router = Router();
  router.use(authenticate);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.patch(
    '/settings',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const input = settingsSchema.parse(req.body);
      const notificationPrefs = {
        ...user.notificationPrefs,
        ...(input.notificationPrefs ?? {}),
      };
      const speechPrefs = {
        ...(user.speechPrefs ?? { speed: 1 as const, autoReadQuestions: false }),
        ...(input.speechPrefs ?? {}),
      };
      const updated = await store.users.update(user.id, {
        ...(input.language ? { language: input.language } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        notificationPrefs,
        speechPrefs,
        updatedAt: new Date().toISOString(),
      });
      if (!updated) throw new ApiError(404, 'Account not found.', 'not_found');
      res.json({ user: publicUser(updated) });
    }),
  );

  router.get(
    '/export',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const applications = await store.applications.find((app) => app.userId === user.id);
      const notifications = await store.notifications.find((item) => item.userId === user.id);
      res.setHeader('Content-Disposition', 'attachment; filename="pramansetu-my-data.json"');
      res.json({
        exportedAt: new Date().toISOString(),
        user: publicUser(user),
        applications,
        notifications,
      });
    }),
  );

  router.patch(
    '/contact',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const input = contactChangeSchema.parse(req.body);
      const target = input.phone ? { phone: input.phone } : { email: input.email };
      const verified = await verifyOtpAction(
        store,
        { ...target, code: input.code, purpose: 'change_contact' },
        requestMeta(req, config.otpPepper),
      );
      const conflict = input.phone
        ? await store.users.findOne(
            (item) => item.phone === verified.identifier && item.id !== user.id,
          )
        : await store.users.findOne(
            (item) => item.email === verified.identifier && item.id !== user.id,
          );
      if (conflict) {
        throw new ApiError(409, 'That contact is already in use.', 'contact_in_use');
      }
      await store.users.update(user.id, {
        ...(input.phone
          ? { phone: verified.identifier, email: undefined }
          : { email: verified.identifier, phone: undefined }),
        updatedAt: new Date().toISOString(),
      });
      await revokeAllSessions(store, user.id);
      clearRefreshCookie(res);
      res.json({ ok: true, reauthRequired: true });
    }),
  );

  router.delete(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const input = accountDeleteSchema.parse(req.body);
      const verified = await verifyOtpAction(
        store,
        {
          ...(user.phone ? { phone: user.phone } : { email: user.email }),
          code: input.code,
          purpose: 'delete_account',
        },
        requestMeta(req, config.otpPepper),
      );
      if (verified.user?.id !== user.id) {
        throw new ApiError(400, 'That code is not valid for this action.', 'otp_invalid');
      }
      const applications = await store.applications.find((app) => app.userId === user.id);
      for (const application of applications) await store.applications.delete(application.id);
      const notifications = await store.notifications.find((item) => item.userId === user.id);
      for (const notification of notifications) await store.notifications.delete(notification.id);
      const sessions = await store.refreshTokens.find((item) => item.userId === user.id);
      for (const session of sessions) await store.refreshTokens.delete(session.id);
      const otps = await store.otps.find(
        (item) =>
          Boolean(user.phone && item.identifier === user.phone) ||
          Boolean(user.email && item.identifier === user.email),
      );
      for (const otp of otps) await store.otps.delete(otp.id);
      const attempts = await store.authAttempts.find(
        (item) =>
          Boolean(user.phone && item.identifier === user.phone) ||
          Boolean(user.email && item.identifier === user.email),
      );
      for (const attempt of attempts) await store.authAttempts.delete(attempt.id);
      await store.users.delete(user.id);
      clearRefreshCookie(res);
      res.status(204).send();
    }),
  );

  return router;
}
