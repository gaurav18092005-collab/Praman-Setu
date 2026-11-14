import {
  DEFAULT_TRANSLATIONS,
  FIELD_LABELS,
  LOCALES,
  QUESTION_ORDER,
  SEED_SCHEMES,
  flattenTranslations,
  type Answers,
  type LocalizedText,
} from '@pramansetu/shared';
import { config, isProduction } from './config';
import { logger } from './logger';
import type { QuestionDoc, Store, UserDoc } from './store';
import { newId, sha256 } from './store';

/**
 * Development/test-only authenticator seed. The code is deliberately fixed so
 * the demo admin can be exercised in E2E tests; production never seeds users.
 */
export const DEMO_ADMIN_MFA_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const DEMO_ADMIN_RECOVERY_CODE = 'DEMO1-23456';

const HELPERS: Record<string, LocalizedText> = {
  ageGroup: {
    en: 'Age decides pension and scholarship limits. Choose the group that includes your age today.',
    hi: 'आयु से पेंशन और छात्रवृत्ति की सीमा तय होती है। आज आपकी आयु जिस समूह में आती है, उसे चुनें।',
  },
  gender: {
    en: 'Some schemes are only for women, such as widow pension.',
    hi: 'कुछ योजनाएँ केवल महिलाओं के लिए हैं, जैसे विधवा पेंशन।',
  },
  income: {
    en: 'Add up everyone’s income in your household for one year. A rough estimate is fine.',
    hi: 'अपने घर के सभी सदस्यों की एक वर्ष की आय जोड़ें। अनुमानित जानकारी भी ठीक है।',
  },
  category: {
    en: 'Use the category on your official caste certificate. Choose General if you do not have one.',
    hi: 'अपने आधिकारिक जाति प्रमाण पत्र की श्रेणी चुनें। प्रमाण पत्र न हो तो सामान्य चुनें।',
  },
  minority: {
    en: 'A community notified as a minority by the central government, such as Muslim, Christian, Sikh, Buddhist, Jain or Parsi.',
    hi: 'केंद्र सरकार द्वारा अधिसूचित अल्पसंख्यक समुदाय, जैसे मुस्लिम, ईसाई, सिख, बौद्ध, जैन या पारसी।',
  },
  occupation: {
    en: 'What you do most days. This decides which schemes apply to you.',
    hi: 'आप अधिकतर दिन क्या करते हैं। इससे तय होता है कि आपके लिए कौन-सी योजनाएँ हैं।',
  },
  studyLevel: {
    en: 'The class or course you are studying right now.',
    hi: 'आप अभी जिस कक्षा या कोर्स में पढ़ रहे हैं।',
  },
  marks: {
    en: 'Your percentage in the last exam you completed. Approximate is fine.',
    hi: 'पिछली पूरी की गई परीक्षा का प्रतिशत। अनुमानित जानकारी भी ठीक है।',
  },
  ownsLand: {
    en: 'Whether your name appears on farm land records, even if the land is small.',
    hi: 'क्या आपका नाम कृषि भूमि के अभिलेखों में है, चाहे भूमि छोटी हो।',
  },
  maritalStatus: {
    en: 'Widow pension and some support schemes depend on this.',
    hi: 'विधवा पेंशन और कुछ सहायता योजनाएँ इस पर निर्भर करती हैं।',
  },
  disability: {
    en: 'Use the percentage written on your disability certificate. “Not sure” is okay.',
    hi: 'अपने दिव्यांगता प्रमाण पत्र में लिखा प्रतिशत चुनें। “पता नहीं” चुनना भी ठीक है।',
  },
  bpl: {
    en: 'BPL means Below Poverty Line. It is a certificate or card issued by your state, different from an ordinary ration card.',
    hi: 'बीपीएल का अर्थ गरीबी रेखा से नीचे है। यह आपके राज्य द्वारा जारी प्रमाण पत्र या कार्ड है, सामान्य राशन कार्ड से अलग।',
  },
  state: {
    en: 'Optional. Some schemes are state-specific, so this can help later.',
    hi: 'वैकल्पिक। कुछ योजनाएँ राज्य-विशिष्ट होती हैं, इसलिए यह आगे मदद कर सकता है।',
  },
};

export const DEFAULT_QUESTIONS: QuestionDoc[] = QUESTION_ORDER.map((field, index) => ({
  id: `question-${field}`,
  field,
  label: FIELD_LABELS[field],
  helper: HELPERS[field] ?? { en: '', hi: '' },
  order: index + 1,
  updatedAt: new Date('2025-06-30T00:00:00.000Z').toISOString(),
}));

const SELF_ANSWERS: Answers = {
  ageGroup: '26-59',
  gender: 'male',
  income: '1-2.5l',
  category: 'obc',
  minority: 'no',
  occupation: 'farmer',
  ownsLand: 'yes',
  disability: 'none',
  bpl: 'yes',
  state: 'UP',
};

const MOTHER_ANSWERS: Answers = {
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

function now(): string {
  return new Date().toISOString();
}

function demoUser(): UserDoc {
  const created = new Date('2025-06-30T00:00:00.000Z').toISOString();
  const updated = now();
  return {
    id: newId(),
    phone: config.seedDemoPhone,
    name: 'Demo User',
    language: 'en',
    role: 'user',
    status: 'active',
    tokenVersion: 0,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    mfaEnrolledAt: null,
    speechPrefs: { speed: 1, autoReadQuestions: false },
    profiles: [
      {
        id: newId(),
        nickname: 'Self',
        relation: 'self',
        avatarColor: '#1E4080',
        answers: SELF_ANSWERS,
        notSure: {},
        createdAt: created,
        updatedAt: updated,
      },
      {
        id: newId(),
        nickname: 'Mother',
        relation: 'mother',
        avatarColor: '#E8741E',
        answers: MOTHER_ANSWERS,
        notSure: {},
        createdAt: created,
        updatedAt: updated,
      },
    ],
    notificationPrefs: { deadlines: true, schemeUpdates: true, documentNudges: true },
    createdAt: created,
    updatedAt: updated,
  };
}

function adminUser(): UserDoc {
  const created = new Date('2025-06-30T00:00:00.000Z').toISOString();
  return {
    id: newId(),
    phone: config.seedAdminPhone,
    name: 'Pramansetu Admin',
    language: 'en',
    role: 'superadmin',
    status: 'active',
    tokenVersion: 0,
    mfaSecret: isProduction ? null : DEMO_ADMIN_MFA_SECRET,
    mfaRecoveryCodes: isProduction ? [] : [sha256(DEMO_ADMIN_RECOVERY_CODE)],
    mfaEnrolledAt: isProduction ? null : created,
    speechPrefs: { speed: 1, autoReadQuestions: false },
    profiles: [],
    notificationPrefs: { deadlines: false, schemeUpdates: false, documentNudges: false },
    createdAt: created,
    updatedAt: created,
  };
}

export interface SeedOptions {
  includeDemoUsers?: boolean;
}

export async function seedStore(
  store: Store,
  options: SeedOptions = {},
): Promise<{ schemes: number; users: number }> {
  const includeUsers = options.includeDemoUsers ?? true;
  let schemesAdded = 0;
  let usersAdded = 0;

  for (const scheme of SEED_SCHEMES) {
    const existing = await store.schemes.findOne((item) => item.slug === scheme.slug);
    if (existing) continue;
    await store.schemes.insert(structuredClone(scheme));
    schemesAdded += 1;

    const hasVersion = await store.schemeVersions.findOne(
      (item) => item.schemeId === scheme.id && item.version === scheme.version,
    );
    if (!hasVersion) {
      await store.schemeVersions.insert({
        id: newId(),
        schemeId: scheme.id,
        version: scheme.version,
        snapshot: structuredClone(scheme),
        changedBy: 'system',
        changedByName: 'Catalogue import',
        changedAt: scheme.updatedAt,
        diff: [],
        changeNote: 'Initial catalogue import',
      });
    }
  }

  if (includeUsers) {
    for (const factory of [adminUser, demoUser]) {
      const candidate = factory();
      const identifier = candidate.phone;
      const existing = await store.users.findOne((item) => item.phone === identifier);
      if (!existing) {
        await store.users.insert(candidate);
        usersAdded += 1;
      } else if (existing.status === undefined) {
        await store.users.update(existing.id, { status: 'active' });
      }
    }
  }

  const questionCount = await store.questions.count();
  if (questionCount === 0) {
    for (const question of DEFAULT_QUESTIONS) {
      await store.questions.insert(structuredClone(question));
    }
  }

  const translationCount = await store.translations.count();
  if (translationCount === 0) {
    const stamp = new Date('2025-06-30T00:00:00.000Z').toISOString();
    for (const locale of LOCALES) {
      const flat = flattenTranslations(DEFAULT_TRANSLATIONS[locale]);
      for (const [key, value] of Object.entries(flat)) {
        await store.translations.insert({
          id: newId(),
          locale,
          key,
          value,
          reviewed: locale !== 'pa' && locale !== 'ur' && locale !== 'mr',
          updatedAt: stamp,
          updatedBy: 'system',
        });
      }
    }
  }

  if (includeUsers) {
    const demo = await store.users.findOne((item) => item.phone === config.seedDemoPhone);
    if (demo) {
      const applicationCount = await store.applications.count((item) => item.userId === demo.id);
      if (applicationCount === 0) {
        const pmKisan = await store.schemes.findOne(
          (item) => item.slug === 'pm-kisan-samman-nidhi',
        );
        const self = demo.profiles.find((profile) => profile.nickname === 'Self');
        if (pmKisan && self) {
          const startedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
          await store.applications.insert({
            id: newId(),
            userId: demo.id,
            profileId: self.id,
            schemeId: pmKisan.id,
            schemeSlug: pmKisan.slug,
            schemeName: pmKisan.name,
            status: 'documents_ready',
            statusHistory: [
              { status: 'started', at: startedAt, note: 'Application started' },
              {
                status: 'documents_ready',
                at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                note: 'Land records and bank passbook collected',
              },
            ],
            startedAt,
            submittedOn: null,
            deadline: null,
            referenceNo: '',
            docsChecked: ['land-records', 'bank-passbook'],
            notes: 'Waiting to visit the CSC for e-KYC.',
            updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          });
        }
      }

      const notificationCount = await store.notifications.count((item) => item.userId === demo.id);
      if (notificationCount === 0) {
        await store.notifications.insert({
          id: newId(),
          userId: demo.id,
          type: 'document',
          schemeSlug: 'pm-kisan-samman-nidhi',
          message: {
            en: 'Keep your land records ready for PM-KISAN e-KYC.',
            hi: 'PM-KISAN ई-केवाईसी के लिए अपने भूमि अभिलेख तैयार रखें।',
          },
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          readAt: null,
        });
        await store.notifications.insert({
          id: newId(),
          userId: demo.id,
          type: 'scheme_updated',
          schemeSlug: 'post-matric-scholarship-sc',
          message: {
            en: 'A scholarship listing was updated. Check the official portal for current dates.',
            hi: 'एक छात्रवृत्ति सूची में बदलाव हुआ है। वर्तमान तिथियों के लिए आधिकारिक पोर्टल देखें।',
          },
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          readAt: null,
        });
      }
    }
  }

  logger.info({ schemesAdded, usersAdded }, 'Seed complete');
  return { schemes: schemesAdded, users: usersAdded };
}
