import { useEffect, useState } from 'react';

/** A small click ripple that never becomes part of the React tree. */
export function ClickRipple() {
  useEffect(() => {
    const handler = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (document.documentElement.dataset.motion === 'off') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const target = (event.target as Element | null)?.closest('button, a, [role="button"], input[type="submit"]');
      if (!target || target.hasAttribute('data-no-ripple')) return;

      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 0.9;
      const ripple = document.createElement('span');
      ripple.className = 'synapse-click-ripple';
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - size / 2}px`;
      ripple.style.top = `${event.clientY - size / 2}px`;
      document.body.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 620);
    };

    document.addEventListener('pointerdown', handler, { passive: true });
    return () => document.removeEventListener('pointerdown', handler);
  }, []);

  return null;
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
