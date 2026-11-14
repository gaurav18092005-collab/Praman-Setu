import { Router } from 'express';
import {
  applicationCreateSchema,
  applicationUpdateSchema,
  type ApplicationStatus,
  type LocalizedText,
} from '@pramansetu/shared';
import { authenticate } from '../auth';
import { ApiError, asyncHandler } from '../errors';
import type { ApplicationDoc, NotificationDoc, Store } from '../store';
import { newId } from '../store';

const STATUS_LABELS: Record<ApplicationStatus, LocalizedText> = {
  started: { en: 'Started', hi: 'शुरू किया' },
  documents_ready: { en: 'Documents ready', hi: 'दस्तावेज़ तैयार' },
  submitted: { en: 'Submitted', hi: 'जमा किया' },
  under_review: { en: 'Under review', hi: 'समीक्षा में' },
  approved: { en: 'Approved', hi: 'स्वीकृत' },
  rejected: { en: 'Rejected', hi: 'अस्वीकृत' },
  withdrawn: { en: 'Withdrawn', hi: 'वापस लिया' },
};

export function applicationsRouter(store: Store): Router {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const applications = await store.applications.find((app) => app.userId === user.id);
      applications.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      res.json({ applications });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const input = applicationCreateSchema.parse(req.body);
      const profile = user.profiles.find((item) => item.id === input.profileId);
      if (!profile) throw new ApiError(404, 'Profile not found.', 'profile_not_found');
      const scheme = await store.schemes.get(input.schemeId);
      if (!scheme || scheme.status !== 'live') {
        throw new ApiError(404, 'Scheme not found.', 'scheme_not_found');
      }
      const existing = await store.applications.findOne(
        (app) =>
          app.userId === user.id &&
          app.profileId === input.profileId &&
          app.schemeId === input.schemeId &&
          app.status !== 'withdrawn',
      );
      if (existing) {
        throw new ApiError(
          409,
          'You are already tracking this scheme for this profile.',
          'duplicate_application',
        );
      }
      const timestamp = new Date().toISOString();
      const application: ApplicationDoc = {
        id: newId(),
        userId: user.id,
        profileId: profile.id,
        schemeId: scheme.id,
        schemeSlug: scheme.slug,
        schemeName: scheme.name,
        status: 'started',
        statusHistory: [{ status: 'started', at: timestamp }],
        startedAt: timestamp,
        submittedOn: null,
        deadline: scheme.closesOn ?? null,
        referenceNo: input.referenceNo ?? '',
        docsChecked: [],
        notes: input.notes ?? '',
        updatedAt: timestamp,
      };
      await store.applications.insert(application);
      res.status(201).json({ application });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const existing = await store.applications.get(req.params.id);
      if (!existing || existing.userId !== user.id) {
        throw new ApiError(404, 'Application not found.', 'application_not_found');
      }
      const input = applicationUpdateSchema.parse(req.body);
      const status = input.status ?? existing.status;
      const statusChanged = status !== existing.status;
      const timestamp = new Date().toISOString();
      const history = statusChanged
        ? [
            ...existing.statusHistory,
            {
              status,
              at: timestamp,
              note: input.statusNote ?? STATUS_LABELS[status].en,
            },
          ]
        : existing.statusHistory;
      const updated = await store.applications.update(existing.id, {
        status,
        statusHistory: history,
        ...(input.referenceNo !== undefined ? { referenceNo: input.referenceNo ?? '' } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.docsChecked !== undefined ? { docsChecked: input.docsChecked } : {}),
        ...(status === 'submitted' && !existing.submittedOn ? { submittedOn: timestamp } : {}),
        updatedAt: timestamp,
      });
      res.json({ application: updated });
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const existing = await store.applications.get(req.params.id);
      if (!existing || existing.userId !== user.id) {
        throw new ApiError(404, 'Application not found.', 'application_not_found');
      }
      await store.applications.delete(existing.id);
      res.status(204).send();
    }),
  );

  return router;
}

async function ensureDeadlineNotifications(store: Store, userId: string): Promise<void> {
  const applications = await store.applications.find(
    (app) => app.userId === userId && Boolean(app.deadline) && app.status !== 'rejected',
  );
  const existing = await store.notifications.find(
    (item) => item.userId === userId && item.type === 'deadline',
  );
  const now = Date.now();
  for (const application of applications) {
    if (!application.deadline) continue;
    const daysLeft = Math.ceil(
      (new Date(application.deadline).getTime() - now) / (24 * 60 * 60 * 1000),
    );
    if (daysLeft < 0 || daysLeft > 30) continue;
    const duplicate = existing.some(
      (item) => item.userId === userId && item.schemeSlug === application.schemeSlug,
    );
    if (duplicate) continue;
    const notification: NotificationDoc = {
      id: newId(),
      userId,
      type: 'deadline',
      schemeId: application.schemeId,
      schemeSlug: application.schemeSlug,
      message: {
        en: `${application.schemeName.en} closes in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Check the official portal.`,
        hi: `${application.schemeName.hi} ${daysLeft} दिन में बंद हो रही है। आधिकारिक पोर्टल देखें।`,
      },
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    await store.notifications.insert(notification);
    existing.push(notification);
  }
}

export function notificationsRouter(store: Store): Router {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      await ensureDeadlineNotifications(store, user.id);
      const notifications = await store.notifications.find((item) => item.userId === user.id);
      notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({
        notifications,
        unread: notifications.filter((item) => !item.readAt).length,
      });
    }),
  );

  router.patch(
    '/:id/read',
    asyncHandler(async (req, res) => {
      const user = req.user;
      if (!user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const notification = await store.notifications.get(req.params.id);
      if (!notification || notification.userId !== user.id) {
        throw new ApiError(404, 'Notification not found.', 'notification_not_found');
      }
      const read = req.body?.read !== false;
      const updated = await store.notifications.update(notification.id, {
        readAt: read ? new Date().toISOString() : null,
      });
      res.json({ notification: updated });
    }),
  );

  return router;
}
