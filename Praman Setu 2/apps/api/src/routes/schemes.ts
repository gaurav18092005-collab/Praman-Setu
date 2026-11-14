import { Router } from 'express';
import { schemeCategorySchema, schemeStatusSchema } from '@pramansetu/shared';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../errors';
import type { Store } from '../store';

const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  category: schemeCategorySchema.optional(),
  status: schemeStatusSchema.optional(),
  openNow: z.enum(['true', 'false']).optional(),
});

export function schemesRouter(store: Store): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query = listQuerySchema.parse(req.query);
      const status = query.status ?? 'live';
      let schemes = await store.schemes.find((scheme) => scheme.status === status);

      if (query.category) {
        schemes = schemes.filter((scheme) => scheme.category === query.category);
      }
      if (query.q) {
        const q = query.q.toLowerCase();
        schemes = schemes.filter((scheme) => {
          return (
            scheme.name.en.toLowerCase().includes(q) ||
            Boolean(scheme.name.hi?.includes(query.q as string)) ||
            scheme.launchedBy.en.toLowerCase().includes(q) ||
            Boolean(scheme.launchedBy.hi?.includes(query.q as string))
          );
        });
      }
      if (query.openNow === 'true') {
        const today = new Date().toISOString().slice(0, 10);
        schemes = schemes.filter(
          (scheme) =>
            scheme.openAllYear ||
            (scheme.opensOn &&
              scheme.closesOn &&
              scheme.opensOn <= today &&
              today <= scheme.closesOn),
        );
      }

      schemes.sort((a, b) => {
        const category = a.category.localeCompare(b.category);
        return category !== 0 ? category : a.name.en.localeCompare(b.name.en);
      });

      res.json({
        schemes,
        count: schemes.length,
        lastVerifiedOn: schemes
          .map((scheme) => scheme.lastVerifiedOn)
          .sort()
          .at(-1),
      });
    }),
  );

  router.get(
    '/:slug/history',
    asyncHandler(async (req, res) => {
      const scheme = await store.schemes.findOne((item) => item.slug === req.params.slug);
      if (!scheme || scheme.status !== 'live') {
        throw new ApiError(404, 'Scheme not found.', 'scheme_not_found');
      }
      const versions = await store.schemeVersions.find((version) => version.schemeId === scheme.id);
      versions.sort((a, b) => b.version - a.version);
      res.json({
        scheme: { slug: scheme.slug, name: scheme.name, version: scheme.version },
        history: versions.map((version) => ({
          version: version.version,
          changedAt: version.changedAt,
          changeNote: version.changeNote,
          changedByName: version.changedByName,
          diff: version.diff,
        })),
      });
    }),
  );

  router.get(
    '/:slug',
    asyncHandler(async (req, res) => {
      const scheme = await store.schemes.findOne((item) => item.slug === req.params.slug);
      if (!scheme || scheme.status !== 'live') {
        throw new ApiError(404, 'Scheme not found.', 'scheme_not_found');
      }
      const versionCount = await store.schemeVersions.count(
        (version) => version.schemeId === scheme.id,
      );
      res.json({
        scheme,
        meta: { versionCount, updated: versionCount > 1 },
      });
    }),
  );

  return router;
}
