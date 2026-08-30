import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'wouter';
import { ArrowRight, Plus, MapPin, Hospital, Phone } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import {
  listReferrals,
  createReferral,
  listFacilities,
  REFERRAL_STATUSES,
  severityMeta,
  SEVERITIES,
} from '@/services/asha';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Eyebrow,
  LoadingState,
  EmptyState,
  ErrorState,
  Stamp,
} from '@/components/ds';
import {
  StatusBadge,
  SeverityBadge,
  FilterBar,
  formatDate,
} from '@/components/asha/parts';

/* =============================================================
   /asha/referrals — the referral register, and the form that adds
   to it.

   The seven statuses from the brief are the spine of this screen.
   ============================================================= */

export function AshaReferrals() {
  const { profile, user } = useAuth();
  const hi = (profile?.language ?? 'Hindi') !== 'English';
  const t = (en, dev) => (hi ? dev : en);
  const ashaId = user?.id;

  const [search, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(search.get('status') || 'open');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(search.get('new') === '1');

  const {
    data,
    error,
    loading: fetching,
    reload,
    setData,
  } = useAsync(() => listReferrals(ashaId), [ashaId], { skip: !ashaId });

  // No id yet means auth is still resolving, not that the register is
  // empty.
  const loading = fetching || !ashaId;

  // Prefill from an alert, when the worker came here via
  // "Raise a referral".
  const prefill = useMemo(
    () => ({
      patient_name: search.get('name') || '',
      village: search.get('village') || '',
      patient_phone: search.get('phone') || '',
      reason: search.get('reason') || '',
      urgency: search.get('urgency') || 'moderate',
      alert_id: search.get('alert') || null,
    }),
    [search],
  );

  const OPEN = ['pending', 'acknowledged', 'contacted', 'referred', 'in_progress'];

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status === 'open') out = out.filter((r) => OPEN.includes(r.status));
    else if (status !== 'all') out = out.filter((r) => r.status === status);

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((r) =>
        [r.patient_name, r.village, r.reason, r.facility_name]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q)),
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, status, query]);

  const count = (v) =>
    v === 'open'
      ? (data ?? []).filter((r) => OPEN.includes(r.status)).length
      : v === 'all'
      ? (data ?? []).length
      : (data ?? []).filter((r) => r.status === v).length;

  const options = [
    { value: 'open', label: t('Open', 'चालू'), count: count('open') },
    ...REFERRAL_STATUSES.map((s) => ({
      value: s.value,
      label: hi ? s.label_hi : s.label,
      count: count(s.value),
    })),
    { value: 'all', label: t('All', 'सभी'), count: count('all') },
  ];

  function changeStatus(next) {
    setStatus(next);
    const p = new URLSearchParams(search);
    if (next === 'open') p.delete('status');
    else p.set('status', next);
    setSearchParams(p, { replace: true });
  }

  async function submit(payload) {
    const created = await createReferral(ashaId, payload);
    setData((prev) => [created, ...(prev ?? [])]);
    setFormOpen(false);
    const p = new URLSearchParams(search);
    ['new', 'name', 'village', 'phone', 'reason', 'urgency', 'alert'].forEach((k) => p.delete(k));
    setSearchParams(p, { replace: true });
  }

  return (
    <AshaShell
      eyebrow={t('Register 003 · Referrals', 'रजिस्टर 003 · रेफरल')}
      title={t('Referrals', 'रेफरल')}
      sub={t(
        'Every person you have sent to a facility, and where each one stands.',
        'हर व्यक्ति जिसे आपने सुविधा भेजा, और उसकी स्थिति।',
      )}
      action={
        <Btn variant="asha" onClick={() => setFormOpen((v) => !v)}>
          <Plus size={17} aria-hidden="true" />
          {formOpen ? t('Close form', 'फ़ॉर्म बंद करें') : t('New referral', 'नया रेफरल')}
        </Btn>
      }
    >
      {formOpen ? (
        <NewReferralForm
          hi={hi}
          prefill={prefill}
          onSubmit={submit}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}

      <FilterBar
        options={options}
        value={status}
        onChange={changeStatus}
        search={query}
        onSearch={setQuery}
        searchPlaceholder={t('Search name, village, reason', 'नाम, गाँव, कारण खोजें')}
        label={t('Status', 'स्थिति')}
      />

      {loading ? (
        <LoadingState label={t('Loading referrals', 'रेफरल लोड हो रहे हैं')} rows={4} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load referrals", 'रेफरल लोड नहीं हुए')}
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            query
              ? t('No referrals match that', 'कोई मेल नहीं मिला')
              : t('Nothing in this group', 'इस समूह में कुछ नहीं')
          }
          body={t(
            'Raise a referral when someone needs to be seen at a facility. It keeps a record you can follow up.',
            'जब किसी को सुविधा पर दिखाना हो, रेफरल बनाएँ। इससे रिकॉर्ड रहता है।',
          )}
          action={
            <Btn variant="asha" onClick={() => setFormOpen(true)}>
              <Plus size={17} aria-hidden="true" />
              {t('New referral', 'नया रेफरल')}
            </Btn>
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ReferralRow key={r.id} referral={r} hi={hi} />
          ))}
        </div>
      )}
    </AshaShell>
  );
}

function ReferralRow({ referral, hi }) {
  const t = (en, dev) => (hi ? dev : en);
  const meta = severityMeta(referral.urgency);

  return (
    <Card tone={meta.tone} lift className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={referral.status} hi={hi} />
            <SeverityBadge severity={referral.urgency} hi={hi} />
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
              {formatDate(referral.referred_on, hi)}
            </span>
          </div>

          <h3 className="mt-3 text-lg font-semibold leading-snug text-ink">
            {referral.patient_name}
            {referral.patient_age ? (
              <span className="ml-2 font-mono text-sm font-normal text-ink-faint">
                {referral.patient_age}
                {t('y', 'व')}
              </span>
            ) : null}
          </h3>

          <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">{referral.reason}</p>

          {referral.outcome ? (
            <p className="mt-3 border-l-2 border-seal pl-3 text-[0.85rem] leading-relaxed text-ink-soft">
              <span className="font-semibold text-seal">{t('Outcome: ', 'परिणाम: ')}</span>
              {referral.outcome}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.85rem] text-ink-faint">
            {referral.village ? (
              <span className="flex items-center gap-1.5">
                <MapPin size={13} aria-hidden="true" />
                {referral.village}
              </span>
            ) : null}
            {referral.facility_name ? (
              <span className="flex items-center gap-1.5">
                <Hospital size={13} aria-hidden="true" />
                {referral.facility_name}
              </span>
            ) : null}
            {referral.patient_phone ? (
              <a
                href={`tel:${referral.patient_phone.replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-1.5 font-semibold text-seal hover:underline"
              >
                <Phone size={13} aria-hidden="true" />
                {referral.patient_phone}
              </a>
            ) : null}
          </div>
        </div>

        <Btn as={Link} href={`/asha/referrals/${referral.id}`} variant="outline">
          {t('Open', 'खोलें')}
          <ArrowRight size={15} aria-hidden="true" />
        </Btn>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------
   The form.

   Long labels, tall fields, one column on a phone. Nothing clever:
   this gets filled in on a doorstep, sometimes in the rain.
   ------------------------------------------------------------- */
function NewReferralForm({ hi, prefill, onSubmit, onCancel }) {
  const t = (en, dev) => (hi ? dev : en);

  const [form, setForm] = useState({
    patient_name: '',
    patient_age: '',
    patient_gender: '',
    patient_phone: '',
    village: '',
    reason: '',
    symptoms: '',
    urgency: 'moderate',
    facility_id: '',
    facility_name: '',
    notes: '',
    alert_id: null,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(prefill).filter(([, v]) => v)) }));
  }, [prefill]);

  const facilities = useAsync(() => listFacilities({}), []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);

    if (!form.patient_name.trim()) {
      setErr(t('Enter the person’s name.', 'व्यक्ति का नाम भरें।'));
      return;
    }
    if (!form.reason.trim()) {
      setErr(t('Enter why you are referring them.', 'रेफर करने का कारण भरें।'));
      return;
    }

    const chosen = (facilities.data ?? []).find((f) => f.id === form.facility_id);

    setBusy(true);
    try {
      await onSubmit({
        patient_name: form.patient_name.trim(),
        patient_age: form.patient_age ? Number(form.patient_age) : null,
        patient_gender: form.patient_gender || null,
        patient_phone: form.patient_phone.trim() || null,
        village: form.village.trim() || null,
        reason: form.reason.trim(),
        symptoms: form.symptoms.trim() || null,
        urgency: form.urgency,
        facility_id: form.facility_id || null,
        facility_name: chosen?.name || null,
        notes: form.notes.trim() || null,
        alert_id: form.alert_id || null,
        status: 'pending',
      });
    } catch (e2) {
      setErr(e2.message || t('Could not save the referral.', 'रेफरल सेव नहीं हुआ।'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone="asha" className="mb-8 p-6 sm:p-8">
      <Eyebrow>{t('New referral', 'नया रेफरल')}</Eyebrow>
      <h2 className="display-md mt-3 text-2xl">
        {t('Who are you sending, and why', 'किसे भेज रही हैं, और क्यों')}
      </h2>

      <form onSubmit={handleSubmit} className="mt-7 space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('Name', 'नाम')} required>
            <input
              value={form.patient_name}
              onChange={set('patient_name')}
              className="field w-full"
              autoComplete="off"
              required
            />
          </Field>

          <Field label={t('Phone', 'फ़ोन')}>
            <input
              value={form.patient_phone}
              onChange={set('patient_phone')}
              type="tel"
              inputMode="tel"
              className="field w-full"
              autoComplete="off"
            />
          </Field>

          <Field label={t('Age', 'उम्र')}>
            <input
              value={form.patient_age}
              onChange={set('patient_age')}
              type="number"
              inputMode="numeric"
              min="0"
              max="130"
              className="field w-full"
            />
          </Field>

          <Field label={t('Gender', 'लिंग')}>
            <select value={form.patient_gender} onChange={set('patient_gender')} className="field w-full">
              <option value="">{t('Not recorded', 'दर्ज नहीं')}</option>
              <option value="Female">{t('Female', 'महिला')}</option>
              <option value="Male">{t('Male', 'पुरुष')}</option>
              <option value="Other">{t('Other', 'अन्य')}</option>
            </select>
          </Field>

          <Field label={t('Village', 'गाँव')}>
            <input value={form.village} onChange={set('village')} className="field w-full" />
          </Field>

          <Field label={t('How urgent', 'कितना ज़रूरी')}>
            <select value={form.urgency} onChange={set('urgency')} className="field w-full">
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {hi ? s.label_hi : s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={t('Why you are referring them', 'रेफर करने का कारण')} required>
          <input
            value={form.reason}
            onChange={set('reason')}
            className="field w-full"
            placeholder={t('Anaemia, haemoglobin 8.1', 'खून की कमी, हीमोग्लोबिन 8.1')}
            required
          />
        </Field>

        <Field label={t('What you observed', 'आपने क्या देखा')}>
          <textarea
            value={form.symptoms}
            onChange={set('symptoms')}
            rows={3}
            className="field w-full resize-y py-3"
            placeholder={t('Tiredness, breathless on climbing', 'थकान, चढ़ने पर साँस फूलना')}
          />
        </Field>

        <Field
          label={t('Facility', 'सुविधा')}
          hint={t(
            'Only facilities on record appear here. Nothing is added by guesswork.',
            'यहाँ केवल दर्ज सुविधाएँ दिखती हैं। अनुमान से कुछ नहीं जोड़ा जाता।',
          )}
        >
          {facilities.loading ? (
            <div className="field flex w-full items-center text-ink-faint">
              {t('Loading facilities…', 'सुविधाएँ लोड हो रही हैं…')}
            </div>
          ) : facilities.error ? (
            <div className="field flex w-full items-center text-siren">
              {t('Facility list unavailable — you can still save.', 'सूची उपलब्ध नहीं — फिर भी सेव कर सकती हैं।')}
            </div>
          ) : (
            <select value={form.facility_id} onChange={set('facility_id')} className="field w-full">
              <option value="">{t('Not decided yet', 'अभी तय नहीं')}</option>
              {(facilities.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.verification !== 'verified' ? t(' (not confirmed)', ' (पुष्ट नहीं)') : ''}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label={t('Notes', 'नोट')}>
          <textarea
            value={form.notes}
            onChange={set('notes')}
            rows={2}
            className="field w-full resize-y py-3"
          />
        </Field>

        {err ? (
          <p className="text-sm font-semibold text-siren" role="alert">
            {err}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-6">
          <Btn type="submit" variant="asha" size="lg" disabled={busy}>
            {busy ? t('Saving…', 'सेव हो रहा है…') : t('Save referral', 'रेफरल सेव करें')}
          </Btn>
          <Btn type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t('Cancel', 'रद्द करें')}
          </Btn>
          <Stamp kind="verified" label={t('Audit logged', 'ऑडिट दर्ज')} className="ml-auto" />
        </div>
      </form>
    </Card>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="eyebrow">
        {label}
        {required ? <span className="ml-1 text-siren">*</span> : null}
      </span>
      <div className="mt-2">{children}</div>
      {hint ? <span className="mt-2 block text-[0.8rem] leading-snug text-ink-faint">{hint}</span> : null}
    </label>
  );
}
