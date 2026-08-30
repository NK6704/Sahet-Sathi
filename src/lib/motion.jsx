import React, { useEffect, useRef, useState } from 'react';

/* =============================================================
   Motion primitives.

   Hand-rolled rather than pulling in an animation library: one
   shared rAF scroll loop drives every parallax layer on the page,
   which keeps both the bundle and the main thread cheap. That
   matters — a lot of this app's users are on low-end Android.

   Rules enforced here, not left to the caller:
   - prefers-reduced-motion disables parallax entirely
   - parallax is desktop-only; on phones it costs more than it gives
   ============================================================= */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReduced() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReduced);

  useEffect(() => {
    const mq = window.matchMedia(REDUCED_QUERY);
    const onChange = (e) => setReduced(e.matches);
    setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/* -------------------------------------------------------------
   Shared parallax engine
   ------------------------------------------------------------- */

const layers = new Set();
let frame = 0;

function paint() {
  frame = 0;
  const vh = window.innerHeight || 1;

  layers.forEach((layer) => {
    const el = layer.el;
    if (!el) return;

    const rect = el.getBoundingClientRect();

    // Skip anything comfortably offscreen.
    if (rect.bottom < -vh || rect.top > vh * 2) return;

    // -1 when the element sits below the fold, +1 when above it.
    const centre = rect.top + rect.height / 2;
    const progress = (centre - vh / 2) / (vh / 2 + rect.height / 2);

    let y = progress * layer.speed * -100;
    if (layer.clamp) {
      y = Math.max(-layer.clamp, Math.min(layer.clamp, y));
    }

    el.style.setProperty('--py', `${y.toFixed(2)}px`);
  });
}

function schedule() {
  if (frame) return;
  frame = window.requestAnimationFrame(paint);
}

function register(layer) {
  const first = layers.size === 0;
  layers.add(layer);

  if (first) {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
  }

  schedule();

  return () => {
    layers.delete(layer);
    if (layer.el) layer.el.style.removeProperty('--py');

    if (layers.size === 0) {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    }
  };
}

/**
 * Translates its children vertically against the scroll.
 *
 * speed  positive drifts the layer up as you scroll down; use small
 *        values (0.05–0.3). Negative pushes the other way.
 * clamp  maximum travel in px, so a layer can never drift out of
 *        its own container.
 */
export function Parallax({
  as: Tag = 'div',
  speed = 0.15,
  clamp = 140,
  className = '',
  children,
  ...rest
}) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const active = !reduced && isDesktop;

  useEffect(() => {
    if (!active || !ref.current) return;
    return register({ el: ref.current, speed, clamp });
  }, [active, speed, clamp]);

  return (
    <Tag ref={ref} className={`${active ? 'parallax' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------
   Scroll-triggered reveal
   ------------------------------------------------------------- */

/**
 * Fades and lifts its children in the first time they enter view.
 * Reveals once and then stops observing — content never re-hides,
 * which would be disorienting when scrolling back up.
 */
export function Reveal({
  as: Tag = 'div',
  delay = 0,
  className = '',
  children,
  ...rest
}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reduced motion, or no observer support: show it immediately.
    if (prefersReduced() || typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-in');
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${className}`}
      style={{ '--reveal-delay': `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------
   Sticky card stack

   Cards pin one after another and layer up as you scroll. Pure
   CSS sticky, so it costs nothing at runtime. On phones the cards
   fall back to an ordinary vertical list.
   ------------------------------------------------------------- */

export function StickyStack({ className = '', children, ...rest }) {
  return (
    <div className={`relative ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function StickyCard({ index = 0, className = '', children, ...rest }) {
  return (
    <div
      className={`lg:sticky ${className}`}
      style={{
        top: `calc(6rem + ${index * 1.5}rem)`,
        zIndex: index + 1,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------
   Window scroll offset, throttled to a frame. Used for the
   header's transparent-over-hero state.
   ------------------------------------------------------------- */

export function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let raf = 0;

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        setScrolled(window.scrollY > threshold);
      });
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [threshold]);

  return scrolled;
}
