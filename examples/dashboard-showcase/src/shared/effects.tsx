import { useEffect, useState } from 'react';

/** A small click ripple rendered by React, never by direct DOM mutation. */
export function ClickRipple() {
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; size: number }>>([]);

  useEffect(() => {
    let nextId = 0;
    const timers = new Set<number>();

    const handler = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (document.documentElement.dataset.motion === 'off') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const target = (event.target as Element | null)?.closest('button, a, [role="button"], input[type="submit"]');
      if (!target || target.hasAttribute('data-no-ripple')) return;

      const rect = target.getBoundingClientRect();
      const size = Math.min(96, Math.max(rect.width, rect.height) * 0.7);
      const id = ++nextId;
      setRipples((current) => [
        ...current.slice(-5),
        { id, x: event.clientX - size / 2, y: event.clientY - size / 2, size }
      ]);

      const timer = window.setTimeout(() => {
        setRipples((current) => current.filter((ripple) => ripple.id !== id));
        timers.delete(timer);
      }, 460);
      timers.add(timer);
    };

    document.addEventListener('pointerdown', handler, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', handler);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          aria-hidden="true"
          className="synapse-click-ripple"
          style={{
            width: ripple.size,
            height: ripple.size,
            left: ripple.x,
            top: ripple.y
          }}
        />
      ))}
    </>
  );
}

/** Thin top bar that acknowledges SPA navigation without blocking it. */
export function NavigationProgress() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (
        !href ||
        href.startsWith('#') ||
        href.startsWith('http') ||
        anchor.target ||
        anchor.hasAttribute('download')
      ) {
        return;
      }
      setActive(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setActive(false), 900);
    };

    const finish = () => {
      setActive(false);
      if (timer) clearTimeout(timer);
    };

    document.addEventListener('click', start);
    window.addEventListener('popstate', finish);
    window.addEventListener('pageshow', finish);
    return () => {
      document.removeEventListener('click', start);
      window.removeEventListener('popstate', finish);
      window.removeEventListener('pageshow', finish);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return <div aria-hidden="true" className={`synapse-navigation-progress ${active ? 'is-active' : ''}`} />;
}
