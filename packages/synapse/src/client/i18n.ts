/**
 * SynapseJS - Isomorphic i18n Translation Primitive
 *
 * Lightweight, zero-dependency translation helper for client and server components.
 * Guarantees zero server-leakage when used in client artifacts.
 */

export type TranslationDictionary = Record<string, Record<string, string>>;
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Creates an isomorphic translation function for a given dictionary and locale.
 * Supports interpolation with `{param}` placeholders and graceful fallback.
 *
 * @example
 * const t = createTranslator({
 *   'en': { 'welcome': 'Hello, {name}!' },
 *   'pt-BR': { 'welcome': 'Olá, {name}!' }
 * }, 'pt-BR');
 *
 * t('welcome', { name: 'Maria' }) // 'Olá, Maria!'
 */
export function createTranslator(
  dictionary: TranslationDictionary,
  currentLocale: string,
  fallbackLocale = 'pt-BR'
): TranslateFn {
  const dict = dictionary[currentLocale] ?? dictionary[fallbackLocale] ?? {};
  const fallbackDict = dictionary[fallbackLocale] ?? {};

  return (key: string, params?: Record<string, string | number>): string => {
    let template = dict[key] ?? fallbackDict[key] ?? key;
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        template = template.replaceAll(`{${paramKey}}`, String(paramValue));
      }
    }
    return template;
  };
}
