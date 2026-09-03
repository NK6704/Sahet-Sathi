import React, { useMemo, useState } from 'react';
import { Phone, LogOut, Check, ShieldCheck, Users, Home, Info, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppState } from '@/state/store';
import { updateAshaProfile } from '@/services/asha';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Eyebrow,
  Figure,
  Pill,
  Stamp,
  LoadingState,
  ErrorState,
} from '@/components/ds';
import { Detail, formatDate } from '@/components/asha/parts';

/* =============================================================
   /asha/profile — who this account is, and the small set of things
   the worker is allowed to change about it.

   Deliberately NOT editable here: role, asha_code, and the villages
   assigned to her. Those are set by the block office. The database
   refuses a role change from the account holder outright — this page
   simply doesn't pretend otherwise.

   Two things this page used to get wrong:

     1. It offered eight languages. The portal is written in two, so
        seven of those buttons changed a database column and nothing
        else. A worker who picks Tamil and still reads Hindi has been
        lied to by the settings screen.
     2. It printed "0 households" and "0 villages" as though they
        were measurements. `households` defaults to 0 in the schema,
        so zero means "never filled in", not "no families". They are
        now shown as unrecorded until somebody records them.
   ============================================================= */

/* The two the portal is actually written in. These strings are the
   same ones the landing page and the app store use, so the value
   saved here is the value every other screen reads. */
const LANGUAGE_OPTIONS = [
  { value: 'English', label: 'English' },
  { value: 'हिन्दी', label: 'हिन्दी' },
];

export function AshaProfile() {
  const { user, profile, role, signOut, refreshProfile, loading, error: authError } = useAuth();
  const { language, setLanguage } = useAppState();
  /* The portal follows the choice made on the landing page. A saved
     profile language wins once there is one; before that the device
     preference is used rather than assuming Hindi. */
  const hi = (profile?.language || language || 'English') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const asha = profile?.asha ?? {};

  /* The live mapping. asha_villages is what row-level security and the
     emergency queue are both built on, so it is the list that decides
     what this account can actually see. */
  const assigned = useMemo(
    () => (profile?.assignedVillages ?? []).filter((v) => v?.name),
    [profile?.assignedVillages],
  );

  // The older free-text list on asha_profiles. Kept visible only when
  // there is no real mapping, and labelled as what it is.
  const rosterVillages = useMemo(
    () => (Array.isArray(asha.villages) ? asha.villages.filter(Boolean) : []),
    [asha.villages],
  );

  const initial = useMemo(
    () => ({
      full_name: profile?.full_name ?? '',
      phone: profile?.phone ?? '',
      // An unset column must not silently become Hindi.
      language: LANGUAGE_OPTIONS.some((l) => l.value === profile?.language)
        ? profile.language
        : 'English',
      district: profile?.district ?? '',
      state: profile?.state ?? '',
      supervisor_name: asha.supervisor_name ?? '',
      supervisor_phone: asha.supervisor_phone ?? '',
      // Empty rather than 0, so saving without touching it does not
      // write a figure the worker never gave.
      households: asha.households ? String(asha.households) : '',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile],
  );

  const [form, setForm] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setErr(null);
    setSaved(false);

    if (!form.full_name.trim()) {
      setErr(t('Your name cannot be empty.', 'नाम खाली नहीं हो सकता।'));
      return;
    }

    const householdsRaw = String(form.households).trim();
    if (householdsRaw && !/^\d+$/.test(householdsRaw)) {
      setErr(
        t(
          'Households must be a whole number, or left blank.',
          'परिवारों की संख्या पूरी संख्या हो, या खाली छोड़ें।',
        ),
      );
      return;
    }

    const patch = {
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      language: form.language,
      district: form.district.trim() || null,
      state: form.state.trim() || null,
      supervisor_name: form.supervisor_name.trim() || null,
      supervisor_phone: form.supervisor_phone.trim() || null,
    };
    // Only sent when she typed something. A blank box leaves the
    // stored figure exactly as it was.
    if (householdsRaw) patch.households = Number(householdsRaw);

    setBusy(true);
    try {
      await updateAshaProfile(user?.id, patch);
      // Take effect on this device immediately rather than waiting for
      // the profile to be re-read.
      setLanguage?.(form.language);
      await refreshProfile?.();
      setSaved(true);
      setEditing(false);
    } catch (e2) {
      setErr(e2.message || t('Could not save your details.', 'विवरण सेव नहीं हुआ।'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !profile) {
    return (
      <AshaShell
        eyebrow={t('Register 007 · Account', 'रजिस्टर 007 · खाता')}
        title={t('Your details', 'आपका विवरण')}
      >
        <LoadingState label={t('Loading your account', 'खाता लोड हो रहा है')} rows={2} />
      </AshaShell>
    );
  }

  /* A profile is never legitimately empty — if there is no row after
     loading finished, something is wrong rather than blank. */
  if (!profile) {
    return (
      <AshaShell
        eyebrow={t('Register 007 · Account', 'रजिस्टर 007 · खाता')}
        title={t('Your details', 'आपका विवरण')}
      >
        <ErrorState
          title={t("Couldn't load your account", 'खाता लोड नहीं हुआ')}
          body={
            authError?.message ||
            t(
              'Your worker record could not be read. Sign out and back in; if it keeps happening your block office needs to check the account.',
              'आपका रिकॉर्ड नहीं पढ़ा जा सका। साइन आउट कर फिर साइन इन करें; बार-बार हो तो ब्लॉक कार्यालय से कहें।',
            )
          }
          onRetry={() => refreshProfile?.()}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      </AshaShell>
    );
  }

  return (
    <AshaShell
      eyebrow={t('Register 007 · Account', 'रजिस्टर 007 · खाता')}
      title={t('Your details', 'आपका विवरण')}
      sub={t(
        'Your name, phone and language. Your ASHA code and the villages you cover are set by the block office.',
        'आपका नाम, फ़ोन और भाषा। आपका ASHA कोड और गाँव ब्लॉक कार्यालय तय करता है।',
      )}
      action={
        !editing ? (
          <Btn
            variant="asha"
            onClick={() => {
              setForm(initial);
              setEditing(true);
            }}
          >
            {t('Edit details', 'विवरण बदलें')}
          </Btn>
        ) : null
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {/* Identity — read only, on purpose */}
          <Card tone="asha" className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <Eyebrow>{t('ASHA worker', 'आशा कार्यकर्ता')}</Eyebrow>
                <h2 className="display-md mt-2 text-2xl">
                  {profile?.full_name || t('Name not set', 'नाम दर्ज नहीं')}
                </h2>
                <p className="mt-2 font-mono text-[0.8rem] uppercase tracking-[0.1em] text-ink-faint">
                  {asha.asha_code || t('Code not issued', 'कोड जारी नहीं')}
                  {asha.sub_centre ? ` · ${asha.sub_centre}` : ''}
                </p>
              </div>
              <Stamp
                kind={asha.active === false ? 'none' : 'verified'}
                label={asha.active === false ? t('Inactive', 'निष्क्रिय') : t('Active', 'सक्रिय')}
              />
            </div>

            <div className="mt-7 grid gap-5 border-t border-rule pt-6 sm:grid-cols-2">
              <Detail
                label={t('Role', 'भूमिका')}
                value={
                  role === 'admin'
                    ? t('Administrator', 'प्रशासक')
                    : t('ASHA worker', 'आशा कार्यकर्ता')
                }
              />
              <Detail label={t('Sub-centre', 'उप-केंद्र')} value={asha.sub_centre} />
              <Detail label={t('Block', 'ब्लॉक')} value={asha.block} />
              <Detail label={t('District', 'ज़िला')} value={profile?.district} />
              <Detail label={t('State', 'राज्य')} value={profile?.state} />
              <Detail
                label={t('Serving since', 'कब से')}
                value={asha.joined_on ? formatDate(asha.joined_on, hi) : null}
              />
            </div>

            {/* Villages you cover. This is the list that governs what
                the emergency queue will show, so when it is empty the
                page says what that means. */}
            <div className="mt-6 border-t border-rule pt-6">
              <Eyebrow>{t('Villages you cover', 'आपके गाँव')}</Eyebrow>

              {assigned.length ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {assigned.map((v) => (
                      <Pill key={v.id ?? v.name} tone="asha">
                        <MapPin size={12} aria-hidden="true" />
                        {v.name}
                        {v.isPrimary ? t(' · main', ' · मुख्य') : ''}
                      </Pill>
                    ))}
                  </div>
                  <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
                    {t(
                      'Changed only by your block office. Ask your ANM if this list is wrong.',
                      'यह सूची ब्लॉक कार्यालय बदलता है। गलत हो तो ANM से कहें।',
                    )}
                  </p>
                </>
              ) : (
                <div className="mt-3 flex items-start gap-3 rounded-sm bg-amber-soft p-4">
                  <Info size={17} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[0.9rem] leading-relaxed text-ink-soft">
                      {t(
                        'No village is mapped to this account. Until an administrator maps one, your emergency queue will be empty by construction rather than because nothing has been raised.',
                        'इस खाते से कोई गाँव नहीं जुड़ा है। जब तक प्रशासक कोई गाँव नहीं जोड़ता, आपकी आपात सूची खाली रहेगी — इसलिए नहीं कि कुछ नहीं हुआ, बल्कि इसलिए कि कोई गाँव जुड़ा नहीं है।',
                      )}
                    </p>
                    {rosterVillages.length ? (
                      <>
                        <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
                          {t(
                            'The roster has these village names against your code, but they are only text and are not the mapping the app uses:',
                            'रोस्टर में आपके कोड के साथ ये नाम दर्ज हैं, पर ये केवल लिखे हुए नाम हैं और ऐप इनका इस्तेमाल नहीं करता:',
                          )}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {rosterVillages.map((v) => (
                            <Pill key={v} tone="neutral">
                              {v}
                            </Pill>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* The editable part */}
          <Card className="p-6">
            <Eyebrow>{t('Details you can change', 'जो आप बदल सकती हैं')}</Eyebrow>

            {!editing ? (
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <Detail label={t('Name', 'नाम')} value={profile?.full_name} />
                <Detail label={t('Phone', 'फ़ोन')} value={profile?.phone} />
                <Detail
                  label={t('Language', 'भाषा')}
                  value={
                    profile?.language ||
                    t('Not set — showing English', 'दर्ज नहीं — अंग्रेज़ी में दिख रहा है')
                  }
                />
                <Detail
                  label={t('Households', 'परिवार')}
                  value={
                    asha.households
                      ? String(asha.households)
                      : t('Not recorded', 'दर्ज नहीं')
                  }
                />
                <Detail label={t('Supervisor', 'पर्यवेक्षक')} value={asha.supervisor_name} />
                <Detail
                  label={t('Supervisor phone', 'पर्यवेक्षक फ़ोन')}
                  value={asha.supervisor_phone}
                />
              </div>
            ) : (
              <form onSubmit={save} className="mt-6 space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label={t('Name', 'नाम')} required>
                    <input
                      value={form.full_name}
                      onChange={set('full_name')}
                      className="field w-full"
                      required
                    />
                  </FormField>

                  <FormField label={t('Phone', 'फ़ोन')}>
                    <input
                      value={form.phone}
                      onChange={set('phone')}
                      type="tel"
                      inputMode="tel"
                      className="field w-full"
                    />
                  </FormField>

                  <FormField
                    label={t('Language', 'भाषा')}
                    hint={t(
                      'The portal is written in these two languages only. Changing this changes what you read on every screen.',
                      'पोर्टल केवल इन दो भाषाओं में लिखा है। इसे बदलने से हर पन्ने की भाषा बदल जाती है।',
                    )}
                  >
                    <select
                      value={form.language}
                      onChange={set('language')}
                      className="field w-full"
                    >
                      {LANGUAGE_OPTIONS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField
                    label={t('Households you cover', 'आपके परिवार')}
                    hint={t(
                      'Your own count, from your paper register. Leave it blank if you have not counted.',
                      'आपकी अपनी गिनती, आपके काग़ज़ी रजिस्टर से। गिनी न हो तो खाली छोड़ें।',
                    )}
                  >
                    <input
                      value={form.households}
                      onChange={set('households')}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      className="field w-full"
                      placeholder={t('Not recorded', 'दर्ज नहीं')}
                    />
                  </FormField>

                  <FormField
                    label={t('District', 'ज़िला')}
                    hint={t(
                      'Used to preselect your district when you search for hospitals.',
                      'अस्पताल खोजते समय आपका ज़िला पहले से चुनने के लिए।',
                    )}
                  >
                    <input
                      value={form.district}
                      onChange={set('district')}
                      className="field w-full"
                    />
                  </FormField>

                  <FormField label={t('State', 'राज्य')}>
                    <input value={form.state} onChange={set('state')} className="field w-full" />
                  </FormField>

                  <FormField label={t('Supervisor name', 'पर्यवेक्षक का नाम')}>
                    <input
                      value={form.supervisor_name}
                      onChange={set('supervisor_name')}
                      className="field w-full"
                    />
                  </FormField>

                  <FormField label={t('Supervisor phone', 'पर्यवेक्षक का फ़ोन')}>
                    <input
                      value={form.supervisor_phone}
                      onChange={set('supervisor_phone')}
                      type="tel"
                      inputMode="tel"
                      className="field w-full"
                    />
                  </FormField>
                </div>

                {err ? (
                  <p className="text-sm font-semibold text-siren" role="alert">
                    {err}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
                  <Btn type="submit" variant="asha" disabled={busy}>
                    {busy ? t('Saving…', 'सेव हो रहा है…') : t('Save changes', 'बदलाव सेव करें')}
                  </Btn>
                  <Btn
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setErr(null);
                      setForm(initial);
                    }}
                    disabled={busy}
                  >
                    {t('Cancel', 'रद्द करें')}
                  </Btn>
                </div>
              </form>
            )}

            {saved && !editing ? (
              <p
                className="mt-5 flex items-center gap-2 text-sm font-semibold text-seal"
                role="status"
              >
                <Check size={16} aria-hidden="true" />
                {t('Saved.', 'सेव हो गया।')}
              </p>
            ) : null}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <Eyebrow>{t('Your area', 'आपका क्षेत्र')}</Eyebrow>
            <div className="mt-4 space-y-4">
              <Figure
                value={asha.households ? String(asha.households) : '—'}
                label={t('Households', 'परिवार')}
                tone={asha.households ? 'asha' : 'neutral'}
                hint={
                  <span className="flex items-center gap-1.5">
                    <Home size={12} aria-hidden="true" />
                    {asha.households
                      ? t('Your own count', 'आपकी अपनी गिनती')
                      : t('Not recorded yet', 'अभी दर्ज नहीं')}
                  </span>
                }
              />
              <Figure
                value={String(assigned.length)}
                label={t('Villages', 'गाँव')}
                tone={assigned.length ? 'seal' : 'amber'}
                hint={
                  <span className="flex items-center gap-1.5">
                    <Users size={12} aria-hidden="true" />
                    {t('Mapped by the block office', 'ब्लॉक कार्यालय द्वारा जोड़े गए')}
                  </span>
                }
              />
            </div>
          </Card>

          {asha.supervisor_phone ? (
            <Card tone="seal" className="p-5">
              <Eyebrow>{t('Your supervisor', 'आपका पर्यवेक्षक')}</Eyebrow>
              <p className="mt-2 text-[0.95rem] font-semibold text-ink">
                {asha.supervisor_name || t('Name not recorded', 'नाम दर्ज नहीं')}
              </p>
              <Btn
                as="a"
                href={`tel:${String(asha.supervisor_phone).replace(/[^\d+]/g, '')}`}
                variant="primary"
                className="mt-4 w-full"
              >
                <Phone size={17} aria-hidden="true" />
                {asha.supervisor_phone}
              </Btn>
            </Card>
          ) : (
            <Card className="p-5">
              <Eyebrow>{t('Your supervisor', 'आपका पर्यवेक्षक')}</Eyebrow>
              <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-soft">
                {t(
                  'No supervisor number is on this record. Add your ANM’s number above so it is one tap away when you need it.',
                  'इस रिकॉर्ड में पर्यवेक्षक का नंबर नहीं है। ऊपर अपनी ANM का नंबर जोड़ें ताकि ज़रूरत पर एक टैप में मिल जाए।',
                )}
              </p>
            </Card>
          )}

          {/* Says out loud what the database enforces. */}
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="shrink-0 text-seal" aria-hidden="true" />
              <Eyebrow>{t('Account security', 'खाता सुरक्षा')}</Eyebrow>
            </div>
            <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-soft">
              {t(
                'Your role cannot be changed from this page, or from any page. Only the block administrator can change it, and every change is recorded.',
                'आपकी भूमिका इस या किसी भी पन्ने से नहीं बदली जा सकती। केवल ब्लॉक प्रशासक बदल सकता है, और हर बदलाव दर्ज होता है।',
              )}
            </p>
            <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
              {t('Signed in as ', 'साइन इन: ')}
              <span className="font-mono">{user?.email || profile?.id}</span>
            </p>
          </Card>

          <Btn variant="outline" className="w-full" onClick={() => signOut?.()}>
            <LogOut size={16} aria-hidden="true" />
            {t('Sign out', 'साइन आउट')}
          </Btn>
        </aside>
      </div>
    </AshaShell>
  );
}

function FormField({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="eyebrow">
        {label}
        {required ? <span className="ml-1 text-siren">*</span> : null}
      </span>
      <div className="mt-2">{children}</div>
      {hint ? (
        <span className="mt-2 block text-[0.8rem] leading-snug text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}
