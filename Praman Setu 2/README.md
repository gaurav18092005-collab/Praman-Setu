# Pramansetu

**Know what you can claim. Carry what you need.**

Pramansetu is an independent, mobile-first guide to Indian central government
benefits. A citizen answers 13 plain-language questions and gets a transparent
list of schemes they may qualify for, the documents to carry, and a link to the
official portal.

Pramansetu is **not** a government service and never claims to be. Every result
renders:

> Pramansetu is a guide. The official portal makes the final decision.

Eligibility is decided **only** by a deterministic rule engine. No AI model ever
decides, ranks, or explains eligibility. The engine is pure TypeScript and runs
on the server; the same code is unit-tested in `packages/shared`.

---

## Contents

- [What is in the box](#what-is-in-the-box)
- [Stack](#stack)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [How eligibility works](#how-eligibility-works)
- [Data verification](#data-verification)
- [Admin panel](#admin-panel)
- [Privacy and security](#privacy-and-security)
- [Testing](#testing)
- [Accessibility and PWA](#accessibility-and-pwa)
- [Deployment](#deployment)
- [API overview](#api-overview)
- [Assumptions and scope](#assumptions-and-scope)

---

## What is in the box

- **Citizen experience** — a signed-in home dashboard with at-a-glance counts,
  quick actions and the family section; scheme library and detail pages,
  13-question check, review, calculating, results, per-scheme explanation,
  document checklist, compare, print/share, notifications, applications, family
  profiles with a detail view for reviewing and editing saved answers, settings,
  onboarding, about/privacy/accessibility/contact, offline and 404.
- **Admin panel** — dashboard, scheme list, rule builder, version history,
  field-level diff and compare, rollback (as a new version), question manager,
  translation editor, user roles, audit log, contact inbox.
- **Bilingual copy** — all citizen and admin strings live in
  `packages/shared/src/locales/{en,hi}.json`. One-tap switch, persisted across
  reloads, with an admin-editable override layer stored in MongoDB.
- **10 real central schemes** across pensions, scholarships and welfare. Values
  that could not be confirmed are marked `VERIFY`; see
  [`docs/DATA_VERIFICATION.md`](docs/DATA_VERIFICATION.md).
- **Two storage modes** — file-backed JSON store for zero-setup development and
  tests, MongoDB/Mongoose when `MONGODB_URI` is set.

## Stack

| Layer   | Choices                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Web     | React 18, Vite 6, TypeScript strict, Tailwind CSS, React Router 6, TanStack Query 5, react-i18next, Framer Motion, Lucide, `vite-plugin-pwa` |
| API     | Node.js, Express 4, TypeScript, Zod, JWT access + refresh (rotating, hashed at rest), helmet, CORS allowlist, rate limiting, pino            |
| Data    | MongoDB + Mongoose in production; file-backed store otherwise                                                                                |
| Shared  | Pure TypeScript types, question flow, rule engine, Zod schemas, seed catalogue, locale copy                                                  |
| Quality | Vitest, Supertest, Testing Library, Playwright (Chromium + Pixel 5), ESLint, Prettier                                                        |

## Quick start

Requirements: **Node.js ≥ 20** and npm 10+. MongoDB is optional.

```bash
npm install
cp .env.example apps/api/.env
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000 (health check: `/health`)

The API seeds the 10 schemes, translations, a super-admin and a demo citizen on
first boot. With no `MONGODB_URI`, data persists to `apps/api/.data/db.json`.
The example enables demo sign-in for local development; keep
`ENABLE_DEMO_LOGIN=false` in any shared or deployed environment.

To use MongoDB, copy the example env and set the connection string:

```bash
cp .env.example apps/api/.env
# then set MONGODB_URI=mongodb+srv://...
```

## Demo accounts

Development seeds (never created when `NODE_ENV=production`; demo sign-in also
requires `ENABLE_DEMO_LOGIN=true`):

| Role        | Phone        | How to sign in                                           |
| ----------- | ------------ | -------------------------------------------------------- |
| Super-admin | `9999999999` | “Sign in as demo admin” on `/sign-in`, or request an OTP |
| Citizen     | `9876543210` | “Sign in as demo user”, or request an OTP                |

The console OTP provider prints the code and can return it to the client in
development when `OTP_EXPOSE_DEV_CODE=true`. `/api/auth/demo-login` is disabled
in production.

## Environment variables

Copy `.env.example` to `apps/api/.env`. The web app reads `VITE_*` variables
from `apps/web/.env`.

| Variable                                   | Default                     | Notes                                                            |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`                                 | `development`               | Production enforces strong secrets and MongoDB                   |
| `PORT`                                     | `4000`                      | API port                                                         |
| `APP_ORIGIN`                               | `http://localhost:5173`     | Public web origin                                                |
| `CORS_ORIGINS`                             | `http://localhost:5173`     | Comma-separated allowlist                                        |
| `MONGODB_URI`                              | —                           | Required in production; file store when absent                   |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev placeholders            | ≥16 chars; dev values are rejected in production                 |
| `ACCESS_TOKEN_TTL`                         | `15m`                       | Access token lifetime                                            |
| `REFRESH_TOKEN_DAYS`                       | `30`                        | Refresh token lifetime                                           |
| `OTP_PROVIDER`                             | `console`                   | `console`, `msg91`, `twilio`, `email`                            |
| `OTP_DEV_CODE`                             | —                           | Fixed 4–8 digit code for development                             |
| `OTP_TTL_MINUTES` / `OTP_MAX_ATTEMPTS`     | `10` / `5`                  | OTP policy                                                       |
| `MSG91_*`, `TWILIO_*`, `RESEND_API_KEY`    | —                           | Provider credentials (`MSG91_TEMPLATE_ID` is required for MSG91) |
| `MAIL_FROM`                                | `no-reply@pramansetu.app`   | From address for email OTP                                       |
| `AI_EXPLANATIONS`                          | `false`                     | Reserved; eligibility never uses AI                              |
| `SEED_ADMIN_PHONE` / `SEED_DEMO_PHONE`     | `9999999999` / `9876543210` | Seed accounts                                                    |
| `STORE_FILE`                               | `.data/db.json`             | File-store location                                              |
| `VITE_API_URL`                             | —                           | Absolute API URL; empty uses same-origin `/api`                  |
| `VITE_API_PROXY`                           | `http://localhost:4000`     | Dev proxy target                                                 |

## Scripts

Run from the repository root:

```bash
npm run dev            # API + web together
npm run dev:api        # API only
npm run dev:web        # web only
npm run build          # shared → API → web production builds
npm run typecheck      # strict TS across all workspaces
npm test               # Vitest suites (shared, API, web)
npm run test:e2e       # Playwright (starts both servers)
npm run seed           # re-run the API seed
npm run lint           # ESLint
npm run format         # Prettier write
```

## Project structure

```
apps/
  api/                 Express API
    src/
      routes/          auth, profiles, eligibility, schemes, admin, content…
      store/           file + Mongo stores
      seed.ts          idempotent seed
  web/                 React PWA
    src/
      pages/           citizen screens
      pages/admin/     admin screens
      components/      layout, brand, UI primitives, guards
      lib/             api client, auth, check state, hooks, utils
    e2e/               Playwright specs
packages/
  shared/
    src/
      engine.ts        deterministic eligibility engine
      questions.ts     13-question flow and conditional logic
      seed.ts          10-scheme catalogue
      locales/         en.json, hi.json
      schemas.ts       Zod contracts shared by web and API
docs/
  DATA_VERIFICATION.md
```

## How eligibility works

1. The questionnaire collects 13 answers. Conditional questions appear only when
   relevant (`studyLevel`/`marks` for students, `ownsLand` for farmers,
   `maritalStatus` for women aged 18+). Every question offers **Not sure**.
2. `POST /api/eligibility/check` validates the payload with Zod, rejects anything
   that looks like an Aadhaar number, and calls `evaluateEligibility` from
   `@pramansetu/shared`.
3. The engine returns three buckets — **eligible**, **need more information**,
   **not eligible** — plus a plain-language reason for each scheme and a list of
   missing answers. “Not sure” is missing information, never a rejection.
4. The API adds `generatedAt` and returns only live schemes. The UI shows the
   mandatory disclaimer and the official portal link on every result.

The engine is a pure function of (answers, schemes): no network, no model, no
randomness. Its behaviour is locked down by 54 shared tests, including band
comparisons (`gte: 60-79` includes `80plus`) and not-sure handling.

## Data verification

Scheme facts are a snapshot. The catalogue was reviewed on **30 June 2025**, and
unconfirmed values are flagged rather than presented as fact. The full record —
portal URLs, confirmed fields, `VERIFY` fields, and the re-verification checklist
— is in [`docs/DATA_VERIFICATION.md`](docs/DATA_VERIFICATION.md).

To change scheme data, prefer the admin rule editor. Every edit creates a new
`schemeVersion` with a field-level diff and an audit entry; rollback restores a
snapshot as a **new** version, so history is never rewritten.

## Admin panel

Admins reach `/admin` after signing in. Read access is granted to `viewer`,
`editor`, `admin` and `superadmin`; writes require `editor` or above; role
changes require `superadmin`.

- **Schemes** — filter, create, edit, publish/unpublish.
- **Rule builder** — add/remove rules per scheme, reorder, mark a rule as
  `VERIFY`, and edit benefit/documents/procedure copy in both languages.
- **History / Compare** — inspect every version, diff any two, roll back.
- **Questions** — enable/disable questions and edit labels and help text.
- **Translations** — edit EN/HI overrides; bundled copy remains the fallback.
- **Users** — search, filter by role, change roles (super-admin only).
- **Audit** — every write with actor, action, entity, and before/after values.
- **Contact** — read messages, mark resolved, reopen; both actions are audited.

When a live scheme is updated, users with applications against it receive a
notification.

## Privacy and security

- **No Aadhaar numbers.** The API rejects Aadhaar-shaped values in request
  bodies; the UI never asks for one. Aadhaar appears only as a document to carry
  to the official portal.
- **PII minimisation.** The check works without an account. Stored profiles hold
  nickname, relation and answers, not identity numbers.
- **Refresh tokens** are random, stored hashed, rotated on every use, and
  reuse-detected. Access tokens live in memory/localStorage per the client
  contract; there are no third-party analytics scripts.
- **Hardening.** Helmet, explicit CORS allowlist, 300 req/min global rate limit,
  stricter auth limits, 100 kb JSON limit, request IDs, pino structured logs,
  and Zod validation at every boundary.
- **Admin safety.** Role checks on the server, field-level audit trail,
  append-only version history, immutable rollback targets.
- **Disclaimer.** The “not affiliated with any government department” line is in
  the footer, about page, every result and the PWA manifest description. The logo
  is an original bridge-and-wheel mark; no government emblem is used.

## Testing

```bash
npm test          # 54 shared + 29 API + 14 web tests
npm run test:e2e  # 16 Playwright tests across desktop and Pixel 5
```

- Shared: engine buckets, band logic, not-sure handling, question flow, copy
  flattening.
- API: auth/refresh rotation, OTP, profiles, eligibility contract, admin
  versioning, rollback, audit, translations, contact resolution.
- Web: utilities, status badges, disclaimer rendering.
- E2E: home → check, full questionnaire → results with disclaimer and portal
  link, scheme search → detail, language switch + reload, private route
  redirect, family member add → detail → edit → delete, demo admin →
  dashboard/users, admin scheme → rule editor.

## Accessibility and PWA

- Mobile-first from 360 px; 48 px minimum touch targets; a persistent mobile
  bottom nav with safe-area padding.
- Skip link, semantic landmarks, visible focus rings, labelled form controls,
  `aria-live` status regions, and reduced-motion support.
- Noto Serif for headings and Noto Sans for body text, with Devanagari support.
- Installable PWA with an auto-updating service worker, offline fallback, and
  NetworkFirst caching for schemes so the library survives a dropped connection.
- Language choice persists across reloads; every screen and result is translated.

## Deployment

The repo ships configs for a split deployment: static web on Vercel, API on
Render, MongoDB Atlas for data.

### Web (Vercel)

`vercel.json` at the repository root builds the web workspace and rewrites all
client routes to `index.html`. Set:

- `VITE_API_URL` — public API origin, e.g. `https://pramansetu-api.onrender.com`
  (leave empty only if the API is proxied on the same origin).

### API (Render)

`render.yaml` defines a Node web service:

- Build: `npm ci --include=dev && npm run build -w @pramansetu/api`
  (`NODE_ENV=production` is set for this service, so dev dependencies such as
  `tsup` must be installed explicitly during the build)
- Start: `node apps/api/dist/index.js`
- Health check: `/health`
- Required env: `NODE_ENV=production`, `MONGODB_URI`, strong
  `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, `CORS_ORIGINS` including the
  Vercel domain.
- Required for citizen sign-in: `OTP_PROVIDER` (`msg91`, `twilio` or `email`)
  plus the matching credentials. The console provider is refused in production,
  so OTP requests return `503` until a real provider is configured.
- Optional env: `SEED_ADMIN_PHONE`, `MAIL_FROM`, OTP lifetime/attempt limits.

Example provider settings:

- MSG91: `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` (DLT-approved OTP template),
  `MSG91_SENDER_ID`.
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
- Email: `RESEND_API_KEY`, `MAIL_FROM`.

Run `npm run seed` once against the production database (or use the admin panel)
to publish the initial catalogue. Demo users and the demo login endpoint are not
created in production.

### CI

`.github/workflows/ci.yml` runs lint, formatting, typecheck, unit tests and
the production build on every push and pull request, then the Playwright suite
on Chromium (desktop and Pixel 5).

## API overview

All routes are under `/api`, except `/health`.

| Area          | Endpoints                                                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | `POST /auth/request-otp`, `/auth/verify-otp`, `/auth/refresh`, `/auth/logout`, `/auth/demo-login` (dev), `GET /auth/me`                                                                                                 |
| Profiles      | `GET/POST /profiles`, `GET/PUT/DELETE /profiles/:id`                                                                                                                                                                    |
| Account       | `GET/PATCH /account`, `DELETE /account`                                                                                                                                                                                 |
| Eligibility   | `POST /eligibility/check`                                                                                                                                                                                               |
| Schemes       | `GET /schemes`, `GET /schemes/:slug`, `GET /schemes/:slug/history`                                                                                                                                                      |
| Applications  | `GET/POST /applications`, `GET/PATCH/DELETE /applications/:id`                                                                                                                                                          |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`                                                                                                                                                                   |
| Admin         | `GET /admin/dashboard`, `/admin/schemes`, `/admin/schemes/:id/versions`, `/admin/audit`, `/admin/users`, `/admin/contact`; writes for create/update/rollback/compare, questions, translations, roles and contact status |
| Content       | `GET /questions`, `GET /translations`, `POST /contact`                                                                                                                                                                  |

Errors are JSON: `{ "error": { "code", "message", "details?" } }`. Auth uses
`Authorization: Bearer <accessToken>`.

## Assumptions and scope

- **Central schemes only.** State and district schemes are excluded until their
  rules can be verified independently.
- **Guide, not decision.** The result is an explanation of published rules, not
  an entitlement. The official portal always decides.
- **OTP is pluggable.** Console delivery is the default for local development;
  production should configure MSG91, Twilio or email.
- **AI is off by default** and is never part of eligibility. `AI_EXPLANATIONS`
  exists only as a future, optional copy aid.
- **Demo data is development-only.** Production starts with the verified
  catalogue and the configured admin phone, nothing else.

---

Built as an independent civic tool. Not affiliated with any government
department. No Aadhaar. The official portal makes the final decision.
