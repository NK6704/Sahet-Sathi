import React, { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowRight,
  FileText,
  HeartPulse,
  Hospital,
  Lock,
  MessageSquare,
  Mic,
  Siren,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { Reveal } from '@/lib/motion';
import { Btn, Card, Eyebrow, SectionHead, Stamp } from '@/components/ds';
import { LanguageChoice } from '@/components/common/LanguageSelector';

/* =============================================================
   Landing — the front door of the service.

   Three jobs, in this order:

     1. Say what Sehat Sathi does, in the plainest possible words.
     2. Take the language decision for the entire app, because
        every screen after this one is rendered in it.
     3. Send people to the right place: families into the citizen
        app, ASHA workers to their credential-gated portal.

   It is deliberately short. This page used to argue for itself at
   length — numbered chapters on how facts are handled, what the
   product is not — which read as a pitch rather than a service.
   The claims that belong to a piece of data now travel with that
   data on the screen it appears on.
   ============================================================= */

export function Landing() {
  const { language, setLanguage, setUserRole } = useAppState();
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const t = getT(language);

  /**
   * English is the default; Hindi is a choice made here. The app
   * state seeds Hindi when nothing has been stored, so on a first
   * visit this page writes the real default once — through the same
   * setter the buttons use, so it persists identically.
   *
   * Wrapped because the setter writes to localStorage, which throws
   * outright in some private-browsing modes. A blocked store means
   * the choice cannot be remembered between visits; it must not mean
   * the front page fails to render.
   */
  useEffect(() => {
    try {
      if (!localStorage.getItem('sehat_lang')) setLanguage('English');
    } catch {
      /* storage unavailable; the buttons still work for this visit */
    }
    // Mount only. Re-running would fight the person's own selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Into the citizen app. The role is set here because it decides
   * which navigation renders; note that the worker door below does
   * not set it. A role that opens a worker's register comes from
   * the profile in the database, never from a click on a public
   * page.
   */
  const enterCitizenApp = () => {
    setUserRole('citizen');
    navigate(isAuthenticated ? '/app' : '/onboarding');
  };

  const services = [
    {
      icon: Mic,
      tone: 'asha',
      title: t('Ask a health question out loud', 'बोलकर स्वास्थ्य सवाल पूछें'),
      body: t(
        'Speak in Hindi or English and hear the answer read back. Spoken answers are AI-assisted guidance, not a doctor’s advice.',
        'हिंदी या अंग्रेज़ी में बोलें और जवाब सुनें। बोलकर मिले जवाब AI की सहायता से बनी सलाह हैं, डॉक्टर का इलाज नहीं।',
      ),
    },
    {
      icon: Hospital,
      tone: 'seal',
      title: t('Find a hospital near you', 'पास का अस्पताल खोजें'),
      body: t(
        'Hospitals empanelled under Ayushman Bharat PM-JAY, taken from the National Health Authority’s registry and sorted by distance when your phone gives a location.',
        'आयुष्मान भारत पीएम-जय में सूचीबद्ध अस्पताल, राष्ट्रीय स्वास्थ्य प्राधिकरण के रजिस्टर से — और आपके फ़ोन से जगह मिलने पर दूरी के क्रम में।',
      ),
      stamp: t('Official registry', 'सरकारी रजिस्टर'),
    },
    {
      icon: FileText,
      tone: 'seal',
      title: t('Check what a scheme requires', 'योजना की शर्तें देखें'),
      body: t(
        'What a health scheme covers, who it is meant for, the documents to carry and how to apply — with a link to the government page it came from.',
        'कोई स्वास्थ्य योजना क्या देती है, किसके लिए है, कौन से दस्तावेज़ चाहिए और आवेदन कैसे करें — साथ में उस सरकारी पृष्ठ का लिंक जहाँ से जानकारी ली गई है।',
      ),
    },
    {
      icon: MessageSquare,
      tone: 'asha',
      title: t('Reach your village ASHA worker', 'अपने गाँव की आशा कार्यकर्ता से बात करें'),
      body: t(
        'Message the ASHA worker assigned to your village, and receive the notices she sends to households on her register.',
        'अपने गाँव की आशा कार्यकर्ता को संदेश भेजें, और उनके रजिस्टर के घरों को भेजी गई सूचनाएँ पाएँ।',
      ),
    },
    {
      icon: Siren,
      tone: 'siren',
      title: t('Raise an emergency SOS', 'आपातकालीन एसओएस भेजें'),
      body: t(
        'One tap calls 108 and alerts your ASHA worker along with the emergency contacts you have saved.',
        'एक टैप 108 पर कॉल करता है और आपकी आशा कार्यकर्ता तथा आपके सहेजे गए आपातकालीन संपर्कों को सूचित करता है।',
      ),
    },
  ];

  return (
    <main className={`bg-paper ${t.isHindi ? 'is-deva' : ''}`}>
      {/* ========== Masthead ========== */}
      <header className="border-b border-rule bg-paper-2">
        <div className="shell flex items-center gap-3 py-4">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-seal text-paper"
            aria-hidden="true"
          >
            <HeartPulse size={22} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="text-[1.05rem] leading-tight font-semibold text-ink">{t.appName}</p>
            <p className="truncate text-[0.8rem] text-ink-faint">{t.tagline}</p>
          </div>
        </div>
      </header>

      {/* ========== What this is, and the language it runs in ========== */}
      <section className="reg-paper">
        <div className="shell grid items-start gap-12 pt-14 pb-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pt-20 lg:pb-24">
          <Reveal>
            <Eyebrow>{t('Rural health · Government schemes', 'ग्रामीण स्वास्थ्य · सरकारी योजनाएँ')}</Eyebrow>
            <h1 className="display-lg mt-5 max-w-2xl">
              {t(
                'Health information and government health schemes for rural families.',
                'ग्रामीण परिवारों के लिए स्वास्थ्य जानकारी और सरकारी स्वास्थ्य योजनाएँ।',
              )}
            </h1>
            <p className="lede mt-6">
              {t(
                'Ask a health question in your own words, find a hospital empanelled under Ayushman Bharat near you, see what a scheme requires, and stay in touch with the ASHA worker for your village.',
                'अपने शब्दों में स्वास्थ्य सवाल पूछें, आयुष्मान भारत में सूचीबद्ध पास का अस्पताल खोजें, किसी योजना की शर्तें देखें, और अपने गाँव की आशा कार्यकर्ता से जुड़े रहें।',
              )}
            </p>
            <p className="mt-5 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">
              {t(
                'For families in villages and small towns, and for the ASHA workers who serve them. Free to use, in English and Hindi.',
                'गाँवों और छोटे कस्बों के परिवारों के लिए, और उनकी सेवा करने वाली आशा कार्यकर्ताओं के लिए। अंग्रेज़ी और हिंदी में, निःशुल्क।',
              )}
            </p>
          </Reveal>

          {/* The language gate and the citizen entrance, together:
              the language is chosen and then used, in one step. */}
          <Reveal delay={120}>
            <Card tone="seal" className="p-6 sm:p-8">
              <Eyebrow>{t('Start here', 'यहाँ से शुरू करें')}</Eyebrow>

              <LanguageChoice
                className="mt-5"
                language={language}
                setLanguage={setLanguage}
                label={t('Choose your language', 'अपनी भाषा चुनें')}
                selectedLabel={t('Selected', 'चुनी गई')}
                hint={t(
                  'This sets the language for the whole service, including the ASHA worker portal. English is used unless you choose Hindi.',
                  'यह पूरी सेवा की भाषा तय करता है, आशा कार्यकर्ता पोर्टल सहित। हिंदी चुनने तक अंग्रेज़ी इस्तेमाल होती है।',
                )}
              />

              <div className="reg-rule mt-7" />

              <div className="pt-6">
                <Eyebrow>{t('For citizens and families', 'नागरिकों और परिवारों के लिए')}</Eyebrow>
                <Btn
                  size="lg"
                  className="mt-4 w-full"
                  onClick={enterCitizenApp}
                  data-testid="btn-start-citizen"
                >
                  {t('Continue', 'आगे बढ़ें')}
                  <ArrowRight size={18} aria-hidden="true" />
                </Btn>
              </div>
            </Card>
          </Reveal>
        </div>
      </section>

      {/* ========== The five things it does ========== */}
      <section className="shell py-16 lg:py-20">
        <SectionHead
          eyebrow={t('Services', 'सेवाएँ')}
          title={t('What Sehat Sathi does', 'सेहत साथी क्या करता है')}
        />

        <div className="mt-9 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service, i) => {
            const Icon = service.icon;

            return (
              <Reveal key={service.title} delay={i * 70}>
                <Card tone={service.tone} className="flex h-full gap-4 p-6">
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
                      service.tone === 'siren'
                        ? 'bg-siren-soft text-siren'
                        : service.tone === 'asha'
                          ? 'bg-asha-soft text-asha'
                          : 'bg-seal-soft text-seal'
                    }`}
                  >
                    <Icon size={20} strokeWidth={2.1} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[1.05rem] leading-snug font-semibold text-ink">
                      {service.title}
                    </h3>
                    <p className="mt-2.5 text-[0.9rem] leading-relaxed text-ink-soft">
                      {service.body}
                    </p>
                    {service.stamp ? (
                      <div className="mt-4">
                        <Stamp kind="verified" label={service.stamp} />
                      </div>
                    ) : null}
                  </div>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ========== The staff door ==========
          Deliberately not a second front door: it names its
          audience, says a credential is needed, and offers no way
          in for anyone else. */}
      <section className="ink-panel">
        <div className="shell flex flex-wrap items-center justify-between gap-x-12 gap-y-7 py-12 lg:py-14">
          <div className="min-w-0 max-w-2xl">
            <Eyebrow>{t('Staff access', 'कर्मचारी प्रवेश')}</Eyebrow>
            <h2 className="display-md mt-3 text-2xl sm:text-3xl">
              {t('ASHA worker portal', 'आशा कार्यकर्ता पोर्टल')}
            </h2>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-paper/70">
              {t(
                'For ASHA workers only. Sign in with the email and password issued by your block office to open your referrals, alerts and the households on your register.',
                'केवल आशा कार्यकर्ताओं के लिए। अपने ब्लॉक कार्यालय से मिले ईमेल और पासवर्ड से साइन इन करें और अपने रेफरल, अलर्ट तथा रजिस्टर के परिवार देखें।',
              )}
            </p>
          </div>

          <Btn
            as={Link}
            href="/asha/login"
            variant="asha"
            size="lg"
            data-testid="btn-start-asha"
          >
            <Lock size={17} aria-hidden="true" />
            {t('Worker sign-in', 'कार्यकर्ता साइन इन')}
            <ArrowRight size={17} aria-hidden="true" />
          </Btn>
        </div>
      </section>

      {/* ========== Emergency line, sources, limits ========== */}
      <footer className="shell py-12 lg:py-16">
        <div className="reg-rule" />
        <div className="grid gap-10 pt-8 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
          <div>
            <Eyebrow>{t('Emergency', 'आपातकाल')}</Eyebrow>
            <p className="mt-3 text-[0.95rem] leading-relaxed font-semibold text-ink">
              {t(
                'In an emergency, call 108 straight away. It works without this app.',
                'आपात स्थिति में तुरंत 108 पर कॉल करें। यह इस ऐप के बिना भी काम करता है।',
              )}
            </p>
            <Btn as="a" href="tel:108" variant="siren" className="mt-5">
              <Siren size={17} aria-hidden="true" />
              {t('Call 108', '108 पर कॉल करें')}
            </Btn>
          </div>

          <div className="max-w-2xl space-y-4">
            <p className="text-[0.9rem] leading-relaxed text-ink-soft">
              {t(
                'Sehat Sathi is an information service. Hospital records come from the National Health Authority’s PM-JAY empanelment registry and scheme details from published government documents; spoken answers are AI-assisted and are not reviewed by a clinician.',
                'सेहत साथी एक जानकारी सेवा है। अस्पतालों की जानकारी राष्ट्रीय स्वास्थ्य प्राधिकरण के पीएम-जय रजिस्टर से और योजनाओं की जानकारी सरकारी दस्तावेज़ों से आती है; बोलकर मिले जवाब AI की सहायता से बनते हैं और किसी डॉक्टर द्वारा जाँचे नहीं जाते।',
              )}
            </p>
            <p className="text-[0.9rem] leading-relaxed text-ink-soft">
              {t(
                'It does not diagnose illness, prescribe medicine, or decide whether you qualify for a scheme. A doctor or your ASHA worker does that.',
                'यह बीमारी की पहचान नहीं करता, दवा नहीं लिखता, और यह तय नहीं करता कि आप किसी योजना के योग्य हैं या नहीं। वह काम डॉक्टर या आपकी आशा कार्यकर्ता करती हैं।',
              )}
            </p>
            <p className="font-mono text-[0.68rem] leading-relaxed tracking-[0.08em] uppercase text-ink-faint">
              {t(
                'Sources: National Health Authority PM-JAY hospital empanelment registry · published government scheme documents',
                'स्रोत: राष्ट्रीय स्वास्थ्य प्राधिकरण पीएम-जय अस्पताल सूची · सरकारी योजना दस्तावेज़',
              )}
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
