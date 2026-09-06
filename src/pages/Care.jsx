import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Crosshair,
  Loader2,
  MapPinOff,
  Info,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { isHindiLang } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import {
  getHospitalsNearby,
  searchHospitals,
  getHospitalMeta,
} from '@/services/platform';
import { HospitalCard } from '@/components/care/HospitalCard';
import {
  Btn,
  Card,
  Eyebrow,
  Figure,
  InferenceNote,
  LoadingState,
  EmptyState,
  ErrorState,
  Pill,
  RegRule,
  SectionHead,
  Stamp,
} from '@/components/ds';

/* =============================================================
   /care — finding a hospital you can actually be sent to.

   Everything on this page comes from one table: the National
   Health Authority's PM-JAY empanelment registry, about 38,900
   active hospitals of which roughly 96% carry a coordinate the
   importer could use. There is no second source and no sample
   data, so the page has exactly two honest states:

     LOCATED    the phone gave a coordinate, /nearby measured a
                real distance from it, and distance is the headline
                fact on every card.

     UNLOCATED  permission was refused, unavailable or slow. No
                location is guessed and no nearby list is faked.
                The page switches to a state/district browse and
                says, in words, that the result is not sorted by
                distance.

   The two things the registry genuinely lacks — pincode and city —
   are stated rather than offered as controls that would 400.
   ============================================================= */

/** Steps inside the server's 1–100 km clamp. 15 is its own default. */
const RADII = [5, 10, 15, 25, 50, 100];
const NEARBY_LIMIT = 30;
const PAGE_SIZE = 24;

const numbers = new Intl.NumberFormat('en-IN');

const TYPE_FILTERS = [
  { code: '', en: 'All types', dev: 'सभी प्रकार' },
  { code: 'G', en: 'Government', dev: 'सरकारी' },
  { code: 'P', en: 'Private', dev: 'निजी' },
  // Ten rows genuinely carry PP, and the server labels it
  // "Public-private", so the filter uses the registry's own word.
  { code: 'PP', en: 'Public-private', dev: 'सरकारी-निजी' },
];

const normalise = (value) => String(value ?? '').trim().toLowerCase();

/** A coordinate printed as a coordinate. No place name is invented. */
function formatCoords(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lng).toFixed(3)}° ${ew}`;
}

/**
 * A chip. Used for the radius steps and the ownership filter, which
 * are the two controls a person actually reaches for.
 */
function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-[0.875rem] font-semibold transition-colors ${
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The server's own `note`, printed verbatim. Every response that can
 * be empty carries one, and it is the sentence that stops an empty
 * list from being read as "there is no hospital near you".
 */
function ServerNote({ children }) {
  if (!children) return null;
  return (
    <Card className="mt-6 flex items-start gap-3 p-5">
      <Info size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

export function Care() {
  const { language, profile } = useAuth();
  // English unless the profile says otherwise. isHindiLang() reads a
  // missing language as Hindi, so the default is pinned here.
  const deva = Boolean(language) && isHindiLang(language);
  const t = useCallback((en, dev) => (deva ? dev : en), [deva]);

  /* ---- Where we are, and whether we know ---------------------- */

  // 'ask' | 'locating' | 'located' | 'denied' | 'timeout' | 'unsupported' | 'failed'
  const [geo, setGeo] = useState('ask');
  const [coords, setCoords] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [locationName, setLocationName] = useState('');
  // 'locate' — the gate; 'nearby' — distance search; 'browse' — district search.
  const [view, setView] = useState('locate');

  /* ---- Filters ------------------------------------------------ */

  const [radiusKm, setRadiusKm] = useState(15);
  const [typeCode, setTypeCode] = useState('');
  const [speciality, setSpeciality] = useState('');

  const [stateCode, setStateCode] = useState('');
  const [districtCode, setDistrictCode] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [page, setPage] = useState(1);
  // True once the person has chosen a state or district themselves,
  // after which nothing is seeded from the profile any more.
  const [touched, setTouched] = useState(false);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo('unsupported');
      setView('browse');
      return;
    }

    setGeo('locating');
    setLocationName('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setAccuracy(Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null);
        setGeo('located');
        setView('nearby');
        
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          );
          if (res.ok) {
            const data = await res.json();
            if (data && data.address) {
              const a = data.address;
              const place = a.village || a.suburb || a.city_district || a.city || a.town || a.county || '';
              const state = a.state || '';
              setLocationName([place, state].filter(Boolean).join(', ') || data.display_name);
              return;
            } else if (data && data.display_name) {
              const parts = data.display_name.split(', ');
              setLocationName(parts.slice(0, 3).join(', '));
              return;
            }
          }
        } catch (e) {
          console.warn('Nominatim geocoding failed', e);
        }

        // Fallback to BigDataCloud if Nominatim failed or was rate-limited
        try {
          const res2 = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&localityLanguage=en`
          );
          if (res2.ok) {
            const data2 = await res2.json();
            if (data2 && data2.city && data2.principalSubdivision) {
              setLocationName(`${data2.city}, ${data2.principalSubdivision}`);
            } else if (data2 && data2.locality) {
              setLocationName(`${data2.locality}, ${data2.principalSubdivision}`);
            }
          }
        } catch (e) {
          console.warn('BigDataCloud geocoding failed', e);
        }
      },
      (err) => {
        // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
        setGeo(err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'failed');
        // No fallback coordinate is invented. The browse flow takes
        // over and labels itself as not sorted by distance.
        setView('browse');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  // If permission was already granted on a previous visit, use it
  // without prompting again. Nothing here can trigger a prompt.
  useEffect(() => {
    let cancelled = false;
    if (!navigator.permissions?.query) return undefined;

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (!cancelled && status.state === 'granted') requestLocation();
      })
      .catch(() => {
        /* Permissions API unavailable; the gate stays as it is. */
      });

    return () => {
      cancelled = true;
    };
  }, [requestLocation]);

  /* ---- Reference data ----------------------------------------- */

  // Districts come back scoped to a state, and are withheld entirely
  // when the full list would be too large — hence stateCode here.
  const meta = useAsync(
    () => getHospitalMeta(stateCode ? { stateCode: Number(stateCode) } : {}),
    [stateCode],
  );

  const states = meta.data?.states ?? [];
  const specialities = meta.data?.specialities ?? [];
  const coverage = meta.data?.coverage ?? null;

  const districts = useMemo(() => {
    const rows = (meta.data?.districts ?? []).filter(
      (d) => (!stateCode || String(d.stateCode) === String(stateCode)) && !d.placeholder,
    );
    return [...rows].sort((a, b) => {
      return String(a.name).localeCompare(String(b.name));
    });
  }, [meta.data, stateCode]);

  const specialityLabels = useMemo(() => {
    const map = {};
    for (const s of specialities) map[s.code] = s.name;
    return map;
  }, [specialities]);

  // Seed the browse controls from the profile when it names a state
  // the registry also knows. A name that does not match is left
  // alone rather than approximated, and once the person has touched
  // either select the seeding stops for good — nothing should move
  // under their hand.
  useEffect(() => {
    if (touched || stateCode || !states.length || !profile?.state) return;
    const wanted = normalise(profile.state);
    const match = states.find(
      (s) => normalise(s.name) === wanted || normalise(s.shortCode) === wanted,
    );
    if (match) setStateCode(String(match.code));
  }, [touched, states, profile?.state, stateCode]);

  useEffect(() => {
    if (touched || districtCode || !districts.length || !profile?.district) return;
    const wanted = normalise(profile.district);
    const match = districts.find((d) => !d.placeholder && normalise(d.name) === wanted);
    if (match) setDistrictCode(String(match.code));
  }, [touched, districts, profile?.district, districtCode]);

  /* ---- The two searches --------------------------------------- */

  const latKey = coords ? coords.lat.toFixed(5) : '';
  const lngKey = coords ? coords.lng.toFixed(5) : '';

  const nearby = useAsync(
    () =>
      getHospitalsNearby({
        lat: coords.lat,
        lng: coords.lng,
        radiusKm,
        type: typeCode || undefined,
        speciality: speciality || undefined,
        limit: NEARBY_LIMIT,
      }),
    [latKey, lngKey, radiusKm, typeCode, speciality],
    { skip: view !== 'nearby' || !coords },
  );

  // The server needs at least one of q, stateCode or districtCode:
  // returning 39,000 hospitals in name order is not a search.
  const browseReady = Boolean(stateCode || districtCode || nameQuery);

  const browse = useAsync(
    () =>
      searchHospitals({
        q: nameQuery || undefined,
        stateCode: stateCode || undefined,
        districtCode: districtCode || undefined,
        type: typeCode || undefined,
        speciality: speciality || undefined,
        page,
        size: PAGE_SIZE,
      }),
    [nameQuery, stateCode, districtCode, typeCode, speciality, page],
    { skip: view !== 'browse' || !browseReady },
  );

  const located = view === 'nearby' && Boolean(coords);
  const active = located ? nearby : browse;
  const hospitals = active.data?.hospitals ?? [];

  /* ---- Filter changes always return to the first page ---------- */

  const chooseType = (code) => {
    setTypeCode(code);
    setPage(1);
  };
  const chooseSpeciality = (code) => {
    setSpeciality(code);
    setPage(1);
  };
  const chooseState = (code) => {
    setTouched(true);
    setStateCode(code);
    setDistrictCode('');
    setPage(1);
  };
  const chooseDistrict = (code) => {
    setTouched(true);
    setDistrictCode(code);
    setPage(1);
  };

  const goBrowse = () => setView('browse');

  /* ---- Labels ------------------------------------------------- */

  const stateLabel = states.find((s) => String(s.code) === String(stateCode))?.name ?? '';
  const districtRow = districts.find((d) => String(d.code) === String(districtCode));
  const districtLabel = districtRow && !districtRow.placeholder ? districtRow.name : '';

  const placeLabel =
    [districtLabel, stateLabel].filter(Boolean).join(', ') ||
    t('the whole registry', 'पूरे रजिस्टर');

  const browseTitle = nameQuery
    ? placeLabel && (districtLabel || stateLabel)
      ? t(`“${nameQuery}” in ${placeLabel}`, `${placeLabel} में “${nameQuery}”`)
      : t(`Hospitals matching “${nameQuery}”`, `“${nameQuery}” से मिलते अस्पताल`)
    : t(`Hospitals in ${placeLabel}`, `${placeLabel} में अस्पताल`);

  const geoExplanation = {
    denied: t(
      'Location permission was refused, so no distance can be measured. We will not guess where you are — choose your state and district instead.',
      'लोकेशन की अनुमति नहीं मिली, इसलिए दूरी नहीं नापी जा सकती। हम आपकी जगह का अनुमान नहीं लगाएँगे — अपना राज्य और ज़िला चुनें।',
    ),
    timeout: t(
      'Your phone did not return a location in time. Try again, or choose your state and district instead.',
      'आपके फ़ोन से समय पर लोकेशन नहीं मिली। दोबारा कोशिश करें, या अपना राज्य और ज़िला चुनें।',
    ),
    unsupported: t(
      'This browser does not provide a location, so distance cannot be measured here.',
      'यह ब्राउज़र लोकेशन नहीं देता, इसलिए यहाँ दूरी नहीं नापी जा सकती।',
    ),
    failed: t(
      'Your phone could not provide a location just now. Try again, or choose your state and district instead.',
      'अभी आपके फ़ोन से लोकेशन नहीं मिल सकी। दोबारा कोशिश करें, या अपना राज्य और ज़िला चुनें।',
    ),
  }[geo];

  const pageCount = browse.data?.pageCount ?? 1;

  // The next step up, for the empty state to offer. 100 km is the
  // widest the server accepts, so above that there is nothing to offer.
  const widerRadius = RADII.find((km) => km > radiusKm) ?? null;

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-8 sm:pt-12 ${deva ? 'is-deva' : ''}`}>
      {/* ================= Head ================= */}
      <header className="border-b border-rule pb-10">
        <Eyebrow>{t('Register · Hospitals', 'रजिस्टर · अस्पताल')}</Eyebrow>
        <h1 className="display-lg mt-4 max-w-3xl">
          {t('Find a hospital', 'अस्पताल खोजें')}
        </h1>
        <p className="lede mt-5 max-w-2xl">
          {t(
            'Every hospital here is empanelled under Ayushman Bharat PM-JAY, taken from the National Health Authority’s own registry. It is an empanelment list, not a directory of every hospital in India — a good hospital nearby may simply never have joined the scheme.',
            'यहाँ दर्ज हर अस्पताल आयुष्मान भारत पीएम-जय में सूचीबद्ध है, राष्ट्रीय स्वास्थ्य प्राधिकरण के रजिस्टर से लिया गया। यह योजना में शामिल अस्पतालों की सूची है, भारत के सभी अस्पतालों की नहीं — पास का अच्छा अस्पताल शायद इस योजना में शामिल ही न हुआ हो।',
          )}
        </p>
        <div className="mt-6">
          <Stamp kind="verified" label={t('Official registry', 'सरकारी रजिस्टर')} />
        </div>
      </header>

      {/* ================= 01 · Location ================= */}
      <section className="mt-10">
        {view === 'locate' ? (
          <Card tone="seal" className="p-6 sm:p-9">
            <Eyebrow>{t('01 · Your location', '01 · आपकी जगह')}</Eyebrow>
            <h2 className="display-md mt-4 max-w-2xl">
              {t('Sort hospitals by how far they are', 'अस्पतालों को दूरी के क्रम में देखें')}
            </h2>
            <p className="lede mt-4">
              {t(
                'We ask your phone for your location for one reason: to measure how far each hospital is from you. It is used for this search only and is not saved to your profile.',
                'हम आपके फ़ोन से आपकी जगह इसलिए पूछते हैं कि हर अस्पताल की दूरी नाप सकें। यह केवल इस खोज में इस्तेमाल होती है और आपकी प्रोफ़ाइल में नहीं सहेजी जाती।',
              )}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Btn size="lg" onClick={requestLocation} disabled={geo === 'locating'}>
                {geo === 'locating' ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Crosshair size={18} aria-hidden="true" />
                )}
                {geo === 'locating'
                  ? t('Finding your location…', 'आपकी जगह खोज रहे हैं…')
                  : t('Use my location', 'मेरी जगह इस्तेमाल करें')}
              </Btn>
              <Btn variant="outline" size="lg" onClick={goBrowse}>
                {t('Choose state and district instead', 'राज्य और ज़िला चुनें')}
              </Btn>
            </div>
          </Card>
        ) : located ? (
          <Card className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 p-6">
            <div className="min-w-0">
              <Eyebrow>{t('01 · Searching from', '01 · यहाँ से खोज')}</Eyebrow>
              {locationName ? (
                <>
                  <p className="mt-3 text-lg font-bold text-ink truncate max-w-2xl" title={locationName}>
                    {locationName}
                  </p>
                  <p className="mt-1 font-mono text-xs text-ink-soft">
                    {formatCoords(coords.lat, coords.lng)}
                  </p>
                </>
              ) : (
                <p className="mt-3 font-mono text-lg text-ink">
                  {formatCoords(coords.lat, coords.lng)}
                </p>
              )}
              {accuracy ? (
                <InferenceNote className="mt-3 max-w-xl">
                  {t(
                    `Your phone reports this to about ${Math.round(accuracy)} m. Distances are measured from it, so treat them as close, not exact.`,
                    `आपका फ़ोन इसे लगभग ${Math.round(accuracy)} मीटर तक सही बताता है। दूरियाँ इसी से नापी गई हैं, इसलिए इन्हें लगभग मानें।`,
                  )}
                </InferenceNote>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Btn variant="outline" onClick={requestLocation} disabled={geo === 'locating'}>
                {geo === 'locating' ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Crosshair size={16} aria-hidden="true" />
                )}
                {t('Update location', 'जगह बदलें')}
              </Btn>
              <Btn variant="outline" onClick={goBrowse}>
                {t('Browse by district', 'ज़िले से देखें')}
              </Btn>
            </div>
          </Card>
        ) : (
          <div className="space-y-5">
            {geoExplanation ? (
              <Card tone="amber" className="flex items-start gap-4 p-6">
                <MapPinOff size={20} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
                <div className="min-w-0">
                  <Eyebrow>{t('01 · Location unavailable', '01 · लोकेशन उपलब्ध नहीं')}</Eyebrow>
                  <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
                    {geoExplanation}
                  </p>
                </div>
              </Card>
            ) : null}

            <Card className="p-6 sm:p-8">
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
                <div>
                  <Eyebrow>{t('01 · Browse the registry', '01 · रजिस्टर देखें')}</Eyebrow>
                  <h2 className="display-md mt-3">
                    {t('Choose a state and district', 'राज्य और ज़िला चुनें')}
                  </h2>
                </div>
                <Btn variant="outline" onClick={requestLocation} disabled={geo === 'locating'}>
                  {geo === 'locating' ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Crosshair size={16} aria-hidden="true" />
                  )}
                  {t('Try my location', 'मेरी जगह से खोजें')}
                </Btn>
              </div>

              {meta.error ? (
                <ErrorState
                  className="mt-6"
                  title={t('The state list did not load', 'राज्यों की सूची लोड नहीं हुई')}
                  body={meta.error.message}
                  onRetry={meta.reload}
                  retryLabel={t('Try again', 'फिर कोशिश करें')}
                />
              ) : (
                <>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="eyebrow">{t('State', 'राज्य')}</span>
                      <select
                        value={stateCode}
                        onChange={(e) => chooseState(e.target.value)}
                        disabled={meta.loading}
                        className="field mt-2"
                      >
                        <option value="">
                          {meta.loading
                            ? t('Loading states…', 'राज्य लोड हो रहे हैं…')
                            : t('Select a state', 'राज्य चुनें')}
                        </option>
                        {states.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="eyebrow">{t('District', 'ज़िला')}</span>
                      <select
                        value={districtCode}
                        onChange={(e) => chooseDistrict(e.target.value)}
                        disabled={meta.loading || !stateCode || !districts.length}
                        className="field mt-2"
                      >
                        <option value="">
                          {stateCode
                            ? t('All districts', 'सभी ज़िले')
                            : t('Choose a state first', 'पहले राज्य चुनें')}
                        </option>
                        {districts.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.placeholder
                              ? t(
                                  `District code ${d.code} — name not published`,
                                  `ज़िला कोड ${d.code} — नाम दर्ज नहीं`,
                                )
                              : d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <form
                    className="mt-4 flex flex-wrap items-center gap-2.5"
                    role="search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setNameQuery(nameDraft.trim());
                      setPage(1);
                    }}
                  >
                    <label className="relative min-w-0 flex-1">
                      <span className="sr-only">
                        {t('Search by hospital name', 'अस्पताल के नाम से खोजें')}
                      </span>
                      <Search
                        size={17}
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder={t('Search by hospital name', 'अस्पताल के नाम से खोजें')}
                        className="field w-full pl-11"
                      />
                    </label>
                    <Btn type="submit">{t('Search', 'खोजें')}</Btn>
                  </form>

                  {coverage && !coverage.pincodeSearchAvailable ? (
                    <p className="mt-4 text-[0.85rem] leading-relaxed text-ink-faint">
                      {t(
                        'There is no PIN code or city search here. The National Health Authority publishes neither for these hospitals, so a PIN code box would have nothing to search.',
                        'यहाँ पिन कोड या शहर से खोज नहीं है। राष्ट्रीय स्वास्थ्य प्राधिकरण इन अस्पतालों के लिए ये दोनों प्रकाशित नहीं करता, इसलिए पिन कोड का खाना कुछ खोज ही नहीं पाता।',
                      )}
                    </p>
                  ) : null}

                  {coverage && !coverage.districtNamesAvailable ? (
                    <p className="mt-2.5 text-[0.85rem] leading-relaxed text-ink-faint">
                      {t(
                        'District names were not published by the registry at import time, so districts appear by code. Searching by state alone works.',
                        'आयात के समय रजिस्टर से ज़िलों के नाम नहीं मिले, इसलिए ज़िले कोड में दिखते हैं। केवल राज्य से खोजना भी काम करता है।',
                      )}
                    </p>
                  ) : null}
                </>
              )}
            </Card>
          </div>
        )}
      </section>

      {/* ================= 02 · Filters ================= */}
      {view === 'locate' ? null : (
        <section className="mt-12">
          <RegRule index="02" label={t('Narrow the list', 'सूची छाँटें')} />

          {located ? (
            <div className="mt-6">
              <Eyebrow>{t('Within', 'इतनी दूरी में')}</Eyebrow>
              <div
                className="mt-3 flex flex-wrap gap-2"
                role="group"
                aria-label={t('Search radius', 'खोज की दूरी')}
              >
                {RADII.map((km) => (
                  <Chip key={km} active={radiusKm === km} onClick={() => setRadiusKm(km)}>
                    {t(`${km} km`, `${km} किमी`)}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-6">
            <Eyebrow>{t('Ownership', 'स्वामित्व')}</Eyebrow>
            <div
              className="mt-3 flex flex-wrap gap-2"
              role="group"
              aria-label={t('Ownership', 'स्वामित्व')}
            >
              {TYPE_FILTERS.map((f) => (
                <Chip
                  key={f.code || 'all'}
                  active={typeCode === f.code}
                  onClick={() => chooseType(f.code)}
                >
                  {t(f.en, f.dev)}
                </Chip>
              ))}
            </div>
          </div>

          <div className="mt-6 max-w-md">
            <label className="block">
              <span className="eyebrow">{t('Speciality', 'विशेषज्ञता')}</span>
              <select
                value={speciality}
                onChange={(e) => chooseSpeciality(e.target.value)}
                disabled={meta.loading || !specialities.length}
                className="field mt-3"
              >
                <option value="">{t('Any speciality', 'कोई भी विशेषज्ञता')}</option>
                {specialities.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {meta.error ? (
              <p className="mt-2.5 text-[0.85rem] text-ink-faint">
                {t(
                  'The speciality list could not be loaded, so this filter is empty.',
                  'विशेषज्ञताओं की सूची लोड नहीं हो सकी, इसलिए यह छँटनी खाली है।',
                )}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {/* ================= 03 · Results ================= */}
      {view === 'locate' ? null : (
        <section className="mt-12">
          <SectionHead
            index="03"
            eyebrow={
              located
                ? t('Sorted by distance', 'दूरी के क्रम में')
                : t('Not sorted by distance', 'दूरी के क्रम में नहीं')
            }
            title={
              located
                ? t(`Nearest first, within ${radiusKm} km`, `${radiusKm} किमी में, नज़दीक से क्रम में`)
                : browseTitle
            }
            sub={
              located
                ? t(
                    'Straight-line distance from the location your phone gave, not road distance.',
                    'आपके फ़ोन से मिली जगह से सीधी दूरी, सड़क की दूरी नहीं।',
                  )
                : t(
                    'Without your location no distance can be measured, so these are in name order. Nothing here is a claim about which hospital is nearest.',
                    'आपकी जगह पता न होने से दूरी नहीं नापी जा सकती, इसलिए ये नाम के क्रम में हैं। यह किसी भी तरह नहीं बताता कि कौन सा अस्पताल सबसे पास है।',
                  )
            }
          />

          {!located && !browseReady ? (
            <EmptyState
              className="mt-8"
              stamp={false}
              title={t('Choose a state to begin', 'शुरू करने के लिए राज्य चुनें')}
              body={t(
                'The registry holds close to 39,000 hospitals. Pick a state, or a district, or type part of a hospital’s name.',
                'रजिस्टर में लगभग 39,000 अस्पताल हैं। कोई राज्य या ज़िला चुनें, या अस्पताल के नाम का कुछ हिस्सा लिखें।',
              )}
            />
          ) : active.loading ? (
            <LoadingState
              className="mt-8"
              label={t('Searching the registry', 'रजिस्टर खोज रहे हैं')}
              rows={3}
            />
          ) : active.error ? (
            <ErrorState
              className="mt-8"
              title={t('The search did not run', 'खोज पूरी नहीं हुई')}
              body={
                active.error.message ||
                t(
                  'The registry could not be reached. If you need help right now, call 108 — that works without this app.',
                  'रजिस्टर तक नहीं पहुँच सके। अभी मदद चाहिए तो 108 पर कॉल करें — वह इस ऐप के बिना भी काम करता है।',
                )
              }
              onRetry={active.reload}
              retryLabel={t('Try again', 'फिर कोशिश करें')}
            />
          ) : hospitals.length === 0 ? (
            <EmptyState
              className="mt-8"
              title={t('Nothing in the registry matches', 'रजिस्टर में कुछ नहीं मिला')}
              body={
                // The server's own sentence. It explains what an empty
                // result means, which is never "no hospital near you".
                active.data?.note ||
                t(
                  'No empanelled hospital matches these filters.',
                  'इन छँटनियों से कोई सूचीबद्ध अस्पताल नहीं मिला।',
                )
              }
              action={
                located ? (
                  <div className="flex flex-wrap justify-center gap-3">
                    {/* The radius is never widened for the user. It is
                        offered as a tap, so every distance shown
                        afterwards is still measured against a radius
                        they chose. */}
                    {widerRadius ? (
                      <Btn onClick={() => setRadiusKm(widerRadius)}>
                        {t(`Search ${widerRadius} km`, `${widerRadius} किमी में खोजें`)}
                      </Btn>
                    ) : null}
                    <Btn variant="outline" onClick={goBrowse}>
                      {t('Browse by district instead', 'ज़िले से देखें')}
                    </Btn>
                  </div>
                ) : typeCode || speciality ? (
                  <Btn
                    variant="outline"
                    onClick={() => {
                      chooseType('');
                      chooseSpeciality('');
                    }}
                  >
                    {t('Clear the filters', 'छँटनी हटाएँ')}
                  </Btn>
                ) : null
              }
            />
          ) : (
            <>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Pill tone={located ? 'seal' : 'neutral'}>
                  {located
                    ? t(
                        `${hospitals.length} within ${radiusKm} km`,
                        `${radiusKm} किमी में ${hospitals.length}`,
                      )
                    : t(
                        `${numbers.format(browse.data?.count ?? hospitals.length)} in the registry`,
                        `रजिस्टर में ${numbers.format(browse.data?.count ?? hospitals.length)}`,
                      )}
                </Pill>
                {located && hospitals.length === NEARBY_LIMIT ? (
                  <span className="text-[0.85rem] text-ink-faint">
                    {t(
                      `Showing the ${NEARBY_LIMIT} nearest. Narrow the radius to see fewer, closer hospitals.`,
                      `सबसे पास के ${NEARBY_LIMIT} दिखाए गए हैं। कम और नज़दीक देखने के लिए दूरी घटाएँ।`,
                    )}
                  </span>
                ) : null}
              </div>

              {/* The note comes back on every nearby response, empty or
                  not, and says that hospitals without a coordinate
                  cannot appear at all. That is why it is printed here
                  and not only on the empty state. */}
              <ServerNote>{active.data?.note}</ServerNote>

              <div className="mt-6 grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
                {hospitals.map((h, i) => (
                  <HospitalCard
                    key={h.id ?? h.facilityId ?? i}
                    hospital={h}
                    language={language}
                    hi={deva}
                    specialityLabels={specialityLabels}
                    index={String((located ? 0 : (page - 1) * PAGE_SIZE) + i + 1).padStart(2, '0')}
                  />
                ))}
              </div>

              {!located && pageCount > 1 ? (
                <nav
                  className="mt-8 flex items-center justify-between gap-4"
                  aria-label={t('Pages', 'पृष्ठ')}
                >
                  <Btn
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft size={17} aria-hidden="true" />
                    {t('Previous', 'पिछला')}
                  </Btn>
                  <span className="reg-index">
                    {t(`Page ${page} of ${pageCount}`, `पृष्ठ ${page} / ${pageCount}`)}
                  </span>
                  <Btn
                    variant="outline"
                    onClick={() => setPage((p) => Math.min(p + 1, pageCount))}
                    disabled={page >= pageCount}
                  >
                    {t('Next', 'अगला')}
                    <ChevronRight size={17} aria-hidden="true" />
                  </Btn>
                </nav>
              ) : null}
            </>
          )}
        </section>
      )}

      {/* ================= 04 · What this list is ================= */}
      {coverage ? (
        <section className="mt-16">
          <SectionHead
            index="04"
            eyebrow={t('Coverage', 'दायरा')}
            title={t('What this list does and does not hold', 'यह सूची क्या रखती है, क्या नहीं')}
          />

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Figure
              label={t('Empanelled hospitals', 'सूचीबद्ध अस्पताल')}
              value={numbers.format(coverage.totalActiveHospitals)}
              hint={t('Active in the registry', 'रजिस्टर में सक्रिय')}
            />
            <Figure
              tone="seal"
              label={t('With a map location', 'नक्शा-स्थान सहित')}
              value={numbers.format(coverage.withUsableCoordinates)}
              hint={t(
                'Only these can appear in a distance search',
                'दूरी वाली खोज में केवल ये आ सकते हैं',
              )}
            />
            <Figure
              tone="amber"
              label={t('Without a map location', 'नक्शा-स्थान रहित')}
              value={numbers.format(coverage.withoutUsableCoordinates)}
              hint={t(
                'Findable by district or name, never by distance',
                'ज़िले या नाम से मिलते हैं, दूरी से कभी नहीं',
              )}
            />
          </div>

          <p className="mt-6 font-mono text-[0.72rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
            {t('Government ', 'सरकारी ')}
            {numbers.format(coverage.government)}
            {' · '}
            {t('Private ', 'निजी ')}
            {numbers.format(coverage.private)}
            {' · '}
            {t('Public-private ', 'सरकारी-निजी ')}
            {numbers.format(coverage.publicPrivate)}
          </p>

          <p className="mt-5 max-w-2xl text-[0.9rem] leading-relaxed text-ink-soft">
            {t(
              'A hospital that was never empanelled under PM-JAY is not in this list, and one that has been de-empanelled drops out of it. So an empty result means "not in this registry" — it never means there is no hospital near you.',
              'जो अस्पताल पीएम-जय में कभी शामिल नहीं हुआ, वह इस सूची में नहीं है, और जिसकी सूचीबद्धता हट गई वह निकल जाता है। इसलिए खाली परिणाम का अर्थ है "इस रजिस्टर में नहीं" — यह कभी नहीं कहता कि आपके पास कोई अस्पताल नहीं है।',
            )}
          </p>

          <p className="mt-4 font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
            {t('Source: ', 'स्रोत: ')}
            {coverage.source}
          </p>
        </section>
      ) : null}
    </main>
  );
}
