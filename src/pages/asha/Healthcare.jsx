import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, Search, Info, Loader2, Siren } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppState } from '@/state/store';
import { useAsync } from '@/lib/useAsync';
import { getNearbyHospitals, searchHospitals, getHospitalMeta } from '@/services/api';
import { AshaShell } from '@/components/asha/AshaShell';
import { HospitalCard } from '@/components/care/HospitalCard';
import {
  Btn,
  Card,
  Eyebrow,
  Stamp,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';

/* =============================================================
   /asha/healthcare — where to send people.

   Every row on this page is a hospital empanelled under PM-JAY, as
   published in the National Health Authority registry, rendered by
   the same card the citizen-facing Care page uses. There is one
   card in this codebase for a hospital and this page does not keep
   a second copy of it: a facility row that reads differently to a
   worker than to the family she is advising is a bug waiting to
   happen.

   The page used to list hand-written health centres with distances
   like "22.4 km" attached to them. Nothing had measured those. A
   distance is now printed only when the nearby search returns one,
   because that endpoint is the only thing that knows which point it
   measured from.

   The registry publishes no pincode and no city for these
   facilities, so there is no pincode box. Saying so is better than
   offering a search that silently ignores what was typed.
   ============================================================= */

const TYPES = [
  { value: '', en: 'Any type', hi: 'कोई भी' },
  { value: 'G', en: 'Government', hi: 'सरकारी' },
  { value: 'P', en: 'Private', hi: 'निजी' },
  { value: 'PP', en: 'Public-private', hi: 'सार्वजनिक-निजी' },
];

const RADII = [10, 25, 50];
const PAGE_SIZE = 12;
const NEARBY_LIMIT = 12;

const normalise = (v) => String(v ?? '').trim().toLowerCase();

/** The server's own note, printed verbatim. */
function ServerNote({ children }) {
  if (!children) return null;
  return (
    <Card className="mb-6 flex items-start gap-3 p-5">
      <Info size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

function Chips({ label, options, value, onChange }) {
  return (
    <div>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {options.map((opt) => {
          const on = String(value) === String(opt.value);
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={on}
              className={`flex min-h-[2.75rem] shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition ${
                on
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-paper-2 text-ink-soft hover:border-ink-faint hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AshaHealthcare() {
  const { profile } = useAuth();
  const { language, coords, setCoords } = useAppState();
  const hi = (profile?.language || language || 'English') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  /* 'ask' | 'locating' | 'located' | 'denied' | 'timeout' | 'unsupported' | 'failed'.
     A location already shared elsewhere in the app is reused rather
     than asked for twice. */
  const [geo, setGeo] = useState(coords ? 'located' : 'ask');
  const [view, setView] = useState(coords ? 'nearby' : 'locate');

  const [radiusKm, setRadiusKm] = useState(25);
  const [typeCode, setTypeCode] = useState('');
  const [speciality, setSpeciality] = useState('');

  const [stateCode, setStateCode] = useState('');
  const [districtCode, setDistrictCode] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [page, setPage] = useState(1);
  const [touched, setTouched] = useState(false);

  function requestLocation() {
    if (!navigator.geolocation) {
      setGeo('unsupported');
      setView('browse');
      return;
    }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeo('located');
        setView('nearby');
      },
      (err) => {
        // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
        setGeo(err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'failed');
        // No coordinate is invented in place of the missing one.
        setView('browse');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  /* ---- Reference data ----------------------------------------- */

  const meta = useAsync(
    () => getHospitalMeta(stateCode ? { stateCode: Number(stateCode) } : {}),
    [stateCode],
  );

  const states = meta.data?.states ?? [];
  const specialities = meta.data?.specialities ?? [];
  const coverage = meta.data?.coverage ?? null;

  const districts = useMemo(() => {
    const rows = (meta.data?.districts ?? []).filter(
      (d) => !stateCode || String(d.stateCode) === String(stateCode),
    );
    return [...rows].sort((a, b) => {
      if (a.placeholder !== b.placeholder) return a.placeholder ? 1 : -1;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [meta.data, stateCode]);

  const specialityLabels = useMemo(() => {
    const map = {};
    for (const s of specialities) map[s.code] = s.name;
    return map;
  }, [specialities]);

  /* Seed the browse controls from the worker's own profile when it
     names a state or district the registry also knows. A name that
     does not match is left alone rather than approximated, and the
     seeding stops for good once she has touched either select. */
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

  const latKey = coords ? Number(coords.lat).toFixed(5) : '';
  const lngKey = coords ? Number(coords.lng).toFixed(5) : '';

  const nearby = useAsync(
    () =>
      getNearbyHospitals({
        lat: coords?.lat,
        lng: coords?.lng,
        radiusKm,
        type: typeCode || undefined,
        speciality: speciality || undefined,
        limit: NEARBY_LIMIT,
      }),
    [latKey, lngKey, radiusKm, typeCode, speciality],
    { skip: view !== 'nearby' || !coords },
  );

  // The registry search needs at least one of q, stateCode or
  // districtCode; 39,000 hospitals in name order is not a search.
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
  const pageCount = browse.data?.pageCount ?? 1;

  const chooseType = (code) => {
    setTypeCode(code);
    setPage(1);
  };

  const geoExplanation = {
    denied: t(
      'Location permission was refused, so no distance can be measured. Your location will not be guessed — choose a state and district instead.',
      'लोकेशन की अनुमति नहीं मिली, इसलिए दूरी नहीं नापी जा सकती। आपकी जगह का अनुमान नहीं लगाया जाएगा — राज्य और ज़िला चुनें।',
    ),
    timeout: t(
      'The phone did not return a location in time. Try again, or choose a state and district instead.',
      'फ़ोन से समय पर लोकेशन नहीं मिली। दोबारा कोशिश करें, या राज्य और ज़िला चुनें।',
    ),
    unsupported: t(
      'This phone cannot share its location with the browser, so search by district instead.',
      'यह फ़ोन ब्राउज़र को अपनी जगह नहीं बता सकता, इसलिए ज़िले से खोजें।',
    ),
    failed: t(
      'The location could not be read. Search by district instead.',
      'जगह नहीं पढ़ी जा सकी। ज़िले से खोजें।',
    ),
  }[geo];

  return (
    <AshaShell
      eyebrow={t('Register 004 · Hospitals', 'रजिस्टर 004 · अस्पताल')}
      title={t('Where to send people', 'कहाँ भेजें')}
      sub={t(
        'Hospitals empanelled under PM-JAY, as published in the National Health Authority registry. Nothing on this page is added by hand.',
        'पीएम-जय में सूचीबद्ध अस्पताल, जैसा राष्ट्रीय स्वास्थ्य प्राधिकरण के रजिस्टर में प्रकाशित है। इस पन्ने पर कुछ भी हाथ से नहीं जोड़ा गया।',
      )}
    >
      {/* ---- The location gate ----------------------------------- */}
      {view === 'locate' ? (
        <Card tone="asha" className="p-6 sm:p-8">
          <Eyebrow>{t('Nearest first', 'सबसे नज़दीक पहले')}</Eyebrow>
          <h2 className="display-md mt-3 text-2xl">
            {t('Find the nearest hospital', 'सबसे नज़दीकी अस्पताल खोजें')}
          </h2>
          <p className="lede mt-3 max-w-2xl">
            {t(
              'Share this phone’s location and the list is sorted by straight-line distance from where you are standing. Without it, hospitals can still be found by state and district.',
              'इस फ़ोन की जगह साझा करें और सूची आपकी जगह से सीधी दूरी के क्रम में लगेगी। इसके बिना भी राज्य और ज़िले से अस्पताल खोजे जा सकते हैं।',
            )}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Btn variant="asha" size="lg" onClick={requestLocation} disabled={geo === 'locating'}>
              {geo === 'locating' ? (
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              ) : (
                <MapPin size={18} aria-hidden="true" />
              )}
              {geo === 'locating'
                ? t('Finding you…', 'आपकी जगह पता की जा रही है…')
                : t('Use my location', 'मेरी जगह इस्तेमाल करें')}
            </Btn>
            <Btn variant="outline" size="lg" onClick={() => setView('browse')}>
              <Search size={18} aria-hidden="true" />
              {t('Search by district instead', 'इसकी जगह ज़िले से खोजें')}
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          {/* ---- Controls ---------------------------------------- */}
          <div className="space-y-6">
            {geoExplanation ? (
              <Card tone="amber" className="flex items-start gap-3 p-5">
                <Info size={17} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
                <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">
                  {geoExplanation}
                </p>
              </Card>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Btn
                variant={located ? 'primary' : 'outline'}
                onClick={coords ? () => setView('nearby') : requestLocation}
                disabled={geo === 'locating'}
              >
                <MapPin size={16} aria-hidden="true" />
                {t('Nearest to me', 'मेरे सबसे नज़दीक')}
              </Btn>
              <Btn
                variant={view === 'browse' ? 'primary' : 'outline'}
                onClick={() => setView('browse')}
              >
                <Search size={16} aria-hidden="true" />
                {t('By state and district', 'राज्य और ज़िले से')}
              </Btn>
            </div>

            <Chips
              label={t('Ownership', 'स्वामित्व')}
              options={TYPES.map((x) => ({ value: x.value, label: t(x.en, x.hi) }))}
              value={typeCode}
              onChange={chooseType}
            />

            {located ? (
              <Chips
                label={t('How far to look', 'कितनी दूर तक देखें')}
                options={RADII.map((r) => ({
                  value: r,
                  label: t(`${r} km`, `${r} कि.मी.`),
                }))}
                value={radiusKm}
                onChange={setRadiusKm}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="eyebrow">{t('State', 'राज्य')}</span>
                  <select
                    value={stateCode}
                    onChange={(e) => {
                      setTouched(true);
                      setStateCode(e.target.value);
                      setDistrictCode('');
                      setPage(1);
                    }}
                    disabled={meta.loading || !states.length}
                    className="field mt-2 w-full"
                  >
                    <option value="">
                      {meta.loading
                        ? t('Loading states…', 'राज्य लोड हो रहे हैं…')
                        : t('Choose a state', 'राज्य चुनें')}
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
                    onChange={(e) => {
                      setTouched(true);
                      setDistrictCode(e.target.value);
                      setPage(1);
                    }}
                    disabled={meta.loading || !stateCode || !districts.length}
                    className="field mt-2 w-full"
                  >
                    <option value="">
                      {!stateCode
                        ? t('Choose a state first', 'पहले राज्य चुनें')
                        : t('Any district', 'कोई भी ज़िला')}
                    </option>
                    {districts.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.placeholder ? t(`Code ${d.code}`, `कोड ${d.code}`) : d.name}
                      </option>
                    ))}
                  </select>
                  {coverage && coverage.districtNamesAvailable === false ? (
                    <span className="mt-2 block text-[0.8rem] leading-snug text-ink-faint">
                      {t(
                        'The registry did not supply district names at import, so districts are listed by their code.',
                        'आयात के समय रजिस्टर ने ज़िलों के नाम नहीं दिए, इसलिए ज़िले उनके कोड से दिखते हैं।',
                      )}
                    </span>
                  ) : null}
                </label>

                <form
                  className="sm:col-span-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setNameQuery(nameDraft.trim());
                    setPage(1);
                  }}
                >
                  <label className="block">
                    <span className="eyebrow">{t('Hospital name', 'अस्पताल का नाम')}</span>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        className="field w-full"
                        placeholder={t('Part of the name', 'नाम का कोई हिस्सा')}
                        aria-label={t('Search hospitals by name', 'नाम से अस्पताल खोजें')}
                      />
                      <Btn type="submit" variant="primary">
                        <Search size={16} aria-hidden="true" />
                        {t('Search', 'खोजें')}
                      </Btn>
                    </div>
                  </label>
                </form>
              </div>
            )}

            {specialities.length ? (
              <label className="block">
                <span className="eyebrow">{t('Speciality', 'विशेषज्ञता')}</span>
                <select
                  value={speciality}
                  onChange={(e) => {
                    setSpeciality(e.target.value);
                    setPage(1);
                  }}
                  className="field mt-2 w-full sm:max-w-md"
                >
                  <option value="">{t('Any speciality', 'कोई भी विशेषज्ञता')}</option>
                  {specialities.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {meta.error ? (
            <Card tone="amber" className="mt-6 flex items-start gap-3 p-5">
              <Info size={17} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
              <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">
                {t(
                  'The state, district and speciality lists could not be loaded, so those filters are unavailable. Hospital names are unaffected.',
                  'राज्य, ज़िला और विशेषज्ञता की सूचियाँ लोड नहीं हुईं, इसलिए वे फ़िल्टर उपलब्ध नहीं हैं। अस्पतालों के नाम पर इसका असर नहीं है।',
                )}
              </p>
            </Card>
          ) : null}

          {/* ---- Results ----------------------------------------- */}
          <div className="mt-10">
            {!located && !browseReady ? (
              <EmptyState
                title={t('Choose where to look', 'कहाँ देखें, चुनें')}
                body={t(
                  'Pick a state, or type part of a hospital name. The registry holds close to 39,000 hospitals and will not list them all at once.',
                  'राज्य चुनें, या अस्पताल के नाम का कोई हिस्सा लिखें। रजिस्टर में लगभग 39,000 अस्पताल हैं और वे सब एक साथ नहीं दिखाए जाते।',
                )}
              />
            ) : active.loading ? (
              <LoadingState label={t('Searching the registry', 'रजिस्टर खोजा जा रहा है')} rows={3} />
            ) : active.error ? (
              <ErrorState
                title={t("Couldn't reach the registry", 'रजिस्टर तक नहीं पहुँच सके')}
                body={
                  active.error.message ||
                  t(
                    'The hospital registry did not answer. If someone needs care right now, call 108.',
                    'अस्पताल रजिस्टर ने जवाब नहीं दिया। अगर अभी किसी को इलाज चाहिए तो 108 पर कॉल करें।',
                  )
                }
                onRetry={active.reload}
                retryLabel={t('Try again', 'फिर कोशिश करें')}
              />
            ) : (
              <>
                <ServerNote>{active.data?.note}</ServerNote>

                {hospitals.length === 0 ? (
                  <EmptyState
                    title={t('Nothing in the registry matches', 'रजिस्टर में कुछ मेल नहीं खाता')}
                    body={t(
                      'This list covers hospitals empanelled under PM-JAY only, so a hospital that exists may simply not be in it. Widen the search rather than assuming there is nothing there.',
                      'इस सूची में केवल पीएम-जय में सूचीबद्ध अस्पताल हैं, इसलिए कोई मौजूद अस्पताल इसमें न भी हो। यह मान लेने के बजाय कि वहाँ कुछ नहीं है, खोज को चौड़ा करें।',
                    )}
                    action={
                      located ? (
                        <Btn variant="outline" onClick={() => setView('browse')}>
                          {t('Search by district instead', 'इसकी जगह ज़िले से खोजें')}
                        </Btn>
                      ) : null
                    }
                  />
                ) : (
                  <>
                    <p className="mb-5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                      {located
                        ? t(
                            `${hospitals.length} within ${radiusKm} km`,
                            `${radiusKm} कि.मी. के भीतर ${hospitals.length}`,
                          )
                        : t(
                            `${hospitals.length} of ${browse.data?.count ?? hospitals.length} shown`,
                            `${browse.data?.count ?? hospitals.length} में से ${hospitals.length} दिख रहे हैं`,
                          )}
                    </p>

                    <div className="grid gap-4 lg:grid-cols-2">
                      {hospitals.map((h, i) => (
                        <HospitalCard
                          key={h.id ?? h.facilityId ?? i}
                          hospital={h}
                          hi={hi}
                          specialityLabels={specialityLabels}
                          index={String(
                            (located ? 0 : (page - 1) * PAGE_SIZE) + i + 1,
                          ).padStart(2, '0')}
                        />
                      ))}
                    </div>

                    {!located && pageCount > 1 ? (
                      <div className="mt-8 flex flex-wrap items-center gap-3">
                        <Btn
                          variant="outline"
                          onClick={() => setPage((p) => Math.max(p - 1, 1))}
                          disabled={page <= 1}
                        >
                          {t('Previous', 'पिछला')}
                        </Btn>
                        <span className="font-mono text-[0.75rem] uppercase tracking-[0.1em] text-ink-faint">
                          {t(`Page ${page} of ${pageCount}`, `पृष्ठ ${page} / ${pageCount}`)}
                        </span>
                        <Btn
                          variant="outline"
                          onClick={() => setPage((p) => Math.min(p + 1, pageCount))}
                          disabled={page >= pageCount}
                        >
                          {t('Next', 'अगला')}
                        </Btn>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>

          {/* ---- What the registry does and does not hold -------- */}
          {coverage ? (
            <Card className="mt-10 p-5 sm:p-6">
              <Stamp
                kind="verified"
                label={t('Registry', 'रजिस्टर')}
                source={coverage.source || undefined}
              />
              <p className="mt-4 max-w-3xl text-[0.85rem] leading-relaxed text-ink-soft">
                {t(
                  `${coverage.totalActiveHospitals} hospitals are on record. ${coverage.withoutUsableCoordinates} of them carry no usable map location, so they can be found by name and district but can never appear in a distance search.`,
                  `${coverage.totalActiveHospitals} अस्पताल दर्ज हैं। उनमें ${coverage.withoutUsableCoordinates} का नक्शा-स्थान इस्तेमाल लायक नहीं है, इसलिए वे नाम और ज़िले से मिलेंगे पर दूरी की खोज में कभी नहीं दिखेंगे।`,
                )}
              </p>
              <p className="mt-3 max-w-3xl text-[0.85rem] leading-relaxed text-ink-faint">
                {t(
                  'The registry publishes no pincode and no city for these facilities, so this page cannot search by them. Phone numbers are as listed and have not been dialled to check.',
                  'रजिस्टर इन सुविधाओं का पिनकोड और शहर प्रकाशित नहीं करता, इसलिए यह पन्ना उनसे नहीं खोज सकता। फ़ोन नंबर जैसे दर्ज हैं वैसे दिखाए गए हैं, उन्हें मिलाकर जाँचा नहीं गया है।',
                )}
              </p>
            </Card>
          ) : null}
        </>
      )}

      {/* 108 stays reachable from this page too: choosing a hospital
          is not the first step when someone is dying. */}
      <Card tone="siren" className="mt-8 flex flex-wrap items-center justify-between gap-5 p-6">
        <p className="min-w-0 max-w-xl text-[0.95rem] leading-relaxed text-ink-soft">
          {t(
            'If someone cannot wait for a hospital to be chosen, call 108 now and sort out the paperwork afterwards.',
            'अगर कोई अस्पताल चुनने का इंतज़ार नहीं कर सकता, तो अभी 108 पर कॉल करें और काग़ज़ी काम बाद में करें।',
          )}
        </p>
        <Btn as="a" href="tel:108" variant="siren" size="lg">
          <Siren size={19} aria-hidden="true" />
          {t('Call 108', '108 पर कॉल करें')}
        </Btn>
      </Card>
    </AshaShell>
  );
}
