import fs from 'node:fs';

const base = 'packages/shared/src/locales';
const enPath = `${base}/en.json`;
const hiPath = `${base}/hi.json`;
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const hi = JSON.parse(fs.readFileSync(hiPath, 'utf8'));

Object.assign(en.common, {
  punjabi: 'Punjabi',
  urdu: 'Urdu',
  marathi: 'Marathi',
  open: 'Open',
});

Object.assign(en.auth, {
  otpTitle: 'Enter the 6-digit code',
  otpSentTo: 'We sent a code to {{target}}.',
  otpExpires: 'The code expires in 5 minutes.',
  otpBoxesLabel: '6-digit one-time code',
  wrongNumber: 'Wrong number? Change it',
  locked: 'Too many wrong codes. Try again in {{minutes}} minutes.',
  expired: 'That code expired. Send a new one.',
  incorrect: 'That code is not correct.',
  devNote: 'Development only: the code is shown below and printed in the API terminal.',
  devCode: 'Development code: {{code}}',
  mfaTitle: 'One more step',
  mfaSubtitle: 'Enter the 6-digit code from your authenticator app.',
  mfaCode: 'Authenticator code',
  mfaVerify: 'Confirm and continue',
  mfaEnrollTitle: 'Protect your admin account',
  mfaEnrollBody: 'Scan this QR code with an authenticator app, then enter the 6-digit code.',
  mfaSecretLabel: 'Setup key',
  mfaRecoveryTitle: 'Save these recovery codes',
  mfaRecoveryBody: 'Each code works once. Keep them somewhere safe and offline.',
  mfaRecoveryDone: 'I have saved my codes',
  mfaInvalid: 'That authenticator code is not valid.',
  mfaRequired: 'Admins must set up two-step verification.',
  stepUpTitle: 'Confirm it is you',
  stepUpBody: 'Enter an authenticator code to continue with this sensitive change.',
  stepUpDone: 'Identity confirmed for 15 minutes.',
});

Object.assign(en.settings, {
  languageBody: 'Applies to the interface immediately. Scheme content is available in five languages.',
  devices: 'Devices and sign-outs',
  devicesBody: 'Sign out a device you no longer use, or sign out everywhere.',
  currentDevice: 'This device',
  lastUsed: 'Last used {{date}}',
  revoke: 'Sign out',
  logoutAll: 'Sign out everywhere',
  logoutAllConfirm: 'Sign out of every device, including this one?',
  noOtherSessions: 'No other devices are signed in.',
  sessionRevoked: 'Device signed out.',
  allSignedOut: 'Signed out everywhere.',
  translationReview: 'Translation under review',
  translationReviewBody: 'Punjabi, Urdu and Marathi copy was machine-written. Help us improve it.',
  translationHelp: 'Suggest a correction',
  mfa: 'Two-step verification',
  mfaBody: 'Admins must confirm a second code from an authenticator app.',
  mfaEnabled: 'Two-step verification is on.',
  mfaEnable: 'Set up two-step verification',
  confirmIdentity: 'Confirm identity',
  confirmIdentityBody: 'For sensitive changes, enter a code from your authenticator app.',
  readAloud: 'Read aloud',
});

Object.assign(en.accessibility, {
  c7: 'Every page can be read aloud with the Listen button.',
  c8: 'Urdu pages run right-to-left, while numbers and phone fields stay left-to-right.',
  listenTitle: 'Listening and reading',
  listenBody: 'Use Listen to read a page aloud, or turn on Listen mode and tap any text to hear it.',
});

Object.assign(en.errors, {
  otp_invalid: 'The code is not correct. Please check and try again.',
  otp_expired: 'That code has expired. Send a new code.',
  otp_locked: 'Too many wrong codes. Please wait and try again.',
  otp_rate_limited: 'Too many code requests. Please wait before trying again.',
  otp_cooldown: 'Please wait {{seconds}} seconds before asking for another code.',
  auth_required: 'Please sign in to continue.',
  session_expired: 'Your session expired. Please sign in again.',
  mfa_required: 'Two-step verification is required for this account.',
  mfa_invalid: 'That authenticator code is not valid.',
  mfa_enroll_required: 'Set up two-step verification before continuing.',
  step_up_required: 'Please confirm your identity again to make this change.',
  csrf_failed: 'This request could not be verified. Reload the page and try again.',
  rate_limited: 'Too many requests. Please wait and try again.',
  tts_unavailable: 'Online voice is not available right now.',
  tts_too_long: 'This text is too long to read online.',
  generic: 'Something went wrong. Please try again.',
});

Object.assign(en.admin, {
  translationPa: 'Punjabi',
  translationUr: 'Urdu',
  translationMr: 'Marathi',
  translationCompleteness: 'Complete',
  translationMissing: 'Missing',
  translationMissingFilter: 'Missing in Punjabi, Urdu or Marathi',
  translationReviewed: 'Reviewed',
  translationMarkReviewed: 'Mark as reviewed',
  translationExport: 'Export CSV',
  translationImport: 'Import CSV',
  translationPreview: 'Preview',
  translationImportHint: 'Use the exported CSV columns: key, en, hi, pa, ur, mr, reviewed.',
  translationImported: '{{count}} translations imported.',
  translationImportError: 'The CSV could not be imported. Check the columns and try again.',
  translationAllComplete: 'All five languages are complete.',
  translationNeedsReview: 'Needs native review',
  translationSave: 'Save translation',
  translationLanguage: 'Language',
  missingTranslation: 'Missing {{language}} translation',
  missingTranslations: '{{count}} missing translations',
  validateTranslations: 'Check translations',
  validateTranslationsDone: '{{count}} missing translations across {{schemes}} schemes.',
  fieldName: 'Name',
  fieldDepartment: 'Department',
  fieldBenefit: 'Benefit',
  fieldVerificationNote: 'Verification note',
  docLabel: 'Document label',
  docHint: 'Hint',
  stepText: 'Step',
  questionLabel: 'Label',
  questionHelper: 'Helper',
  languages: 'Languages',
  allLanguages: 'All languages',
});

en.speech = {
  listen: 'Listen',
  title: 'Listen to this page',
  listenMode: 'Tap to hear',
  listenModeOn: 'Listen mode is on. Tap any text to hear it. Use Do it to open it.',
  listenModeOff: 'Listen mode is off.',
  readPage: 'Read this page',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  speed: 'Speed',
  speedSlow: 'Slow',
  speedNormal: 'Normal',
  speedFast: 'Fast',
  autoReadQuestions: 'Read questions automatically',
  autoReadOn: 'Questions will be read aloud.',
  tapAgain: 'Tap again to open',
  doIt: 'Do it',
  open: 'Open',
  highlighted: 'Selected: {{text}}',
  noText: 'Nothing to read here.',
  reading: 'Reading: {{text}}',
  paused: 'Paused.',
  stopped: 'Stopped.',
  finished: 'Finished reading.',
  voiceMissingTitle: 'No {{language}} voice on this device',
  voiceMissingBody:
    'Install a {{language}} voice in your device settings, or choose another language. The page still works without sound.',
  onlineVoice: 'Use online voice',
  onlineVoiceUnavailable: 'Online voice is not available right now.',
  unsupportedTitle: 'Read aloud is not available',
  unsupportedBody:
    "This browser cannot read text aloud. Try Chrome or your device's screen reader.",
  screenReaderNote:
    'If you use a screen reader, Listen mode is optional. It will not take over unless you turn it on.',
  readQuestion: 'Read this question',
  readDocument: 'Read this document',
  status: '{{role}}: {{text}}',
  roleButton: 'Button',
  roleLink: 'Link',
  roleHeading: 'Heading',
  roleOption: 'Option',
  roleSelected: 'Selected',
  roleStep: 'Step {{current}} of {{total}}',
  roleStatus: 'Status',
  roleToggleOn: 'On',
  roleToggleOff: 'Off',
  readAloud: 'Read aloud',
  settingsTitle: 'Read aloud',
  settingsBody: 'Choose how the Listen button speaks. These settings stay on this device.',
  keyboardHint: 'Press Alt+L to open or close Listen.',
};

en.otp = {
  sms: {
    body: 'Your Pramansetu verification code is {{code}}. It is valid for 5 minutes. Do not share this code with anyone. Pramansetu never asks for your Aadhaar number.',
    webotp: '@{{domain}} #{{code}}',
  },
  email: {
    subject: '{{code}} is your Pramansetu code',
    greeting: 'Namaste,',
    body: 'Your Pramansetu verification code is {{code}}. It is valid for 5 minutes.',
    warning:
      'Do not share this code with anyone. Pramansetu never asks for your Aadhaar number.',
    ignore: 'If you did not request this, ignore this email.',
    expiry: 'This code expires in 5 minutes.',
  },
};

Object.assign(hi.common, {
  punjabi: 'पंजाबी',
  urdu: 'उर्दू',
  marathi: 'मराठी',
  open: 'खोलें',
});

Object.assign(hi.auth, {
  otpTitle: '6 अंकों का कोड डालें',
  otpSentTo: 'हमने {{target}} पर कोड भेजा है।',
  otpExpires: 'कोड 5 मिनट में समाप्त हो जाएगा।',
  otpBoxesLabel: '6 अंकों का एक बार वाला कोड',
  wrongNumber: 'गलत नंबर? बदलें',
  locked: 'बहुत बार गलत कोड डाला गया। {{minutes}} मिनट बाद फिर कोशिश करें।',
  expired: 'यह कोड समाप्त हो गया। नया कोड भेजें।',
  incorrect: 'यह कोड सही नहीं है।',
  devNote: 'केवल विकास के लिए: कोड नीचे दिखता है और API टर्मिनल में छपता है।',
  devCode: 'विकास कोड: {{code}}',
  mfaTitle: 'एक और कदम',
  mfaSubtitle: 'अपने ऑथेंटिकेटर ऐप से 6 अंकों का कोड डालें।',
  mfaCode: 'ऑथेंटिकेटर कोड',
  mfaVerify: 'पुष्टि करें और आगे बढ़ें',
  mfaEnrollTitle: 'अपने एडमिन खाते को सुरक्षित करें',
  mfaEnrollBody: 'इस QR कोड को ऑथेंटिकेटर ऐप से स्कैन करें, फिर 6 अंकों का कोड डालें।',
  mfaSecretLabel: 'सेटअप कुंजी',
  mfaRecoveryTitle: 'इन रिकवरी कोडों को सहेजें',
  mfaRecoveryBody: 'हर कोड एक बार काम करता है। इन्हें सुरक्षित और ऑफलाइन रखें।',
  mfaRecoveryDone: 'मैंने अपने कोड सहेज लिए हैं',
  mfaInvalid: 'यह ऑथेंटिकेटर कोड सही नहीं है।',
  mfaRequired: 'एडमिन को दो-चरणीय सत्यापन सेट करना होगा।',
  stepUpTitle: 'पुष्टि करें कि यह आप हैं',
  stepUpBody: 'यह संवेदनशील बदलाव करने के लिए ऑथेंटिकेटर कोड डालें।',
  stepUpDone: '15 मिनट के लिए पहचान की पुष्टि हो गई।',
});

Object.assign(hi.settings, {
  languageBody: 'यह तुरंत इंटरफ़ेस पर लागू होता है। योजना की जानकारी पाँच भाषाओं में उपलब्ध है।',
  devices: 'डिवाइस और साइन-आउट',
  devicesBody: 'जिस डिवाइस का उपयोग नहीं करते उसे साइन आउट करें, या हर जगह से साइन आउट करें।',
  currentDevice: 'यह डिवाइस',
  lastUsed: 'अंतिम उपयोग {{date}}',
  revoke: 'साइन आउट',
  logoutAll: 'हर जगह से साइन आउट',
  logoutAllConfirm: 'इस डिवाइस समेत हर डिवाइस से साइन आउट करें?',
  noOtherSessions: 'कोई अन्य डिवाइस साइन इन नहीं है।',
  sessionRevoked: 'डिवाइस साइन आउट हो गया।',
  allSignedOut: 'हर जगह से साइन आउट हो गया।',
  translationReview: 'अनुवाद समीक्षा में है',
  translationReviewBody: 'पंजाबी, उर्दू और मराठी पाठ मशीन से लिखा गया है। इसे बेहतर बनाने में मदद करें।',
  translationHelp: 'सुधार सुझाएँ',
  mfa: 'दो-चरणीय सत्यापन',
  mfaBody: 'एडमिन को ऑथेंटिकेटर ऐप से दूसरा कोड दर्ज करना होता है।',
  mfaEnabled: 'दो-चरणीय सत्यापन चालू है।',
  mfaEnable: 'दो-चरणीय सत्यापन सेट करें',
  confirmIdentity: 'पहचान की पुष्टि करें',
  confirmIdentityBody: 'संवेदनशील बदलावों के लिए ऑथेंटिकेटर ऐप से कोड डालें।',
  readAloud: 'पढ़कर सुनें',
});

Object.assign(hi.accessibility, {
  c7: 'हर पेज को Listen बटन से पढ़कर सुना जा सकता है।',
  c8: 'उर्दू पेज दाएँ से बाएँ चलते हैं, जबकि संख्या और फ़ोन फ़ील्ड बाएँ से दाएँ रहते हैं।',
  listenTitle: 'सुनना और पढ़ना',
  listenBody: 'Listen से पूरा पेज सुनें, या Listen मोड चालू करके किसी भी टेक्स्ट पर टैप करके सुनें।',
});

Object.assign(hi.errors, {
  otp_invalid: 'कोड सही नहीं है। जाँच करके फिर कोशिश करें।',
  otp_expired: 'यह कोड समाप्त हो गया। नया कोड भेजें।',
  otp_locked: 'बहुत बार गलत कोड डाला गया। कृपया रुककर फिर कोशिश करें।',
  otp_rate_limited: 'बहुत बार कोड माँगा गया। कृपया रुककर फिर कोशिश करें।',
  otp_cooldown: 'दूसरा कोड माँगने से पहले {{seconds}} सेकंड रुकें।',
  auth_required: 'आगे बढ़ने के लिए साइन इन करें।',
  session_expired: 'आपका सत्र समाप्त हो गया। फिर से साइन इन करें।',
  mfa_required: 'इस खाते के लिए दो-चरणीय सत्यापन ज़रूरी है।',
  mfa_invalid: 'यह ऑथेंटिकेटर कोड सही नहीं है।',
  mfa_enroll_required: 'आगे बढ़ने से पहले दो-चरणीय सत्यापन सेट करें।',
  step_up_required: 'यह बदलाव करने के लिए फिर से पहचान की पुष्टि करें।',
  csrf_failed: 'इस अनुरोध की पुष्टि नहीं हो सकी। पेज रीलोड करके फिर कोशिश करें।',
  rate_limited: 'बहुत अधिक अनुरोध। कृपया रुककर फिर कोशिश करें।',
  tts_unavailable: 'ऑनलाइन आवाज़ अभी उपलब्ध नहीं है।',
  tts_too_long: 'यह पाठ ऑनलाइन पढ़ने के लिए बहुत लंबा है।',
  generic: 'कुछ गलत हो गया। फिर कोशिश करें।',
});

Object.assign(hi.admin, {
  translationPa: 'पंजाबी',
  translationUr: 'उर्दू',
  translationMr: 'मराठी',
  translationCompleteness: 'पूर्ण',
  translationMissing: 'अनुपस्थित',
  translationMissingFilter: 'पंजाबी, उर्दू या मराठी में अनुपस्थित',
  translationReviewed: 'समीक्षित',
  translationMarkReviewed: 'समीक्षित चिह्नित करें',
  translationExport: 'CSV निर्यात करें',
  translationImport: 'CSV आयात करें',
  translationPreview: 'पूर्वावलोकन',
  translationImportHint: 'निर्यात की गई CSV के कॉलम: key, en, hi, pa, ur, mr, reviewed.',
  translationImported: '{{count}} अनुवाद आयात हुए।',
  translationImportError: 'CSV आयात नहीं हो सकी। कॉलम जाँचकर फिर कोशिश करें।',
  translationAllComplete: 'पाँचों भाषाएँ पूरी हैं।',
  translationNeedsReview: 'मूल भाषी समीक्षा चाहिए',
  translationSave: 'अनुवाद सहेजें',
  translationLanguage: 'भाषा',
  missingTranslation: '{{language}} अनुवाद अनुपस्थित है',
  missingTranslations: '{{count}} अनुवाद अनुपस्थित',
  validateTranslations: 'अनुवाद जाँचें',
  validateTranslationsDone: '{{schemes}} योजनाओं में {{count}} अनुवाद अनुपस्थित हैं।',
  fieldName: 'नाम',
  fieldDepartment: 'विभाग',
  fieldBenefit: 'लाभ',
  fieldVerificationNote: 'सत्यापन टिप्पणी',
  docLabel: 'दस्तावेज़ का नाम',
  docHint: 'संकेत',
  stepText: 'चरण',
  questionLabel: 'प्रश्न',
  questionHelper: 'सहायक पंक्ति',
  languages: 'भाषाएँ',
  allLanguages: 'सभी भाषाएँ',
});

hi.speech = {
  listen: 'सुनें',
  title: 'इस पेज को सुनें',
  listenMode: 'टैप करके सुनें',
  listenModeOn: 'सुनने का मोड चालू है। किसी भी टेक्स्ट पर टैप करें। खोलने के लिए “करें” दबाएँ।',
  listenModeOff: 'सुनने का मोड बंद है।',
  readPage: 'यह पेज पढ़ें',
  pause: 'रोकें',
  resume: 'जारी रखें',
  stop: 'बंद करें',
  speed: 'गति',
  speedSlow: 'धीमी',
  speedNormal: 'सामान्य',
  speedFast: 'तेज़',
  autoReadQuestions: 'प्रश्न अपने आप पढ़ें',
  autoReadOn: 'प्रश्न पढ़कर सुनाए जाएँगे।',
  tapAgain: 'खोलने के लिए फिर टैप करें',
  doIt: 'करें',
  open: 'खोलें',
  highlighted: 'चुना गया: {{text}}',
  noText: 'यहाँ पढ़ने के लिए कुछ नहीं है।',
  reading: 'पढ़ रहे हैं: {{text}}',
  paused: 'रुका हुआ।',
  stopped: 'बंद।',
  finished: 'पढ़ना पूरा हुआ।',
  voiceMissingTitle: 'इस डिवाइस में {{language}} की आवाज़ नहीं है',
  voiceMissingBody:
    'डिवाइस सेटिंग्स में {{language}} आवाज़ इंस्टॉल करें, या दूसरी भाषा चुनें। बिना आवाज़ के भी पेज काम करता है।',
  onlineVoice: 'ऑनलाइन आवाज़',
  onlineVoiceUnavailable: 'ऑनलाइन आवाज़ अभी उपलब्ध नहीं है।',
  unsupportedTitle: 'पढ़कर सुनाना उपलब्ध नहीं है',
  unsupportedBody: 'यह ब्राउज़र टेक्स्ट नहीं पढ़ सकता। Chrome या डिवाइस का स्क्रीन रीडर आज़माएँ।',
  screenReaderNote:
    'अगर आप स्क्रीन रीडर उपयोग करते हैं, तो सुनने का मोड वैकल्पिक है। आपके चालू किए बिना यह कुछ नहीं करेगा।',
  readQuestion: 'यह प्रश्न पढ़ें',
  readDocument: 'यह दस्तावेज़ पढ़ें',
  status: '{{role}}: {{text}}',
  roleButton: 'बटन',
  roleLink: 'लिंक',
  roleHeading: 'शीर्षक',
  roleOption: 'विकल्प',
  roleSelected: 'चुना गया',
  roleStep: 'चरण {{current}} / {{total}}',
  roleStatus: 'स्थिति',
  roleToggleOn: 'चालू',
  roleToggleOff: 'बंद',
  readAloud: 'पढ़कर सुनें',
  settingsTitle: 'पढ़कर सुनें',
  settingsBody: 'चुनें कि Listen बटन कैसे बोले। ये सेटिंग्स इस डिवाइस पर रहती हैं।',
  keyboardHint: 'Listen खोलने या बंद करने के लिए Alt+L दबाएँ।',
};

hi.otp = {
  sms: {
    body: 'आपका Pramansetu सत्यापन कोड {{code}} है। यह 5 मिनट के लिए मान्य है। यह कोड किसी को न बताएँ। Pramansetu कभी आपका आधार नंबर नहीं माँगता।',
    webotp: '@{{domain}} #{{code}}',
  },
  email: {
    subject: '{{code}} आपका Pramansetu कोड है',
    greeting: 'नमस्ते,',
    body: 'आपका Pramansetu सत्यापन कोड {{code}} है। यह 5 मिनट के लिए मान्य है।',
    warning: 'यह कोड किसी को न बताएँ। Pramansetu कभी आपका आधार नंबर नहीं माँगता।',
    ignore: 'अगर आपने यह कोड नहीं माँगा, तो इस ईमेल को अनदेखा करें।',
    expiry: 'यह कोड 5 मिनट में समाप्त हो जाएगा।',
  },
};

en.home.trust3Title = 'Five languages, one tap away.';
en.home.trust3Body = 'English, Hindi, Punjabi, Urdu and Marathi. Every screen, every result.';
hi.home.trust3Title = 'पाँच भाषाएँ, एक टैप दूर।';
hi.home.trust3Body = 'अंग्रेज़ी, हिंदी, पंजाबी, उर्दू और मराठी। हर स्क्रीन, हर परिणाम।';
en.footer.madeFor = 'Made for citizens, in English, Hindi, Punjabi, Urdu and Marathi.';
hi.footer.madeFor = 'नागरिकों के लिए, अंग्रेज़ी, हिंदी, पंजाबी, उर्दू और मराठी में।';
en.about.languagesBody =
  'Every interface string is available in English, Hindi, Punjabi, Urdu and Marathi. The layout is built for a 360px phone, large touch targets and low bandwidth.';
hi.about.languagesBody =
  'हर इंटरफ़ेस पाठ अंग्रेज़ी, हिंदी, पंजाबी, उर्दू और मराठी में उपलब्ध है। लेआउट 360px फ़ोन, बड़े टच टारगेट और कम बैंडविड्थ के लिए बनाया गया है।';
en.design.typeBody =
  'Noto Serif for headings, Noto Sans for body, with Devanagari, Gurmukhi and Nastaliq/Naskh companions. Each language keeps its own rhythm.';
hi.design.typeBody =
  'शीर्षक के लिए Noto Serif, मुख्य पाठ के लिए Noto Sans, साथ में देवनागरी, गुरमुखी और नस्तालीक/नस्ख। हर भाषा अपनी लय रखती है।';

fs.writeFileSync(enPath, `${JSON.stringify(en, null, 2)}\n`);
fs.writeFileSync(hiPath, `${JSON.stringify(hi, null, 2)}\n`);
console.log('updated en/hi');
