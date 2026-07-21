import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLanguageFromUrl } from '@/js/i18n/i18n';

describe('getLanguageFromUrl', () => {
  const originalLocation = window.location;
  const originalNavigator = window.navigator;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, pathname: '/' },
      writable: true,
      configurable: true,
    });

    localStorage.clear();

    // Reset navigator
    Object.defineProperty(window, 'navigator', {
      value: { ...originalNavigator },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'languages', {
      value: [],
      configurable: true,
    });

    // Reset import.meta.env. Default to no build-time language so the
    // navigator-based tests below exercise browser detection; tests that need a
    // default set it explicitly.
    vi.stubEnv('BASE_URL', '/');
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', '');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    vi.unstubAllEnvs();
  });

  it('should return language from URL path', () => {
    window.location.pathname = '/de/about';
    expect(getLanguageFromUrl()).toBe('de');
  });

  it('should prioritize URL path over localStorage', () => {
    window.location.pathname = '/fr/';
    localStorage.setItem('i18nextLng', 'es');
    expect(getLanguageFromUrl()).toBe('fr');
  });

  it('should return language from localStorage if URL has no language', () => {
    window.location.pathname = '/about';
    localStorage.setItem('i18nextLng', 'it');
    expect(getLanguageFromUrl()).toBe('it');
  });

  it('should return exact match from navigator.languages', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['zh-TW', 'en-US', 'en'],
      configurable: true,
    });
    expect(getLanguageFromUrl()).toBe('zh-TW');
  });

  it('should return primary language match from navigator.languages', () => {
    window.location.pathname = '/';
    // 'de-AT' is not in supportedLanguages, but we should match its primary 'de'
    Object.defineProperty(window.navigator, 'languages', {
      value: ['de-AT', 'en-US', 'en'],
      configurable: true,
    });
    expect(getLanguageFromUrl()).toBe('de');
  });

  it('should return first matched language from navigator.languages', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['fr-CA', 'de-DE', 'en'],
      configurable: true,
    });
    expect(getLanguageFromUrl()).toBe('fr');
  });

  it('should ignore unsupported languages in navigator.languages', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['xx-XX', 'es-ES'],
      configurable: true,
    });
    expect(getLanguageFromUrl()).toBe('es');
  });

  it('should fallback to env variable if no earlier match', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['xx'],
      configurable: true,
    }); // unsupported
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', 'vi');
    expect(getLanguageFromUrl()).toBe('vi');
  });

  it('should let the build-time default override a supported browser language', () => {
    // Headers PDF ships with VITE_DEFAULT_LANGUAGE=pt; a visitor whose browser
    // is English must still get PT-BR at the root URL (env beats navigator).
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['en-US', 'en'],
      configurable: true,
    });
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', 'pt');
    expect(getLanguageFromUrl()).toBe('pt');
  });

  it('should still honor an explicit URL/localStorage choice over the default', () => {
    window.location.pathname = '/en/';
    localStorage.setItem('i18nextLng', 'de');
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', 'pt');
    // URL prefix wins over both localStorage and the build-time default.
    expect(getLanguageFromUrl()).toBe('en');
  });

  it('should fallback to en if everything else fails', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: [],
      configurable: true,
    });
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', '');
    expect(getLanguageFromUrl()).toBe('en');
  });

  it('should handle missing navigator object gracefully', () => {
    window.location.pathname = '/';
    Object.defineProperty(window, 'navigator', {
      value: undefined,
      writable: true,
    });
    expect(getLanguageFromUrl()).toBe('en');
  });
});
