import React from 'react';
import { Link } from 'wouter';
import {
  Mic,
  FileText,
  MapPin,
  Camera,
  ArrowRight,
  LocateFixed,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { EmergencyBanner } from '@/components/emergency/EmergencyBanner';
import { Btn, Card, Eyebrow, SectionHead, Stamp, Waveform } from '@/components/ds';

/* =============================================================
   / and /app — the citizen home.

   One decision governs the whole layout: the microphone is the
   primary action and everything else is secondary. Most people
   arriving here cannot type comfortably in their own script, and
   several cannot read the labels at all. So the voice card is the
   largest object on the page, it sits above the fold on a phone,
   and the four tile shortcuts underneath it are alternatives to
   speaking rather than the main route.

   The featured scheme carries a verified stamp because it is a real
   central-government scheme with fixed published numbers. The daily
   note carries its protocol source for the same reason.
   ============================================================= */

export function UserHome() {
  const { language, userProfile } = useAppState();
  const hi = language === 'हिन्दी' || language === 'Hindi';
  const t = (en, dev) => (hi ? dev : en);

  const firstName = (userProfile?.name || (hi ? 'मीरा' : 'Meera')).split(' ')[0];

  const quickPaths = [
    {
      href: '/assistant',
      label: t('Ask by voice', 'बोलकर पूछें'),
      sub: t('Symptoms, schemes, anything', 'लक्षण, योजना, कुछ भी'),
      icon: Mic,
      tone: 'asha',
    },
    {
      href: '/schemes',
      label: t('Government schemes', 'सरकारी योजनाएँ'),
      sub: t('Ayushman, JSY and more', 'आयुष्मान, JSY और अन्य'),
      icon: FileText,
      tone: 'seal',
    },
    {
      href: '/care',
      label: t('Care near you', 'पास का इलाज'),
      sub: t('Sub-centre, PHC, CHC', 'उप-केंद्र, PHC, CHC'),
      icon: MapPin,
      tone: 'seal',
    },
    {
      href: '/image-assist',
      label: t('Read a prescription', 'पर्ची पढ़वाएँ'),
      sub: t('Photograph it, hear it back', 'फोटो लें, सुनें'),
      icon: Camera,
      tone: 'amber',
    },
  ];

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-6 sm:pt-8 ${hi ? 'is-deva' : ''}`}>
      {/* ---------- Greeting ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>{t('Sehat Sathi', 'सेहत साथी')}</Eyebrow>
          <h1 className="display-lg mt-3 max-w-2xl">
            {t(`How can we help, ${firstName}?`, `${firstName}, आज कैसे मदद करें?`)}
          </h1>
        </div>

        <span className="inline-flex items-center gap-2 rounded-full border border-rule bg-paper-2 px-3.5 py-2 text-[0.8rem] font-semibold text-ink-soft">
          <LocateFixed size={14} className="shrink-0 text-asha" aria-hidden="true" />
          {userProfile?.village || 'Mandi'}, {userProfile?.district || 'Sehore'}
        </span>
      </div>

      {/* ---------- Register 001 · the voice card ----------
          A dark panel, so that on a bright sunny doorstep this is
          the one thing on the screen that is unmistakably readable. */}
      <section className="mt-8">
        <Card className="ink-panel overflow-hidden border-ink-panel p-6 sm:p-9">
          <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-center">
            <div className="min-w-0">
              <div className="flex items-baseline gap-3">
                <span className="reg-index">001</span>
                <Eyebrow>{t('Voice first', 'पहले आवाज़')}</Eyebrow>
              </div>

              <h2 className="display-lg mt-4 max-w-xl text-paper">
                {t('Just say what is wrong.', 'बस बताइए क्या तकलीफ़ है।')}
              </h2>

              <p className="mt-4 max-w-lg text-[0.95rem] leading-relaxed text-paper/70">
                {t(
                  'Speak in your own language — no typing, no forms. Ask about a fever, a scheme you heard about, or where the nearest hospital is.',
                  'अपनी भाषा में बोलिए — कोई टाइपिंग नहीं, कोई फ़ॉर्म नहीं। बुखार, किसी योजना, या पास के अस्पताल के बारे में पूछिए।',
                )}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Btn as={Link} href="/assistant" variant="asha" size="lg" data-testid="btn-home-speak">
                  <Mic size={19} aria-hidden="true" />
                  {t('Tap to speak', 'दबाकर बोलें')}
                </Btn>
                <Btn as={Link} href="/schemes" variant="outline">
                  <FileText size={16} aria-hidden="true" />
                  {t('Browse schemes', 'योजनाएँ देखें')}
                </Btn>
              </div>

              <p className="mt-6 flex items-start gap-2 text-[0.8rem] leading-relaxed text-paper/50">
                <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                {t(
                  'Guidance only — never a diagnosis, and never a prescription. Anything urgent goes to 108.',
                  'यह केवल मार्गदर्शन है — न निदान, न दवा। कुछ भी गंभीर हो तो 108।',
                )}
              </p>
            </div>

            {/* The waveform is the product's mark. It says "this thing
                listens" faster than any icon of a stethoscope. */}
            <div className="text-asha-bright lg:justify-self-end lg:pl-6">
              <Waveform bars={30} className="w-full max-w-sm" />
              <p className="mt-4 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-paper/45">
                {t('11 languages', '11 भाषाएँ')}
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* ---------- Emergency ---------- */}
      <div className="mt-4">
        <EmergencyBanner language={language} />
      </div>

      {/* ---------- Register 002 · shortcuts ---------- */}
      <section className="mt-12" aria-labelledby="quick-services-title">
        <SectionHead
          index="002"
          eyebrow={t('Shortcuts', 'शॉर्टकट')}
          title={<span id="quick-services-title">{t('Or go straight there', 'या सीधे यहाँ जाएँ')}</span>}
        />

        <div className="mt-7 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {quickPaths.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.href}
                as={Link}
                href={item.href}
                tone={item.tone}
                lift
                className="flex min-h-[9.5rem] flex-col justify-between p-4 sm:p-5"
                data-testid={`link-quick-${item.href.replace('/', '')}`}
              >
                <span
                  className={`grid h-11 w-11 place-items-center rounded-sm ${
                    item.tone === 'asha'
                      ? 'bg-asha-soft text-asha'
                      : item.tone === 'amber'
                      ? 'bg-amber-soft text-amber'
                      : 'bg-seal-soft text-seal'
                  }`}
                >
                  <Icon size={21} strokeWidth={2.1} aria-hidden="true" />
                </span>
                <span className="mt-5 block">
                  <span className="block text-[0.95rem] font-semibold leading-snug text-ink">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-[0.78rem] leading-snug text-ink-faint">
                    {item.sub}
                  </span>
                </span>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ---------- Register 003 · scheme + note ---------- */}
      <section className="mt-14 pb-4">
        <SectionHead
          index="003"
          eyebrow={t('Worth knowing', 'जानने योग्य')}
          title={t('Two things for today', 'आज की दो बातें')}
        />

        <div className="mt-7 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          {/* Featured scheme. Real published figures, so a real stamp. */}
          <Card tone="seal" className="flex flex-col p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Eyebrow>{t('Featured scheme', 'प्रमुख योजना')}</Eyebrow>
              <Stamp kind="verified" label={t('Central scheme', 'केंद्रीय योजना')} source="NHA" />
            </div>

            <h3 className="display-md mt-4 text-2xl">
              {t('Ayushman Bharat PM-JAY', 'आयुष्मान भारत PM-JAY')}
            </h3>

            <p className="mt-3 max-w-xl text-[0.9rem] leading-relaxed text-ink-soft">
              {t(
                '₹5,00,000 of cashless hospital treatment per family per year, at empanelled government and private hospitals. No cap on family size or age.',
                'प्रति परिवार प्रति वर्ष ₹5,00,000 तक कैशलेस इलाज, सूचीबद्ध सरकारी और निजी अस्पतालों में। परिवार के आकार या उम्र की कोई सीमा नहीं।',
              )}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-rule pt-5">
              <Btn as={Link} href="/schemes/pmjay-ayushman" variant="primary">
                {t('Check eligibility', 'पात्रता देखें')}
                <ArrowRight size={15} aria-hidden="true" />
              </Btn>
              <Link
                href="/care"
                className="text-[0.85rem] font-semibold text-seal underline-offset-4 hover:underline"
              >
                {t('Find an empanelled hospital', 'सूचीबद्ध अस्पताल खोजें')}
              </Link>
            </div>

            {/* Said plainly rather than in fine print, because a family
                that turns up expecting free treatment and is refused
                will not come back to this app. */}
            <p className="mt-5 text-[0.78rem] leading-relaxed text-ink-faint">
              {t(
                'Being listed here is not an approval. The hospital confirms your entitlement at the desk.',
                'यहाँ दिखना स्वीकृति नहीं है। अस्पताल काउंटर पर आपकी पात्रता की पुष्टि करता है।',
              )}
            </p>
          </Card>

          {/* Daily note. Sourced, not improvised. */}
          <Card tone="amber" className="flex flex-col justify-between p-6">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="shrink-0 text-amber" aria-hidden="true" />
                <Eyebrow>{t('Today’s note', 'आज की सलाह')}</Eyebrow>
              </div>

              <h3 className="display-md mt-4 text-xl">
                {t('Boiled water, and ORS on time', 'उबला पानी, और समय पर ORS')}
              </h3>

              <p className="mt-3 text-[0.87rem] leading-relaxed text-ink-soft">
                {t(
                  'With loose motions or vomiting, start ORS in clean boiled water straight away. If a child under five has a fever for more than two days, tell your ASHA worker.',
                  'दस्त या उल्टी में तुरंत साफ़ उबले पानी में ORS शुरू करें। पाँच साल से छोटे बच्चे को दो दिन से ज़्यादा बुखार हो तो आशा कार्यकर्ता को बताएँ।',
                )}
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
              <Link
                href="/assistant"
                className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-asha underline-offset-4 hover:underline"
              >
                {t('Ask about this', 'इस बारे में पूछें')}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
              <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-ink-faint">
                {t('Source: NHM protocol', 'स्रोत: NHM प्रोटोकॉल')}
              </span>
            </div>
          </Card>
        </div>
      </section>
    </main>
  );
}
