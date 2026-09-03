import { useCallback, useState } from 'react';
import { useAppState } from '@/state/store';

/* =============================================================
   Asking the browser where the phone is, once, and storing the
   answer where every screen can read it.

   Five screens used to each roll their own navigator.geolocation
   call and keep the result in local state, which meant a person
   who had already granted permission on /care was asked again on
   /assistant, and the home page could not show a distance the
   care page had already worked out. The coordinates belong to the
   session, not to a screen, so they live in the store.

   Two rules this hook exists to keep:

     · A refused or failed lookup NEVER falls back to a guessed
       location. `coords` stays null and the caller is expected to
       say on screen that distances cannot be worked out. A wrong
       distance to a hospital is worse than no distance.
     · The error is reported in words a person can act on —
       "permission was refused" and "the phone could not get a
       fix" need different responses from them.

   Returns { coords, request, loading, error, denied, supported }.
   `request` must be called from a user gesture; browsers reject a
   permission prompt that nobody asked for.
   ============================================================= */

const TIMEOUT_MS = 12000;

export function useGeolocation({ language = 'English' } = {}) {
  const { coords, setCoords } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [denied, setDenied] = useState(false);

  const hi = String(language).trim().toLowerCase() === 'हिन्दी'.toLowerCase() ||
    ['hi', 'hin', 'hindi'].includes(String(language).trim().toLowerCase());
  const t = (en, dev) => (hi ? dev : en);

  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.geolocation);

  const request = useCallback(() => {
    if (!supported) {
      setError(
        t(
          'This phone or browser cannot share a location.',
          'यह फ़ोन या ब्राउज़र लोकेशन साझा नहीं कर सकता।',
        ),
      );
      return;
    }

    setLoading(true);
    setError(null);
    setDenied(false);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords ?? {};
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setLoading(false);
          setError(
            t(
              'The phone returned a location we could not read.',
              'फ़ोन ने ऐसी लोकेशन दी जो पढ़ी नहीं जा सकी।',
            ),
          );
          return;
        }
        setCoords({
          latitude,
          longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
          at: new Date().toISOString(),
        });
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        /* code 1 PERMISSION_DENIED · 2 POSITION_UNAVAILABLE · 3 TIMEOUT */
        if (err?.code === 1) {
          setDenied(true);
          setError(
            t(
              'Location permission was refused, so distances cannot be worked out. You can still search by district.',
              'लोकेशन की अनुमति नहीं मिली, इसलिए दूरी नहीं निकाली जा सकती। आप ज़िले से खोज सकते हैं।',
            ),
          );
          return;
        }
        if (err?.code === 3) {
          setError(
            t(
              'The phone took too long to get a fix. Try again in the open.',
              'फ़ोन को लोकेशन मिलने में बहुत समय लगा। खुले में फिर कोशिश करें।',
            ),
          );
          return;
        }
        setError(
          t(
            'The phone could not get a location fix just now.',
            'फ़ोन को अभी लोकेशन नहीं मिल सकी।',
          ),
        );
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 60000 },
    );
  }, [supported, setCoords, hi]);

  return { coords, request, loading, error, denied, supported };
}
