/**
 * Real localization for the languages the app genuinely supports: English, the
 * default, and Albanian.
 *
 * Strings are written in English in the code and wrapped in `t()`; the English
 * text is the key, and `sq.ts` maps it to Albanian. `src/lib/i18n.test.ts` scans
 * every `t("…")` in the source and fails on one with no Albanian entry, so a
 * partial translation cannot ship. Adding a language means adding a complete
 * dictionary — never an entry in the selector alone.
 *
 * The choice lives in a cookie, not only in `localStorage`, because the server
 * renders the page: it reads the cookie per request, so a player who chose
 * Albanian gets Albanian HTML, and the first client render agrees with it.
 * Switching language reloads the page for the same reason — every screen,
 * title and date is rendered again in the new language, with nothing left over.
 */

import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createContext, useContext, type ReactNode } from "react";

import { readWithLegacy, safeLocalStorage } from "@/lib/storage";
import { sq } from "@/lib/i18n/sq";

export type Language = "en" | "sq";

/** Kept for the screens that typed their labels: any English source string. */
export type TranslationKey = string;

const COOKIE = "unbored-language";
const STORAGE_KEY = "unbored-language";
/** Pre-rename key: read once and moved forward by `readWithLegacy`. */
const LEGACY_STORAGE_KEY = "onemore-language";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

function parseLanguage(value: string | null | undefined): Language {
  return value === "sq" ? "sq" : "en";
}

function fromCookieHeader(header: string | null | undefined): Language {
  const match = /(?:^|;\s*)unbored-language=([^;]+)/.exec(header ?? "");
  return parseLanguage(match?.[1]);
}

/**
 * The browser's language for this page load. Read once: changing it reloads the
 * page. A choice stored only in `localStorage` (from before the cookie) is moved
 * into the cookie, and any language no longer offered falls back to English.
 */
let clientLanguage: Language | undefined;

function readClientLanguage(): Language {
  if (clientLanguage) return clientLanguage;
  let language = "en" as Language;
  try {
    if (/(?:^|;\s*)unbored-language=/.test(document.cookie)) {
      language = fromCookieHeader(document.cookie);
    } else {
      language = parseLanguage(readWithLegacy(safeLocalStorage(), STORAGE_KEY, LEGACY_STORAGE_KEY));
      if (language !== "en") writeCookie(language);
    }
  } catch {
    // No document or blocked storage: English.
  }
  clientLanguage = language;
  return language;
}

/** Forgets the language read for this page, so a test can render in another one. */
export function resetLanguageForTests(): void {
  clientLanguage = undefined;
}

function writeCookie(language: Language): void {
  document.cookie = `${COOKIE}=${language}; path=/; max-age=${ONE_YEAR_S}; samesite=lax`;
}

/** The request's language, from its cookie. Outside a request (a prerender), English. */
const requestLanguage = createIsomorphicFn()
  .server((): Language => {
    try {
      return fromCookieHeader(getRequestHeader("cookie"));
    } catch {
      return "en";
    }
  })
  .client((): Language => "en");

/** The language this render is in: the request's cookie on the server, the page's in the browser. */
export function currentLanguage(): Language {
  return typeof window === "undefined" ? (requestLanguage() ?? "en") : readClientLanguage();
}

/**
 * Translates an English source string. `{name}` placeholders are filled from
 * `values`, in either language. A string with no Albanian entry is shown in
 * English rather than as a key; the test suite is what keeps that from shipping.
 */
export function t(
  text: string,
  values?: Record<string, string | number | null | undefined>,
): string {
  const language = currentLanguage();
  const translated = language === "sq" ? (sq[text] ?? text) : text;
  if (!values) return translated;
  return translated.replace(/\{(\w+)\}/g, (whole: string, name: string) =>
    name in values ? String(values[name] ?? "") : whole,
  );
}

/**
 * Marks an English string for translation where it is defined, in data built
 * before any request — a menu, a list of options — without translating it
 * there. The screen that shows it passes it to `t()`. The dictionary test scans
 * `msg("…")` like `t("…")`, so a marked string cannot go untranslated.
 */
export function msg<T extends string>(text: T): T {
  return text;
}

/**
 * Translates text that comes from outside the code — the catalogue, a server's
 * message — when the dictionary knows it, and leaves it as it is otherwise. Not
 * scanned by the test: an edited catalogue entry is simply shown as written.
 */
export function translateContent(text: string): string;
export function translateContent(text: string | null | undefined): string | null | undefined;
export function translateContent(text: string | null | undefined): string | null | undefined {
  if (!text || currentLanguage() !== "sq") return text;
  return sq[text] ?? text;
}

const LanguageContext = createContext<Language>("en");

export function LanguageProvider({ children }: { children: ReactNode }) {
  return <LanguageContext.Provider value={currentLanguage()}>{children}</LanguageContext.Provider>;
}

function setLanguage(next: Language): void {
  if (next === currentLanguage()) return;
  try {
    writeCookie(next);
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Best effort: the cookie is what matters.
  }
  window.location.reload();
}

export function useLanguage(): {
  language: Language;
  setLanguage: (next: Language) => void;
  t: typeof t;
} {
  const language = useContext(LanguageContext);
  return { language, setLanguage, t };
}

/** The languages a player can choose. English is the default. */
export const offeredLanguages: Array<{ code: Language; label: string; native: string }> = [
  { code: "en", label: msg("English"), native: "English" },
  { code: "sq", label: msg("Albanian"), native: "Shqip" },
];
