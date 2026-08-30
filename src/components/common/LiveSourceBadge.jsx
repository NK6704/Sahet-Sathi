import React from 'react';
import { Globe, ShieldCheck, ExternalLink } from 'lucide-react';

/* =============================================================
   Where this fact came from.

   The brief's hardest rule is that the product only states what it
   can prove. This badge is how a claim carries its receipt, so it
   is built to the same shape as the verification stamp used
   everywhere else rather than as a decorative chip.

   When a URL is available it is a link. A source you cannot go and
   check is not really a source.
   ============================================================= */

export function LiveSourceBadge({ sourceType = 'curated', sourceName, sourceUrl, verifiedAt }) {
  const isLive = sourceType === 'tavily_live' || sourceType === 'live';
  const Icon = isLive ? Globe : ShieldCheck;

  const body = (
    <>
      <Icon size={11} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
      <span>{isLive ? 'Live gov source' : 'Official record'}</span>
      {sourceName ? <span className="opacity-60">· {sourceName}</span> : null}
      {verifiedAt ? <span className="opacity-50">· {verifiedAt}</span> : null}
      {sourceUrl ? <ExternalLink size={10} className="shrink-0 opacity-60" aria-hidden="true" /> : null}
    </>
  );

  const cls = `stamp stamp-verified ${isLive ? 'text-seal' : ''}`;

  if (sourceUrl) {
    return (
      <a
        id="badge-verification-source"
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${cls} transition-opacity hover:opacity-75`}
        data-testid="badge-source"
      >
        {body}
      </a>
    );
  }

  return (
    <span id="badge-verification-source" className={cls} data-testid="badge-source">
      {body}
    </span>
  );
}
