import React, { useMemo } from 'react';
import { Link } from 'wouter';
import {
  Mic,
  FileText,
  MapPin,
  Camera,
  ArrowRight,
  LocateFixed,
  MapPinOff,
  Sparkles,
  ShieldCheck,
  Bell,
  BellOff,
  Loader2,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { useGeolocation } from '@/lib/useGeolocation';
import { getT, isHindiLang } from '@/services/i18n';
import { getAshaContact, getHospitalsNearby, getUnreadNotificationCount } from '@/services/platform';
import { EmergencyBanner } from '@/components/emergency/EmergencyBanner';
import { AshaContactCard } from '@/components/asha/AshaContactCard';
import { HospitalCard } from '@/components/care/HospitalCard';
import {
  Btn,
  Card,
  Eyebrow,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHead,
  Stamp,
  Waveform,
} from '@/components/ds';

/* =============================================================
   /app — the citizen home.

   One decision governs the layout: the microphone is the primary
   action and everything else is secondary. Most people arriving
   here cannot type comfortably in their own script, and several
   cannot read the labels at all. So the voice card is the largest
   object on the page, it sits above the fold on a phone, and the
   tile shortcuts underneath are alternatives to speaking rather
   than the main route.

   WHAT ON THIS PAGE IS REAL. This screen used to greet everybody
   as "Meera" and place them in "Mandi, Sehore" — a name and a
   village that belonged to nobody. Every person-specific thing
   here now comes from the server or is absent:

     greeting        userProfile.name, from GET /api/profile. With
                     no name on record the greeting simply has no
                     name in it.
     village chip    userProfile.village/district, or a link to go
                     and set it. Never a placeholder district.
     ASHA worker     GET /api/asha/contact, via the same shared
                     card /profile uses, so the two screens cannot
                     disagree about who covers this household.
     notifications   GET /api/notifications/unread-count.
     hospitals       GET /api/hospitals/nearby, and ONLY once the
                     person has shared a location. No coordinates
                     means no list and a printed reason, never a
                     guessed district centre.

   The two static cards at the bottom are general published facts
   — PM-JAY's ₹5,00,000 cover and standard NHM diarrhoea advice —
   not claims about this person, and both carry their source.
   ============================================================= */

export function UserHome() {
  const { language, userProfile, profileLoading } = useAppState();
  const { isAuthenticated } = useAuth();
  const t = getT(language);
  const hi = isHindiLang(language);

  const { coords, request: shareLocation, loading: locating, error: locationError } =
    useGeolocation({ language });

  /* ---------- Who this is, if we actually know ---------- */
  const firstName = useMemo(() => {
    const name = String(userProfile?.name ?? '').trim();
    return name ? name.split(/\s+/)[0] : null;
  }, [userProfile?.name]);

  const placeLabel = useMemo(() => {
    const parts = [userProfile?.village, userProfile?.district]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }, [userProfile?.village, userProfile?.district]);

  /* ---------- What the server knows ---------- */
  const contact = useAsync(() => getAshaContact(), [userProfile?.village ?? ''], {
    skip: !isAuthenticated,
  });

  const unread = useAsync(() => getUnreadNotificationCount(), [], {
    skip: !isAuthenticated,
  });

  const hasCoords =
    Number.isFinite(coords?.latitude) && Number.isFinite(coords?.longitude);

  const nearby = useAsync(
    () => getHospitalsNearby({ lat: coords.latitude, lng: coords.longitude, limit: 3 }),
    [coords?.latitude ?? '', coords?.longitude ?? ''],
    { skip: !hasCoords },
  );

  const unreadCount = Number(unread.data?.unreadCount ?? 0);
  const hospitals = Array.isArray(nearby.data?.hospitals) ? nearby.data.hospitals : [];

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
      sub: t('PM-JAY empanelled hospitals', 'PM-JAY सूचीबद्ध अस्पताल'),
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
      {/* ---------- Greeting ----------
          The name is used only when the profile actually holds one.
          A greeting with no name reads perfectly well; a greeting
          with the wrong name tells the person this app is not about
          them. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>{t('Sehat Sathi', 'सेहत साथी')}</Eyebrow>
          <h1 className="display-lg mt-3 max-w-2xl" data-testid="text-home-greeting">
            {firstName
              ? t(`How can we help, ${firstName}?`, `${firstName}, आज कैसे मदद करें?`)
              : t('How can we help today?', 'आज कैसे मदद करें?')}
          </h1>
        </div>

        {placeLabel ? (
          <span
            className="inline-flex items-center gap-2 rounded-full border border-rule bg-paper-2 px-3.5 py-2 text-[0.8rem] font-semibold text-ink-soft"
            data-testid="chip-home-village"
          >
            <LocateFixed size={14} className="shrink-0 text-asha" aria-hidden="true" />
            {placeLabel}
          </span>
        ) : profileLoading ? null : isAuthenticated ? (
          /* No village on record is worth fixing, because the ASHA
             worker and the scheme list both hang off it. */
          <Link
            href="/profile"
            className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border-[1.5px] border-dashed border-rule px-3.5 text-[0.8rem] font-semibold text-ink-soft transition-colors hover:border-asha hover:text-asha"
            data-testid="link-home-set-village"
          >
            <MapPinOff size={14} className="shrink-0" aria-hidden="true" />
            {t('Add your village', 'अपना गाँव जोड़ें')}
          </Link>
        ) : null}
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
                  'Speak in your own words — no typing, no forms. Ask about a fever, a scheme you heard about, or where the nearest hospital is.',
                  'अपने शब्दों में बोलिए — कोई टाइपिंग नहीं, कोई फ़ॉर्म नहीं। बुखार, किसी योजना, या पास के अस्पताल के बारे में पूछिए।',
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
              {/* The interface is translated into two languages. It
                  used to claim eleven. */}
              <p className="mt-4 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-paper/45">
                {t('Hindi and English', 'हिन्दी और अंग्रेज़ी')}
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

      {/* ---------- Register 003 · the person's own ASHA worker ----------
          The single most useful thing this app can hand somebody: a
          real name and a real number for the health worker whose
          job includes their household. */}
      <section className="mt-14" aria-labelledby="home-asha-title">
        <SectionHead
          index="003"
          eyebrow={t('Your village', 'आपका गाँव')}
          title={
            <span id="home-asha-title">
              {t('The health worker for your home', 'आपके घर की स्वास्थ्य कार्यकर्ता')}
            </span>
          }
          sub={t(
            'Her name and number come from the ASHA–village record in this app. If nobody is recorded for your village, it says so — a worker from a neighbouring village is never shown in her place.',
            'उनका नाम और नंबर इस ऐप के आशा-गाँव रिकॉर्ड से आते हैं। अगर आपके गाँव के लिए कोई दर्ज नहीं है, तो यहाँ वही लिखा होगा — पड़ोस के गाँव की कार्यकर्ता कभी उनकी जगह नहीं दिखाई जाती।',
          )}
          action={
            <Btn as={Link} href="/messages" variant="outline">
              {t('All messages', 'सभी संदेश')}
              <ArrowRight size={15} aria-hidden="true" />
            </Btn>
          }
        />

        <div className="mt-7 grid gap-4 lg:grid-cols-[1.3fr_0.7fr] lg:items-start">
          <AshaContactCard
            contact={contact.data}
            loading={contact.loading}
            error={contact.error}
            onRetry={contact.reload}
            signedIn={isAuthenticated}
            language={language}
            variant="compact"
          />

          {/* Notices sent by her, to this village. */}
          <Card tone={unreadCount > 0 ? 'asha' : 'neutral'} className="flex flex-col p-5">
            <div className="flex items-center gap-2">
              {unreadCount > 0 ? (
                <Bell size={15} className="shrink-0 text-asha" aria-hidden="true" />
              ) : (
                <BellOff size={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
              )}
              <Eyebrow>{t('Notices for you', 'आपके लिए सूचनाएँ')}</Eyebrow>
            </div>

            {!isAuthenticated ? (
              <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-soft">
                {t(
                  'Sign in to receive notices from your ASHA worker — camp dates, vaccination rounds, and scheme deadlines.',
                  'आशा कार्यकर्ता की सूचनाएँ पाने के लिए साइन इन करें — कैंप की तारीख़, टीकाकरण, और योजना की अंतिम तिथि।',
                )}
              </p>
            ) : unread.loading ? (
              <p className="mt-4 flex items-center gap-2 text-[0.85rem] text-ink-faint">
                <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />
                {t('Checking', 'देख रहे हैं')}
              </p>
            ) : unread.error ? (
              <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-soft">
                {t(
                  'We could not check for new notices just now.',
                  'अभी नई सूचनाएँ जाँची नहीं जा सकीं।',
                )}
              </p>
            ) : (
              <>
                <p className="figure mt-4 text-5xl leading-none text-ink" data-testid="text-unread-count">
                  {unreadCount}
                </p>
                <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-soft">
                  {unreadCount === 0
                    ? t('Nothing unread right now.', 'अभी कुछ अपठित नहीं है।')
                    : unreadCount === 1
                      ? t('One notice you have not opened.', 'एक सूचना जो आपने खोली नहीं है।')
                      : t(
                          `${unreadCount} notices you have not opened.`,
                          `${unreadCount} सूचनाएँ जो आपने खोली नहीं हैं।`,
                        )}
                </p>
              </>
            )}

            <div className="mt-5">
              <Btn as={Link} href="/notifications" variant="outline" data-testid="btn-home-notifications">
                {t('Open notices', 'सूचनाएँ खोलें')}
                <ArrowRight size={15} aria-hidden="true" />
              </Btn>
            </div>
          </Card>
        </div>
      </section>

      {/* ---------- Register 004 · hospitals near this phone ----------
          Straight from the PM-JAY registry and only once a location
          has been shared. Without coordinates there is no list and
          the reason is printed, because a distance measured from a
          guessed district centre could send somebody the wrong way
          with a sick child. */}
      <section className="mt-14" aria-labelledby="home-nearby-title">
        <SectionHead
          index="004"
          eyebrow={t('Care near you', 'पास का इलाज')}
          title={
            <span id="home-nearby-title">
              {t('The three closest hospitals', 'तीन सबसे नज़दीकी अस्पताल')}
            </span>
          }
          action={
            <Btn as={Link} href="/care" variant="outline">
              {t('Search all', 'सभी खोजें')}
              <ArrowRight size={15} aria-hidden="true" />
            </Btn>
          }
        />

        <div className="mt-7">
          {!hasCoords ? (
            <EmptyState
              stamp={false}
              title={t('Share your location to see distances', 'दूरी देखने के लिए लोकेशन साझा करें')}
              body={
                locationError ||
                t(
                  'Distances are worked out from where this phone is. Nothing is stored on our side, and no location is guessed for you — without it this list stays empty.',
                  'दूरी इस फ़ोन की जगह से निकाली जाती है। हमारी तरफ़ कुछ भी सेव नहीं होता, और कोई अनुमान नहीं लगाया जाता — इसके बिना यह सूची खाली रहती है।',
                )
              }
              action={
                <Btn onClick={shareLocation} disabled={locating} data-testid="btn-home-share-location">
                  {locating ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <LocateFixed size={16} aria-hidden="true" />
                  )}
                  {locating
                    ? t('Finding you', 'खोज रहे हैं')
                    : t('Use my location', 'मेरी लोकेशन इस्तेमाल करें')}
                </Btn>
              }
            />
          ) : nearby.loading ? (
            <LoadingState
              label={t('Finding hospitals near you', 'आपके पास अस्पताल खोज रहे हैं')}
              rows={3}
            />
          ) : nearby.error ? (
            <ErrorState
              title={t('We could not load hospitals', 'अस्पताल लोड नहीं हो सके')}
              body={nearby.error.message}
              onRetry={nearby.reload}
              retryLabel={t('Try again', 'फिर कोशिश करें')}
            />
          ) : (
            <div className="space-y-3">
              {hospitals.map((hospital, idx) => (
                <HospitalCard
                  key={hospital.id || hospital.facilityId || idx}
                  hospital={hospital}
                  language={language}
                  index={String(idx + 1).padStart(2, '0')}
                />
              ))}

              {/* The server's own explanation of a short or empty
                  list, printed as sent. "Nothing within 25 km" and
                  "the registry has no coordinates here" are
                  different facts and it knows which one applies. */}
              {nearby.data?.note ? (
                <p className="pt-1 text-[0.8rem] leading-relaxed text-ink-faint">
                  {nearby.data.note}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {/* ---------- Register 005 · general, published facts ---------- */}
      <section className="mt-14 pb-4">
        <SectionHead
          index="005"
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
              {/* The id the API actually serves is `pmjay-ayushman`
                  (server.ts CURATED_SCHEMES). Not `pmjay`, which is
                  the scheme's `code` in the database seed. */}
              <Btn as={Link} href="/schemes/pmjay-ayushman" variant="primary">
                {t('What it covers', 'क्या शामिल है')}
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

          {/* Daily note. Standard protocol advice, sourced, not improvised. */}
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
