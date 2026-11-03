import { describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { TURBO_ROUTER_SCRIPT } from '../src/runtime/server';

describe('Turbo morphing router', () => {
  it('preserves focus, value and checked state across a navigation', async () => {
    const window = new Window({ url: 'http://localhost/start' });
    const document = window.document;

    document.body.innerHTML = `
      <div id="synapse-root">
        <input data-synapse-preserve="email" value="typed@example.com" />
        <input type="checkbox" data-synapse-preserve="agree" />
        <a id="next" href="/next">Next</a>
      </div>
    `;

    const email = document.querySelector('[data-synapse-preserve="email"]') as unknown as HTMLInputElement;
    const agree = document.querySelector('[data-synapse-preserve="agree"]') as unknown as HTMLInputElement;

    agree.checked = true;
    email.focus();
    expect(document.activeElement).toBe(email as unknown as typeof document.activeElement);

    const nextHtml = `
      <!doctype html>
      <html>
        <head><title>Next</title></head>
        <body>
          <div id="synapse-root">
            <input data-synapse-preserve="email" />
            <input type="checkbox" data-synapse-preserve="agree" />
            <a id="next" href="/next">Next</a>
          </div>
        </body>
      </html>
    `;

    const fetchMock = async () => ({
      ok: true,
      text: async () => nextHtml
    });
    const historyMock = { pushState: () => {} };
    const locationMock = { origin: 'http://localhost', href: 'http://localhost/start' };
    let unmounted = 0;
    (window as unknown as { __SYNAPSE_UNMOUNT__?: () => void }).__SYNAPSE_UNMOUNT__ = () => {
      unmounted += 1;
    };

    const run = new Function(
      'window',
      'document',
      'DOMParser',
      'CustomEvent',
      'history',
      'location',
      'fetch',
      'console',
      TURBO_ROUTER_SCRIPT
    );

    run(window, document, window.DOMParser, window.CustomEvent, historyMock, locationMock, fetchMock, console);

    const link = document.querySelector('#next') as unknown as HTMLAnchorElement;
    link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const nextEmail = document.querySelector('[data-synapse-preserve="email"]') as unknown as HTMLInputElement;
    const nextAgree = document.querySelector('[data-synapse-preserve="agree"]') as unknown as HTMLInputElement;

    expect(nextEmail.value).toBe('typed@example.com');
    expect(nextAgree.checked).toBe(true);
    expect(document.activeElement).toBe(nextEmail as unknown as typeof document.activeElement);
    expect(unmounted).toBe(1);
    expect((window as unknown as { __SYNAPSE_UNMOUNT__?: unknown }).__SYNAPSE_UNMOUNT__).toBeNull();
  });
});
