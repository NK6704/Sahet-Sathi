import React from 'react';
import { BadgeCheck, Globe, ShieldCheck } from 'lucide-react';

export function LiveSourceBadge({ sourceType = 'curated', sourceName, sourceUrl, verifiedAt }) {
  const isLive = sourceType === 'tavily_live' || sourceType === 'live';

  return (
    <div
      id="badge-verification-source"
      className={`inline-flex flex-wrap items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        isLive
          ? 'bg-[#e7f0fa] text-[#1c548a] border border-[#bdd6f0]'
          : 'bg-[#e7f5ed] text-[#186b4d] border border-[#a8dec4]'
      }`}
      data-testid="badge-source"
    >
      {isLive ? (
        <Globe size={13} className="shrink-0 text-[#2563eb]" />
      ) : (
        <ShieldCheck size={13} className="shrink-0 text-[#16a34a]" />
      )}
      <span>{isLive ? 'Live Gov Grounding' : 'Curated Official Data'}</span>
      {sourceName && <span className="opacity-75">· {sourceName}</span>}
      {verifiedAt && <span className="opacity-60 text-[10px]">({verifiedAt})</span>}
    </div>
  );
}
