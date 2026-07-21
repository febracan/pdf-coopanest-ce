import i18next from 'i18next';
import HttpBackend from 'i18next-http-backend';

export const supportedLanguages = [
  'en',
  'ar',
  'be',
  'ru',
  'fr',
  'de',
  'es',
  'zh',
  'zh-TW',
  'vi',
  'tr',
  'id',
  'it',
  'pt',
  'nl',
  'da',
  'sv',
  'ko',
  'ja',
  'uk',
  'sk',
] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  ar: 'العربية',
  be: 'Беларуская',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  zh: '中文',
  'zh-TW': '繁體中文（台灣）',
  vi: 'Tiếng Việt',
  tr: 'Türkçe',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  da: 'Dansk',
  sv: 'Svenska',
  ko: '한국어',
  ja: '日本語',
  uk: 'Українська',
  sk: 'Slovenčina',
};

const LANG_PREFIX =
  'en|ar|fr|es|de|zh|zh-TW|vi|tr|id|it|pt|nl|be|da|ko|sv|ru|ja|uk|sk';

const stripBasePath = (pathname: string, basePath: string): string => {
  let path = pathname;
  if (basePath && basePath !== '/' && path.startsWith(basePath)) {
    path = path.slice(basePath.length) || '/';
  }
  return path.startsWith('/') ? path : '/' + path;
};

const isSupported = (
  value: string | null | undefined
): value is SupportedLanguage =>
  !!value && supportedLanguages.includes(value as SupportedLanguage);

export const getLanguageFromUrl = (): SupportedLanguage => {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = stripBasePath(window.location.pathname, basePath);

  const langMatch = path.match(new RegExp(`^\\/(${LANG_PREFIX})(?:\\/|$)`));
  if (langMatch && isSupported(langMatch[1])) {
    return langMatch[1];
  }

  const storedLang = localStorage.getItem('i18nextLng');
  if (isSupported(storedLang)) {
    return storedLang;
  }

  const envLang = import.meta.env?.VITE_DEFAULT_LANGUAGE;
  if (isSupported(envLang)) {
    return envLang;
  }

  if (typeof navigator !== 'undefined' && navigator.languages) {
    for (const lang of navigator.languages) {
      if (isSupported(lang)) {
        return lang;
      }
      const primaryLang = lang.split('-')[0];
      if (isSupported(primaryLang)) {
        return primaryLang;
      }
    }
  }

  return 'en';
};

let initialized = false;

export const initI18n = async (): Promise<typeof i18next> => {
  if (initialized) return i18next;

  const currentLang: SupportedLanguage = 'pt';

  localStorage.setItem('i18nextLng', currentLang);

  await i18next.use(HttpBackend).init({
    lng: currentLang,
    fallbackLng: 'pt',
    supportedLngs: supportedLanguages as unknown as string[],
    ns: ['common', 'tools'],
    defaultNS: 'common',
    preload: [currentLang],
    backend: {
      loadPath: `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}locales/{{lng}}/{{ns}}.json`,
    },
    interpolation: {
      escapeValue: false,
    },
  });

  await i18next.loadNamespaces('tools');

  initialized = true;
  return i18next;
};

export const t = (key: string, options?: Record<string, unknown>): string => {
  return i18next.t(key, options);
};

export const changeLanguage = (lang: SupportedLanguage): void => {
  if (!supportedLanguages.includes(lang)) return;
  localStorage.setItem('i18nextLng', lang);

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const relativePath = stripBasePath(window.location.pathname, basePath);

  let pagePath = relativePath;
  const langPrefixMatch = relativePath.match(
    new RegExp(`^\\/(${LANG_PREFIX})(\\/.*)?$`)
  );
  if (langPrefixMatch) {
    pagePath = langPrefixMatch[2] || '/';
  }
  if (!pagePath.startsWith('/')) {
    pagePath = '/' + pagePath;
  }

  const newRelativePath = lang === 'en' ? pagePath : `/${lang}${pagePath}`;

  let newPath =
    basePath && basePath !== '/' ? basePath + newRelativePath : newRelativePath;
  newPath = newPath.replace(/\/+/g, '/');

  window.location.href =
    newPath + window.location.search + window.location.hash;
};

export const applyTranslations = (): void => {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    if (key) {
      const translation = t(key);
      if (translation && translation !== key) {
        element.textContent = translation;
      }
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const key = element.getAttribute('data-i18n-placeholder');
    if (key && element instanceof HTMLInputElement) {
      const translation = t(key);
      if (translation && translation !== key) {
        element.placeholder = translation;
      }
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    const key = element.getAttribute('data-i18n-title');
    if (key) {
      const translation = t(key);
      if (translation && translation !== key) {
        (element as HTMLElement).title = translation;
      }
    }
  });

  document.documentElement.lang = i18next.language;
  document.documentElement.dir = i18next.language === 'ar' ? 'rtl' : 'ltr';
};

export const rewriteLinks = (): void => {
  const currentLang = getLanguageFromUrl();
  if (currentLang === 'en') return;

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const escapedBase = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const langPrefixRegex = new RegExp(
    `^(${escapedBase})?/?(${LANG_PREFIX})(/|$)`
  );

  document.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    if (
      href.startsWith('http') ||
      href.startsWith('//') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      href.startsWith('data:') ||
      href.startsWith('vbscript:')
    ) {
      return;
    }

    if (href.includes('/assets/')) {
      return;
    }

    if (langPrefixRegex.test(href)) {
      return;
    }

    let newHref: string;
    if (basePath && basePath !== '/' && href.startsWith(basePath)) {
      const pathAfterBase = href.slice(basePath.length);
      newHref = `${basePath}/${currentLang}${pathAfterBase}`;
    } else if (href.startsWith('/')) {
      newHref =
        basePath && basePath !== '/'
          ? `${basePath}/${currentLang}${href}`
          : `/${currentLang}${href}`;
    } else if (href === '' || href === 'index.html') {
      newHref =
        basePath && basePath !== '/'
          ? `${basePath}/${currentLang}/`
          : `/${currentLang}/`;
    } else {
      newHref = `/${currentLang}/${href}`;
    }

    newHref = newHref.replace(/([^:])\/+/g, '$1/');

    link.setAttribute('href', newHref);
  });
};

export default i18next;
