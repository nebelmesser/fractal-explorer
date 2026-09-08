import { persistLocale, pickLocale } from '@nebelmesser/narration';

export type UiFile = {
  source_lang: string;
  locales: string[];
  locale_names: Record<string, string>;
  strings: Record<string, Record<string, string>>;
};

const FALLBACK: UiFile = {
  source_lang: 'ru',
  locales: ['ru', 'en'],
  locale_names: { ru: 'Русский', en: 'English' },
  strings: {},
};

let catalog: UiFile = FALLBACK;
let locale = FALLBACK.source_lang;
const listeners = new Set<() => void>();

export function uiLocale(): string {
  return locale;
}

export function t(key: string): string {
  return catalog.strings[locale]?.[key]
    || catalog.strings[catalog.source_lang]?.[key]
    || key;
}

export function onUiChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function syncSelect(): void {
  const select = document.getElementById('narration-locale');
  if (select instanceof HTMLSelectElement) select.value = locale;
}

export function applyUi(): void {
  document.documentElement.lang = locale;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (!key) continue;
    el.textContent = t(key);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    const key = el.getAttribute('data-i18n-aria');
    if (key) el.setAttribute('aria-label', t(key));
  }
  for (const el of document.querySelectorAll('[data-i18n-content]')) {
    const key = el.getAttribute('data-i18n-content');
    if (key) el.setAttribute('content', t(key));
  }
}

export function setUiLocale(next: string): void {
  if (!catalog.locales.includes(next)) return;
  if (locale === next) {
    syncSelect();
    return;
  }
  locale = next;
  persistLocale(locale);
  syncSelect();
  applyUi();
  for (const fn of listeners) fn();
}

function bindLocaleSelect(): void {
  const select = document.getElementById('narration-locale');
  if (!(select instanceof HTMLSelectElement)) return;
  select.replaceChildren();
  for (const code of catalog.locales) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = catalog.locale_names[code] || code;
    select.append(option);
  }
  select.value = locale;
  if (select.dataset.i18nBound === '1') return;
  select.dataset.i18nBound = '1';
  select.addEventListener('change', () => setUiLocale(select.value));
}

export async function loadUi(): Promise<void> {
  try {
    const response = await fetch(new URL('narration/ui.json', document.baseURI));
    if (response.ok) catalog = (await response.json()) as UiFile;
  } catch (error) {
    console.warn('[i18n] failed to load ui.json', error);
  }
  if (!catalog.locales?.length) catalog = FALLBACK;
  locale = pickLocale(catalog.locales, catalog.source_lang, location.search);
  persistLocale(locale);
  bindLocaleSelect();
  applyUi();
}
