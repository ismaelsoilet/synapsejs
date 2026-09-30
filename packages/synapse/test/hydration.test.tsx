import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

/**
 * Hydration, verified by mounting.
 *
 * The server string is produced by the same provider the runtime uses, then hydrated
 * into a real DOM with the same tree. A markup mismatch makes React report it, and
 * the interactive assertion fails if hydration produced a dead tree. Asserting a
 * substring of generated source text — what this replaces — detects neither.
 */
const window = new Window({ url: 'http://localhost/tickets/view-tickets' });

const previousGlobals = {
  window: (globalThis as unknown as Record<string, unknown>).window,
  document: (globalThis as unknown as Record<string, unknown>).document,
  navigator: (globalThis as unknown as Record<string, unknown>).navigator,
  HTMLElement: (globalThis as unknown as Record<string, unknown>).HTMLElement,
  Event: (globalThis as unknown as Record<string, unknown>).Event,
  actEnvironment: (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT
};

(globalThis as unknown as Record<string, unknown>).window = window;
(globalThis as unknown as Record<string, unknown>).document = window.document;
(globalThis as unknown as Record<string, unknown>).navigator = window.navigator;
(globalThis as unknown as Record<string, unknown>).HTMLElement = window.HTMLElement;
(globalThis as unknown as Record<string, unknown>).Event = window.Event;

const React = (await import('react')).default;
const { act, useState } = await import('react');
const { hydrateRoot } = await import('react-dom/client');
const { renderToString } = await import('react-dom/server');
const { SynapseProvider } = await import('../src/client/context');
const { createSession } = await import('../src/core/session-context');

const session = createSession({ userId: 'u1', roles: ['support'] });
const props = { marker: 'LOADER-TICKETS-42' };

function Interactive({ onAction }: { onAction?: () => void }) {
  const [count, setCount] = useState(0);

  return React.createElement(
    'div',
    null,
    React.createElement('p', { id: 'marker' }, String(props.marker)),
    React.createElement('span', { id: 'count' }, String(count)),
    React.createElement(
      'button',
      {
        id: 'increment',
        onClick: () => {
          setCount((value) => value + 1);
          onAction?.();
        }
      },
      'incrementar'
    )
  );
}

function RootLayout({ children }: { children: React.ReactNode }) {
  return React.createElement('main', { 'data-layout': 'root' }, children);
}

function DomainLayout({ children }: { children: React.ReactNode }) {
  return React.createElement('section', { 'data-layout': 'domain' }, children);
}

const errors: string[] = [];
let originalError: typeof console.error;

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
});

afterAll(() => {
  console.error = originalError;

  const globals = globalThis as unknown as Record<string, unknown>;

  globals.window = previousGlobals.window;
  globals.document = previousGlobals.document;
  globals.navigator = previousGlobals.navigator;
  globals.HTMLElement = previousGlobals.HTMLElement;
  globals.Event = previousGlobals.Event;
  globals.IS_REACT_ACT_ENVIRONMENT = previousGlobals.actEnvironment;
});

describe('layout hydration', () => {
  it('hydrates the server markup without a mismatch and stays interactive', async () => {
    const tree = React.createElement(
      SynapseProvider,
      { props, session },
      React.createElement(RootLayout, null, React.createElement(DomainLayout, null, React.createElement(Interactive)))
    );

    const serverHtml = renderToString(tree);
    expect(serverHtml).toContain('LOADER-TICKETS-42');
    expect(serverHtml).toContain('data-layout="root"');
    expect(serverHtml).toContain('data-layout="domain"');

    const container = window.document.createElement('div');
    container.innerHTML = serverHtml;
    window.document.body.appendChild(container as never);

    let acted = 0;

    await act(async () => {
      hydrateRoot(
        container as unknown as Element,
        React.createElement(
          SynapseProvider,
          { props, session },
          React.createElement(
            RootLayout,
            null,
            React.createElement(DomainLayout, null, React.createElement(Interactive, { onAction: () => (acted += 1) }))
          )
        )
      );
    });

    // No hydration warning: the client tree accepted the server markup as-is.
    expect(errors.join('\n')).not.toMatch(/hydrat/i);

    // The hydrated tree is alive: a click updates the DOM.
    await act(async () => {
      (container.querySelector('#increment') as unknown as { click: () => void }).click();
    });

    expect(container.querySelector('#count')?.textContent).toBe('1');
    expect(acted).toBe(1);
  });
});
