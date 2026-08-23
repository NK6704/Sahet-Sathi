import React from 'react';
import { Languages } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '@/services/i18n';

export function LanguageSelector({ language, setLanguage, className = '' }) {
  return (
    <label
      id="control-language-selector"
      className={`flex items-center gap-2 rounded-full border border-[#dacfb9] bg-[#fbf7ec] px-3 py-1.5 text-xs font-semibold text-[#355e58] shadow-sm transition hover:border-[#1f655d] ${className}`}
      data-testid="control-language"
    >
      <Languages aria-label="Select language" size={15} className="text-[#1f655d]" />
      <select
        id="select-app-language"
        aria-label="Choose language"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        className="cursor-pointer bg-transparent outline-none font-medium"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.name} value={lang.name}>
            {lang.name} ({lang.script})
          </option>
        ))}
      </select>
    </label>
  );
}
