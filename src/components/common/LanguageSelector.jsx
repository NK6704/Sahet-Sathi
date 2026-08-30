import React from 'react';
import { Check, Languages } from 'lucide-react';
import { SUPPORTED_LANGUAGES, isHindiLang } from '@/services/i18n';

/* =============================================================
   The language control, in two sizes.

   LanguageChoice  the landing page, where the language for the
                   whole service is chosen. Large enough to be
                   unmissable on a cheap phone.
   LanguageSelector a compact select for Settings and the header,
                   once the choice has already been made.

   Both offer the two languages the interface is actually written
   in. SUPPORTED_LANGUAGES lists ten because speech recognition
   accepts ten, but TRANSLATIONS holds English and Hindi only —
   getT() renders every other name in English. Offering Odia here
   would therefore promise a screen this app cannot draw.

   The names come from SUPPORTED_LANGUAGES rather than being typed
   out, because the stored string is read by getT(), by
   isHindiLang() and by VoiceController.setLanguage(), all of
   which match on that exact spelling.
   ============================================================= */

const INTERFACE_LANGUAGE_CODES = ['en', 'hi'];

const INTERFACE_LANGUAGES = INTERFACE_LANGUAGE_CODES.map((code) =>
  SUPPORTED_LANGUAGES.find((lang) => lang.code === code),
).filter(Boolean);

/**
 * The offered name that matches a stored value.
 *
 * A profile saved before this control narrowed to two languages may
 * still hold 'ଓଡ଼ିଆ'. isHindiLang() reads that as not-Hindi and the
 * app renders it in English, so English is what the control shows —
 * a select left with no matching option would simply appear blank.
 * English is also the answer for an absent value, which is the
 * default the whole app runs on.
 */
function offeredName(language) {
  const code = isHindiLang(language) ? 'hi' : 'en';
  const match = INTERFACE_LANGUAGES.find((lang) => lang.code === code);
  return match?.name ?? 'English';
}

export function LanguageSelector({ language, setLanguage, className = '' }) {
  return (
    <label
      id="control-language-selector"
      className={`inline-flex items-center gap-2 rounded-full border border-rule bg-paper-2 px-3 py-1.5
        text-[0.8rem] font-semibold text-ink transition-colors hover:border-ink
        focus-within:border-seal ${className}`}
      data-testid="control-language"
    >
      <Languages size={15} className="shrink-0 text-asha" aria-hidden="true" />
      <span className="sr-only">Choose language</span>
      <select
        id="select-app-language"
        aria-label="Choose language"
        value={offeredName(language)}
        onChange={(e) => setLanguage(e.target.value)}
        className="cursor-pointer bg-transparent font-medium outline-none"
      >
        {INTERFACE_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.name}>
            {lang.name === lang.label ? lang.name : `${lang.name} (${lang.label})`}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The landing-page choice. Each option is set in its own script and
 * sized as a full button, because for many of the people this is
 * built for the language is not a preference — it is whether the app
 * works at all.
 *
 * `label`, `hint` and `selectedLabel` are passed in already
 * translated: the caller knows the current language, and this
 * component must read correctly in whichever one is active.
 */
export function LanguageChoice({
  language,
  setLanguage,
  label = 'Choose your language',
  hint,
  selectedLabel = 'Selected',
  className = '',
}) {
  const current = offeredName(language);

  return (
    <div className={className} data-testid="control-language-choice">
      <div className="flex items-center gap-2.5">
        <Languages size={15} className="shrink-0 text-asha" aria-hidden="true" />
        <p className="eyebrow">{label}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2" role="group" aria-label={label}>
        {INTERFACE_LANGUAGES.map((lang) => {
          const active = current === lang.name;

          return (
            <button
              key={lang.code}
              type="button"
              lang={lang.code}
              onClick={() => setLanguage(lang.name)}
              aria-pressed={active}
              data-testid={`btn-language-${lang.code}`}
              className={`flex min-h-14 items-center justify-between gap-3 rounded-sm border-[1.5px] px-5 text-left transition-colors ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-paper-2 text-ink hover:border-ink'
              }`}
            >
              <span className="text-lg font-semibold">{lang.name}</span>
              {active ? (
                <span className="flex shrink-0 items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-paper/75">
                  <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                  {selectedLabel}
                </span>
              ) : (
                <span className="shrink-0 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink-faint">
                  {lang.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {hint ? <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-faint">{hint}</p> : null}
    </div>
  );
}
