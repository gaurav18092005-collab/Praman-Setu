# Pramansetu upgrade progress

## Findings summary (what this upgrade changes)

1. Production config is permissive: `NODE_ENV` defaults to development, demo login only checks for `production`, and secrets/OTP settings are not validated.
2. OTPs can be fixed (`OTP_DEV_CODE`), are hashed with the refresh secret, and attempts reset whenever a new code is issued.
3. OTP sending has no persistent per-identifier hourly/daily limit, no per-IP persistence and no provider circuit breaker.
4. OTP verification is not an atomic compare-and-set, so two parallel requests can both consume a code.
5. OTP messages are English-only, unbranded, lack the WebOTP autofill line and do not support DLT templates per language.
6. Access and refresh tokens are stored in `localStorage`, so any XSS can steal both.
7. Refresh tokens are JWTs returned in JSON, with no HttpOnly cookie, no rotation family audit and no session inventory.
8. CORS has `credentials: false`, state-changing requests have no Origin/CSRF check, and JWTs have no issuer, audience, JWT id or token version.
9. Admins use the same single OTP factor as citizens; there is no TOTP, recovery codes or step-up window.
10. Demo admin/citizen accounts are seeded in every non-production environment and demo login is available whenever `NODE_ENV` is not production.
11. Locale types, schemas, validation and the UI toggle are hard-wired to English and Hindi; seed content and engine explanations are bilingual only.
12. There is no fallback chain for partially translated content, no locale completeness test and no RTL layout or Urdu/Gurmukhi fonts.
13. The app has no read-aloud layer: no voice selection, chunking, page reading, tap-to-hear mode or questionnaire auto-read.
14. There is no optional server TTS route, no speech preferences and no missing-voice guidance.
15. Tests, docs and operational scripts need updating for all of the above while keeping eligibility deterministic and Aadhaar-free.

## Assumptions

- Existing delivery providers stay: MSG91 and Twilio for SMS, Resend/SMTP for email. No new SMS account is created here.
- Server TTS stays feature-flagged **off** by default. `POST /api/tts` returns a clear unavailable error unless a provider is configured.
- TOTP (`otplib`) is the second factor for viewer/editor/admin/superadmin accounts.
- Machine-written Punjabi, Urdu and Marathi copy is marked `reviewed: false`; native review is a launch gate.
- The local file-backed store mirrors MongoDB behaviour for OTP consume, sessions and rate limits. Production requires MongoDB.
- Demo accounts and demo login are development-only and require explicit flags. Production never seeds them.
- Admin tables may remain LTR when the admin uses English; the decision is documented in `docs/TRANSLATION_REVIEW.md`.
- English remains the source of truth for translation keys and the final fallback.

## Part 3 — OTP and authentication security

- [ ] Config: production fail-fast; remove `OTP_DEV_CODE`; add `OTP_PEPPER`, `OTP_EXPOSE_DEV_CODE`, `ENABLE_DEMO_LOGIN`, cookie/session/TTS settings.
- [ ] OTP: crypto-random 6 digits; HMAC-SHA256 with `OTP_PEPPER`; 5-minute TTL; one live code; purpose-bound; atomic consume.
- [ ] Abuse controls: 30s resend, 5/hour + 10/day per identifier, per-IP limit, cross-code failure lockout with back-off, persistent store.
- [ ] Delivery: branded English + localized SMS/email, WebOTP line, per-language MSG91 templates, console dev code only.
- [ ] Sessions: access JWT in memory; opaque hashed refresh token in HttpOnly cookie; rotation, family revoke, token version, session cap.
- [ ] Transport: CORS credentials, Origin allowlist, CSRF header on cookie endpoints, no-store auth responses, stricter headers.
- [ ] Admin: TOTP enrolment/verification, recovery codes, MFA-gated admin routes, 15-minute step-up for destructive actions.
- [ ] Lifecycle: demo/seed flags, admin bootstrap command, logout-all, session list/revoke, delete/change-contact OTP purpose enforcement.
- [ ] Audit: auth events, hashed identifiers/IPs, admin audit filters, secret/OTP/token log redaction.
- [ ] Web: no localStorage tokens, silent cookie refresh, 6-box OTP + WebOTP, MFA page, devices section.
- [ ] Tests: OTP randomness/limits/atomicity, cookies/CSRF/rotation, MFA/roles, unsafe production config, updated E2E.

## Part 1 — Punjabi, Urdu and Marathi

- [ ] Shared locale model: `LOCALES`, `Locale`, `LocalizedText`, `LOCALE_META`, fallback chains, BCP-47/speech/direction metadata.
- [ ] Schemas/store: accept all five locales; migrate existing `en`/`hi` values; remove `'en' | 'hi'` unions.
- [ ] Locale files: complete `pa`, `ur`, `mr` trees matching `en`; register in shared + i18n; completeness/placeholder tests.
- [ ] Content: seed schemes, questions, labels, engine explanations, FAQs, notifications and errors in all five locales.
- [ ] Selector: five-language dropdown/bottom sheet, native names, accessibility, local + account persistence, `<html lang/dir>`.
- [ ] RTL: logical utilities, mirrored directional icons, LTR isolation for numbers/phones/OTP/amounts.
- [ ] Fonts: Gurmukhi + Nastaliq/Naskh, per-language font stacks, taller Urdu line-height, no clipped glyphs.
- [ ] Admin: five-locale columns, completeness filters/percentages, review flags, CSV import/export, missing warnings.
- [ ] Docs/tests: `TRANSLATION_GLOSSARY.md`, `TRANSLATION_REVIEW.md`, unit/API/Playwright locale and RTL coverage.

## Part 2 — Tap-to-listen read aloud

- [ ] Speech engine: provider/context, readable-text extraction, sentence chunking, voice selection/fallback, cue strings.
- [ ] Listen UI: floating 56px button, tray, Listen mode, Read this page, pause/resume/stop, speed, Alt+L.
- [ ] Tap-to-hear: capture-phase interception, highlight, “Do it”, forms/inputs exempt, tray exempt.
- [ ] Page reading: DOM order, skip chrome/hidden/icons, highlight + scroll, stop on navigation/language change.
- [ ] Questionnaire: read question/helper/options, auto-read new questions, document-row reading.
- [ ] Settings: persisted tray/speed/auto-read locally and in account settings; accessibility copy.
- [ ] Missing voice: friendly message, same-script fallback rules, optional server TTS behind flag.
- [ ] Screen readers: ARIA preserved, polite announcements, no unsolicited hijack.
- [ ] Tests/docs: extractor/chunking/voices/cues unit tests, mocked speech tests, Playwright RTL/five-language coverage, `READ_ALOUD.md`.

## Verification log

- Baseline before upgrade: typecheck, 97 unit tests, build, 16/16 Playwright tests passing.
- Part 3: pending
- Part 1: pending
- Part 2: pending
- Final full run: pending

## Manual launch and review steps

1. Set production secrets (`JWT_ACCESS_SECRET`, `OTP_PEPPER`, cookie settings), `NODE_ENV=production`, `MONGODB_URI`, `APP_ORIGIN` (https) and a real OTP provider.
2. Register the DLT sender ID and approved templates for English, Hindi, Punjabi, Urdu and Marathi; set the MSG91 template IDs.
3. Have native speakers proofread `pa`, `ur` and `mr`; flip `reviewed` to true only after sign-off.
4. Confirm the public domain for the WebOTP line in SMS and the `Secure` cookie domain.
5. Choose and configure an optional TTS provider only if online voices are required; review cost/privacy first.
6. Create the first superadmin with `npm run admin:create` and enrol TOTP before inviting other admins.
7. Run `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, and the manual smoke list below.
8. Smoke: switch all five languages; reload; check Urdu RTL; sign in via OTP; wrong-code lockout; refresh restore; devices; admin MFA; Listen mode; page read; questionnaire auto-read.
