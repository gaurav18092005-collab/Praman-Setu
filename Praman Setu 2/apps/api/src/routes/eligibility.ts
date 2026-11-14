import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  ANSWER_FIELDS,
  eligibilityRequestSchema,
  evaluateEligibility,
  localeSchema,
  type AnswerField,
  type Answers,
} from '@pramansetu/shared';
import { z } from 'zod';
import { isTest } from '../config';
import { optionalAuth } from '../auth';
import { ApiError, asyncHandler } from '../errors';
import type { Store } from '../store';
import { newId } from '../store';

const questionStepSchema = z.object({
  field: z.enum(ANSWER_FIELDS),
  locale: localeSchema.default('en'),
  answers: z.record(z.string()).optional(),
  notSure: z.record(z.boolean()).optional(),
});

export function eligibilityRouter(store: Store): Router {
  const router = Router();

  const checkLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
  });

  router.post(
    '/check',
    optionalAuth,
    checkLimiter,
    asyncHandler(async (req, res) => {
      const input = eligibilityRequestSchema.parse(req.body);
      if (input.profileId && req.user) {
        const owns = req.user.profiles.some((profile) => profile.id === input.profileId);
        if (!owns) throw new ApiError(403, 'That profile is not yours.', 'forbidden');
      }
      const schemes = await store.schemes.find((scheme) => scheme.status === 'live');
      const generatedAt = new Date().toISOString();
      const result = evaluateEligibility(schemes, input.answers, {
        profileName: input.profileName,
        notSure: input.notSure,
        locale: input.locale,
      });

      await store.checkEvents.insert({
        id: newId(),
        createdAt: generatedAt,
        answers: input.answers,
        notSure: input.notSure ?? {},
        locale: input.locale ?? 'en',
        eligibleSlugs: result.eligible.map((item) => item.slug),
        needInfoSlugs: result.needMoreInfo.map((item) => item.slug),
        notEligibleSlugs: result.notEligible.map((item) => item.slug),
        status: result.counts.total > 0 ? 'healthy' : 'empty',
      });

      res.json({ ...result, generatedAt });
    }),
  );

  router.post(
    '/question-step',
    checkLimiter,
    asyncHandler(async (req, res) => {
      const input = questionStepSchema.parse(req.body);
      await store.checkEvents.insert({
        id: newId(),
        createdAt: new Date().toISOString(),
        answers: (input.answers ?? {}) as Answers,
        notSure: input.notSure ?? {},
        locale: input.locale,
        eligibleSlugs: [],
        needInfoSlugs: [],
        notEligibleSlugs: [],
        status: 'empty',
        questionStep: input.field as AnswerField,
      });
      res.status(202).json({ ok: true });
    }),
  );

  return router;
}
