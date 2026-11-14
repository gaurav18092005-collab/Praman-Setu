import { Router } from 'express';
import {
  LOCALES,
  contactSchema,
  questionConfigSchema,
  translationSchema,
  type Locale,
} from '@pramansetu/shared';
import { z } from 'zod';
import { authenticate, requireAdminRead, requireAdminWrite } from '../auth';
import { config } from '../config';
import { ApiError, asyncHandler } from '../errors';
import type { Store } from '../store';
import { newId } from '../store';
import { hashIp, nowIso } from '../utils';

const resolveContactSchema = z.object({ resolved: z.boolean() });

export function contentRouter(store: Store): Router {
  const router = Router();

  router.get(
    '/translations',
    asyncHandler(async (_req, res) => {
      const rows = await store.translations.find();
      const translations = Object.fromEntries(
        LOCALES.map((locale) => [locale, {} as Record<string, string>]),
      ) as Record<Locale, Record<string, string>>;
      for (const row of rows) {
        translations[row.locale][row.key] = row.value;
      }
      res.json({ translations });
    }),
  );

  router.get(
    '/questions',
    asyncHandler(async (_req, res) => {
      const questions = await store.questions.find();
      questions.sort((a, b) => a.order - b.order);
      res.json({ questions });
    }),
  );

  router.post(
    '/contact',
    asyncHandler(async (req, res) => {
      const input = contactSchema.parse(req.body);
      await store.contactMessages.insert({
        id: newId(),
        name: input.name,
        contact: input.contact,
        message: input.message,
        locale: input.locale,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      });
      res.status(201).json({ ok: true });
    }),
  );

  router.get(
    '/admin/translations',
    authenticate,
    requireAdminRead,
    asyncHandler(async (_req, res) => {
      const translations = await store.translations.find();
      translations.sort((a, b) => a.key.localeCompare(b.key));
      res.json({ translations });
    }),
  );

  router.put(
    '/admin/translations',
    authenticate,
    requireAdminWrite,
    asyncHandler(async (req, res) => {
      const input = translationSchema.parse(req.body);
      const existing = await store.translations.findOne(
        (row) => row.locale === input.locale && row.key === input.key,
      );
      const timestamp = new Date().toISOString();
      const reviewed =
        input.locale === 'en'
          ? true
          : input.reviewed ?? existing?.reviewed ?? false;
      const row = existing
        ? await store.translations.update(existing.id, {
            value: input.value,
            reviewed,
            updatedAt: timestamp,
            updatedBy: req.user?.id ?? 'unknown',
          })
        : await store.translations.insert({
            id: newId(),
            locale: input.locale,
            key: input.key,
            value: input.value,
            reviewed,
            updatedAt: timestamp,
            updatedBy: req.user?.id ?? 'unknown',
          });
      await store.auditLogs.insert({
        id: newId(),
        actorId: req.user?.id ?? 'unknown',
        actorName: req.user?.name ?? 'Admin',
        action: 'translation.update',
        entity: 'translation',
        entityId: row?.id ?? `${input.locale}:${input.key}`,
        before: existing ? { value: existing.value, reviewed: existing.reviewed ?? false } : null,
        after: { value: input.value, reviewed },
        at: timestamp,
        ipHash: hashIp(req.ip, config.refreshSecret),
      });
      res.json({ translation: row });
    }),
  );

  router.get(
    '/admin/questions',
    authenticate,
    requireAdminRead,
    asyncHandler(async (_req, res) => {
      const questions = await store.questions.find();
      questions.sort((a, b) => a.order - b.order);
      res.json({ questions });
    }),
  );

  router.put(
    '/admin/questions/:field',
    authenticate,
    requireAdminWrite,
    asyncHandler(async (req, res) => {
      const input = questionConfigSchema.parse(req.body);
      if (input.field !== req.params.field) {
        throw new ApiError(400, 'Field does not match the route.', 'field_mismatch');
      }
      const existing = await store.questions.findOne((row) => row.field === input.field);
      if (!existing) {
        throw new ApiError(404, 'Question not found.', 'question_not_found');
      }
      const updated = await store.questions.update(existing.id, {
        label: input.label,
        helper: input.helper,
        order: input.order,
        updatedAt: new Date().toISOString(),
      });
      res.json({ question: updated });
    }),
  );

  router.get(
    '/admin/contact',
    authenticate,
    requireAdminRead,
    asyncHandler(async (_req, res) => {
      const messages = await store.contactMessages.find();
      messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({ messages });
    }),
  );

  router.patch(
    '/admin/contact/:id',
    authenticate,
    requireAdminWrite,
    asyncHandler(async (req, res) => {
      const input = resolveContactSchema.parse(req.body);
      const existing = await store.contactMessages.get(req.params.id);
      if (!existing) {
        throw new ApiError(404, 'Message not found.', 'contact_not_found');
      }
      const before = { resolvedAt: existing.resolvedAt ?? null };
      const updated = await store.contactMessages.update(existing.id, {
        resolvedAt: input.resolved ? nowIso() : null,
      });
      if (!updated) {
        throw new ApiError(500, 'Could not update the message.', 'update_failed');
      }
      await store.auditLogs.insert({
        id: newId(),
        actorId: req.user?.id ?? 'unknown',
        actorName: req.user?.name ?? req.user?.phone?.slice(-4) ?? 'Admin',
        action: input.resolved ? 'contact.resolve' : 'contact.reopen',
        entity: 'contact',
        entityId: updated.id,
        before,
        after: { resolvedAt: updated.resolvedAt ?? null },
        at: nowIso(),
        ipHash: hashIp(req.ip, config.refreshSecret),
      });
      res.json({ message: updated });
    }),
  );

  return router;
}
