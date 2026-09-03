import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/* =============================================================
   ErrorBoundary — what a person sees when a screen throws.

   This exists because of a real failure. /messages rendered an
   object where React expected text, React threw, and because
   nothing above it caught the error the entire document was
   replaced with a blank white page. No message, no way back, no
   hint that the fault was ours. The person cannot tell that
   apart from a dead internet connection or a broken phone.

   A boundary cannot fix the bug. What it can do is keep the
   failure local, say plainly that the fault is in the app rather
   than in anything the person did, and keep the emergency number
   on screen — this is a health service, and somebody may be
   holding the phone because a child has a fever.

   The error text itself is printed. Not for the person's benefit
   but for the one they will read it out to: a message beats "it
   went white" by a wide margin. React also logs the component
   stack to the console, which is where a developer should look.

   Class component by necessity: componentDidCatch has no hook
   equivalent.
   ============================================================= */

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept to the console deliberately. Shipping this to a logging
    // service would mean shipping whatever the screen was holding
    // at the time, which on these pages includes health details.
    console.error('[Sehat Sathi] a screen failed to render', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const hindi = this.props.hindi === true;
    const message = error?.message ? String(error.message) : null;

    return (
      <main className="bg-paper" role="alert">
        <div className="shell max-w-2xl py-16">
          <div className="rounded-lg border border-rule bg-paper-2 p-6 sm:p-8">
            <span
              className="grid h-11 w-11 place-items-center rounded-full bg-siren-soft text-siren"
              aria-hidden="true"
            >
              <AlertTriangle size={21} strokeWidth={2.1} />
            </span>

            <h1 className="display-md mt-5 text-2xl">
              {hindi ? 'यह पृष्ठ खुल नहीं सका' : 'This page could not open'}
            </h1>

            <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
              {hindi
                ? 'गलती ऐप में है, आपकी तरफ़ से कुछ भी गलत नहीं हुआ। आपकी जानकारी सुरक्षित है — कुछ भी मिटा नहीं है।'
                : 'The fault is in the app, not in anything you did. Your information is safe — nothing has been lost.'}
            </p>

            {message ? (
              <p className="mt-5 font-mono text-[0.78rem] leading-relaxed break-words text-ink-faint">
                {message}
              </p>
            ) : null}

            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={18} aria-hidden="true" />
                {hindi ? 'फिर से खोलें' : 'Reload the page'}
              </button>
              <a href="/app" className="btn btn-outline btn-lg">
                {hindi ? 'होम पर जाएँ' : 'Go to home'}
              </a>
            </div>

            <div className="reg-rule mt-8" />

            <p className="mt-6 text-[0.9rem] leading-relaxed font-semibold text-ink">
              {hindi
                ? 'आपात स्थिति में 108 पर कॉल करें। यह इस ऐप के बिना भी काम करता है।'
                : 'In an emergency, call 108. It works without this app.'}
            </p>
            <a href="tel:108" className="btn btn-siren mt-4">
              {hindi ? '108 पर कॉल करें' : 'Call 108'}
            </a>
          </div>
        </div>
      </main>
    );
  }
}

export default ErrorBoundary;
