import { Router } from 'express';
import {
  QUESTION_ORDER,
  adminUserUpdateSchema,
  schemeInputSchema,
  schemeUpdateSchema,
  type Scheme,
} from '@pramansetu/shared';
import { z } from 'zod';
import {
  authenticate,
  requireAdminRead,
  requireAdminWrite,
  requireStepUp,
  requireSuperAdmin,
  revokeAllSessions,
} from '../auth';
import { config } from '../config';
import { ApiError, asyncHandler } from '../errors';
import type { AuditDoc, SchemeDoc, SchemeVersionDoc, Store, UserDoc } from '../store';
import { newId } from '../store';
import { diffObjects, hashIp, maskEmail, maskPhone, nowIso, publicUser } from '../utils';

const historyQuerySchema = z.object({
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
});

const auditQuerySchema = z.object({
  action: z.string().max(80).optional(),
  entity: z.string().max(80).optional(),
  actorId: z.string().max(80).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const listSchemeQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(['draft', 'live', 'retired']).optional(),
  category: z.enum(['pension', 'scholarship', 'welfare']).optional(),
});

function audit(
  store: Store,
  req: { user?: UserDoc; ip?: string },
  action: string,
  entity: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<AuditDoc> {
  return store.auditLogs.insert({
    id: newId(),
    actorId: req.user?.id ?? 'unknown',
    actorName: req.user?.name ?? req.user?.phone?.slice(-4) ?? 'Admin',
    action,
    entity,
    entityId,
    before,
    after,
    at: nowIso(),
    ipHash: hashIp(req.ip, config.refreshSecret),
  });
}

function stripForValidation(scheme: Scheme): z.infer<typeof schemeInputSchema> {
  const {
    id: _id,
    version: _version,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = scheme;
  void _id;
  void _version;
  void _createdAt;
  void _updatedAt;
  return schemeInputSchema.parse(rest);
}

async function notifyUsersOfUpdate(store: Store, scheme: SchemeDoc): Promise<void> {
  const applications = await store.applications.find((app) => app.schemeId === scheme.id);
  const userIds = Array.from(new Set(applications.map((app) => app.userId)));
  for (const userId of userIds) {
    const user = await store.users.get(userId);
    if (!user || !user.notificationPrefs.schemeUpdates) continue;
    await store.notifications.insert({
      id: newId(),
      userId,
      type: 'scheme_updated',
      schemeId: scheme.id,
      schemeSlug: scheme.slug,
      message: {
        en: `${scheme.name.en} was updated. Review the change and confirm details on the official portal.`,
        hi: `${scheme.name.hi} में बदलाव हुआ है। परिवर्तन देखें और आधिकारिक पोर्टल पर विवरण की पुष्टि करें।`,
      },
      createdAt: nowIso(),
      readAt: null,
    });
  }
}

export function adminRouter(store: Store): Router {
  const router = Router();
  router.use(authenticate, requireAdminRead);

  router.get(
    '/schemes',
    asyncHandler(async (req, res) => {
      const query = listSchemeQuerySchema.parse(req.query);
      let schemes = await store.schemes.find();
      if (query.status) schemes = schemes.filter((scheme) => scheme.status === query.status);
      if (query.category) {
        schemes = schemes.filter((scheme) => scheme.category === query.category);
      }
      if (query.q) {
        const q = query.q.toLowerCase();
        schemes = schemes.filter(
          (scheme) =>
            scheme.name.en.toLowerCase().includes(q) ||
            Boolean(scheme.name.hi?.includes(query.q as string)) ||
            scheme.slug.includes(q),
        );
      }
      schemes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      res.json({ schemes });
    }),
  );

  router.get(
    '/schemes/:id',
    asyncHandler(async (req, res) => {
      const scheme = await store.schemes.get(req.params.id);
      if (!scheme) throw new ApiError(404, 'Scheme not found.', 'scheme_not_found');
      const versions = await store.schemeVersions.count(
        (version) => version.schemeId === scheme.id,
      );
      res.json({ scheme, meta: { versions } });
    }),
  );

  router.get(
    '/schemes/:id/history',
    asyncHandler(async (req, res) => {
      const scheme = await store.schemes.get(req.params.id);
      if (!scheme) throw new ApiError(404, 'Scheme not found.', 'scheme_not_found');
      const versions = await store.schemeVersions.find((version) => version.schemeId === scheme.id);
      versions.sort((a, b) => b.version - a.version);
      res.json({ scheme, versions });
    }),
  );

  router.get(
    '/schemes/:id/compare',
    asyncHandler(async (req, res) => {
      const query = historyQuerySchema.parse(req.query);
      if (!query.from || !query.to) {
        throw new ApiError(400, 'Both from and to versions are required.', 'missing_versions');
      }
      const scheme = await store.schemes.get(req.params.id);
      if (!scheme) throw new ApiError(404, 'Scheme not found.', 'scheme_not_found');
      const versions = await store.schemeVersions.find(
        (version) =>
          version.schemeId === scheme.id &&
          (version.version === query.from || version.version === query.to),
      );
      const from = versions.find((version) => version.version === query.from);
      const to = versions.find((version) => version.version === query.to);
      if (!from || !to) throw new ApiError(404, 'Version not found.', 'version_not_found');
      res.json({
        from: { version: from.version, changedAt: from.changedAt },
        to: { version: to.version, changedAt: to.changedAt },
        diff: diffObjects(
          from.snapshot as unknown as Record<string, unknown>,
          to.snapshot as unknown as Record<string, unknown>,
        ),
      });
    }),
  );

  router.post(
    '/schemes',
    requireAdminWrite,
    requireStepUp,
    asyncHandler(async (req, res) => {
      const input = schemeInputSchema.parse(req.body);
      const duplicate = await store.schemes.findOne((item) => item.slug === input.slug);
      if (duplicate) throw new ApiError(409, 'That slug is already in use.', 'slug_taken');
      const { changeNote, ...data } = input;
      const timestamp = nowIso();
      const scheme: SchemeDoc = {
        ...data,
        id: newId(),
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await store.schemes.insert(scheme);
      const version: SchemeVersionDoc = {
        id: newId(),
        schemeId: scheme.id,
        version: 1,
        snapshot: structuredClone(scheme),
        changedBy: req.user?.id ?? 'unknown',
        changedByName: req.user?.name ?? 'Admin',
        changedAt: timestamp,
        diff: [],
        changeNote: changeNote ?? 'Initial version',
      };
      await store.schemeVersions.insert(version);
      await audit(store, req, 'scheme.create', 'scheme', scheme.id, null, scheme);
      res.status(201).json({ scheme, version });
    }),
  );

  router.put(
    '/schemes/:id',
    requireAdminWrite,
    requireStepUp,
    asyncHandler(async (req, res) => {
      const existing = await store.schemes.get(req.params.id);
      if (!existing) throw new ApiError(404, 'Scheme not found.', 'scheme_not_found');
      const parsed = schemeUpdateSchema.parse(req.body);
      const { changeNote, ...patch } = parsed;
      if (patch.slug && patch.slug !== existing.slug) {
        const duplicate = await store.schemes.findOne((item) => item.slug === patch.slug);
        if (duplicate) throw new ApiError(409, 'That slug is already in use.', 'slug_taken');
      }
      const timestamp = nowIso();
      const merged = {
        ...existing,
        ...patch,
        id: existing.id,
        version: existing.version + 1,
        createdAt: existing.createdAt,
        updatedAt: timestamp,
      };
      stripForValidation(merged);
      const previous = structuredClone(existing);
      const updated = await store.schemes.update(existing.id, merged);
      if (!updated) throw new ApiError(500, 'Could not save the scheme.', 'save_failed');
      const diff = diffObjects(
        previous as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      );
      const version: SchemeVersionDoc = {
        id: newId(),
        schemeId: updated.id,
        version: updated.version,
        snapshot: structuredClone(updated),
        changedBy: req.user?.id ?? 'unknown',
        changedByName: req.user?.name ?? 'Admin',
        changedAt: timestamp,
        diff,
        changeNote: changeNote ?? 'Scheme updated',
      };
      await store.schemeVersions.insert(version);
      await audit(store, req, 'scheme.update', 'scheme', updated.id, previous, updated);
      if (updated.status === 'live') await notifyUsersOfUpdate(store, updated);
      res.json({ scheme: updated, version });
    }),
  );

  router.post(
    '/schemes/:id/rollback/:version',
    requireAdminWrite,
    requireStepUp,
    asyncHandler(async (req, res) => {
      const existing = await store.schemes.get(req.params.id);
      if (!existing) throw new ApiError(404, 'Scheme not found.', 'scheme_not_found');
      const versionNumber = Number(req.params.version);
      if (!Number.isInteger(versionNumber) || versionNumber < 1) {
        throw new ApiError(400, 'Invalid version.', 'invalid_version');
      }
      const target = await store.schemeVersions.findOne(
        (version) => version.schemeId === existing.id && version.version === versionNumber,
      );
      if (!target) throw new ApiError(404, 'Version not found.', 'version_not_found');
      const timestamp = nowIso();
      const restored = {
        ...target.snapshot,
        id: existing.id,
        version: existing.version + 1,
        createdAt: existing.createdAt,
        updatedAt: timestamp,
      };
      stripForValidation(restored);
      const previous = structuredClone(existing);
      const updated = await store.schemes.update(existing.id, restored);
      if (!updated) throw new ApiError(500, 'Could not restore the version.', 'rollback_failed');
      const newVersion: SchemeVersionDoc = {
        id: newId(),
        schemeId: updated.id,
        version: updated.version,
        snapshot: structuredClone(updated),
        changedBy: req.user?.id ?? 'unknown',
        changedByName: req.user?.name ?? 'Admin',
        changedAt: timestamp,
        diff: diffObjects(
          previous as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
        changeNote:
          (req.body?.changeNote as string | undefined) ?? `Rolled back to version ${versionNumber}`,
      };
      await store.schemeVersions.insert(newVersion);
      await audit(store, req, 'scheme.rollback', 'scheme', updated.id, previous, updated);
      if (updated.status === 'live') await notifyUsersOfUpdate(store, updated);
      res.json({ scheme: updated, version: newVersion });
    }),
  );

  router.get(
    '/analytics',
    asyncHandler(async (_req, res) => {
      const events = await store.checkEvents.find();
      const checks = events.filter((event) => !event.questionStep && event.status === 'healthy');
      const steps = events.filter((event) => Boolean(event.questionStep));
      const applications = await store.applications.find();
      const users = await store.users.find();
      const versions = await store.schemeVersions.find();
      const schemes = await store.schemes.find();
      const schemeById = new Map(schemes.map((scheme) => [scheme.id, scheme]));

      const matched = new Map<string, number>();
      for (const check of checks) {
        for (const slug of check.eligibleSlugs) {
          matched.set(slug, (matched.get(slug) ?? 0) + 1);
        }
      }
      const topSchemes = [...matched.entries()]
        .map(([slug, count]) => {
          const scheme = schemes.find((item) => item.slug === slug);
          return {
            slug,
            name: scheme?.name ?? { en: slug, hi: slug },
            count,
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      const statuses = [
        'started',
        'documents_ready',
        'submitted',
        'under_review',
        'approved',
        'rejected',
        'withdrawn',
      ] as const;
      const applicationsByStatus = statuses.map((status) => ({
        status,
        count: applications.filter((app) => app.status === status).length,
      }));

      const questionDropOff = QUESTION_ORDER.map((field, index) => {
        const reached = steps.filter((step) => step.questionStep === field).length;
        const next = QUESTION_ORDER[index + 1];
        const nextReached = next
          ? steps.filter((step) => step.questionStep === next).length
          : reached;
        return {
          field,
          reached,
          dropOff: Math.max(0, reached - nextReached),
          completionRate: reached === 0 ? 0 : Math.round((nextReached / reached) * 100),
        };
      });

      versions.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
      const recentChanges = versions.slice(0, 8).map((version) => ({
        schemeId: version.schemeId,
        schemeName: schemeById.get(version.schemeId)?.name ?? { en: 'Unknown', hi: 'अज्ञात' },
        version: version.version,
        changedAt: version.changedAt,
        changedByName: version.changedByName,
        changeNote: version.changeNote,
      }));

      res.json({
        kpis: {
          checks: checks.length,
          users: users.length,
          profiles: users.reduce((total, user) => total + user.profiles.length, 0),
          applications: applications.length,
          eligibleMatches: checks.reduce((total, check) => total + check.eligibleSlugs.length, 0),
          schemes: schemes.length,
        },
        topSchemes,
        applicationsByStatus,
        questionDropOff,
        recentChanges,
      });
    }),
  );

  router.get(
    '/audit',
    asyncHandler(async (req, res) => {
      const query = auditQuerySchema.parse(req.query);
      const logs = await store.auditLogs.find();
      let filtered = logs;
      if (query.action) filtered = filtered.filter((log) => log.action === query.action);
      if (query.entity) filtered = filtered.filter((log) => log.entity === query.entity);
      if (query.actorId) filtered = filtered.filter((log) => log.actorId === query.actorId);
      if (query.from) filtered = filtered.filter((log) => log.at >= query.from!);
      if (query.to) filtered = filtered.filter((log) => log.at <= query.to!);
      filtered.sort((a, b) => b.at.localeCompare(a.at));
      res.json({
        total: filtered.length,
        logs: filtered.slice(0, query.limit),
        actions: [...new Set(logs.map((log) => log.action))].sort(),
      });
    }),
  );

  router.get(
    '/users',
    asyncHandler(async (_req, res) => {
      const users = await store.users.find();
      const applications = await store.applications.find();
      const rows = users.map((user) => ({
        id: user.id,
        name: user.name ?? '',
        role: user.role,
        status: user.status ?? 'active',
        mfaEnabled: Boolean(user.mfaSecret),
        language: user.language,
        phone: maskPhone(user.phone),
        email: maskEmail(user.email),
        profiles: user.profiles.length,
        applications: applications.filter((app) => app.userId === user.id).length,
        createdAt: user.createdAt,
      }));
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({ users: rows, total: rows.length });
    }),
  );

  const updateUser = asyncHandler(async (req, res) => {
    const input = adminUserUpdateSchema.parse(req.body);
    if (input.role === undefined && input.status === undefined && !input.resetMfa) {
      throw new ApiError(400, 'Nothing to update.', 'empty_update');
    }
    const target = await store.users.get(req.params.id);
    if (!target) throw new ApiError(404, 'User not found.', 'user_not_found');
    if (target.id === req.user?.id) {
      throw new ApiError(
        400,
        'You cannot change your own role, status or MFA from this screen.',
        'self_admin_change',
      );
    }
    if (input.role && target.role === 'superadmin' && input.role !== 'superadmin') {
      const superadmins = await store.users.find((user) => user.role === 'superadmin');
      if (superadmins.length <= 1) {
        throw new ApiError(400, 'Keep at least one super-admin.', 'last_superadmin');
      }
    }
    const before = {
      role: target.role,
      status: target.status ?? 'active',
      mfaEnabled: Boolean(target.mfaSecret),
    };
    const patch: Partial<UserDoc> = { updatedAt: nowIso() };
    if (input.role) patch.role = input.role;
    if (input.status) patch.status = input.status;
    if (input.resetMfa) {
      patch.mfaSecret = null;
      patch.mfaRecoveryCodes = [];
      patch.mfaEnrolledAt = null;
    }
    const securityChange = Boolean(input.role ?? input.status ?? input.resetMfa);
    if (securityChange) {
      patch.tokenVersion = (target.tokenVersion ?? 0) + 1;
    }
    const updated = await store.users.update(target.id, patch);
    if (!updated) throw new ApiError(500, 'Could not update the account.', 'update_failed');
    if (securityChange) await revokeAllSessions(store, target.id);
    const after = {
      role: updated.role,
      status: updated.status ?? 'active',
      mfaEnabled: Boolean(updated.mfaSecret),
    };
    await audit(
      store,
      req,
      input.resetMfa ? 'user.mfa_reset' : input.role ? 'user.role' : 'user.status',
      'user',
      target.id,
      before,
      after,
    );
    res.json({ user: publicUser(updated) });
  });

  router.patch('/users/:id/role', requireSuperAdmin, requireStepUp, updateUser);
  router.patch('/users/:id', requireSuperAdmin, requireStepUp, updateUser);

  return router;
}
