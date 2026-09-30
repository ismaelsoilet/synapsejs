import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

/**
 * The consumer-facing hooks, exercised in a real DOM.
 *
 * The suite mounts the shipped implementations and observes the resulting DOM: a
 * hook that stops working, or one that is replaced by a stand-in defined inside the
 * test, fails here.
 */
const window = new Window({ url: 'http://localhost/' });

/** Every global this file installs is restored, so one suite cannot shape another's. */
const previousGlobals = {
  window: (globalThis as unknown as Record<string, unknown>).window,
  document: (globalThis as unknown as Record<string, unknown>).document,
  navigator: (globalThis as unknown as Record<string, unknown>).navigator,
  HTMLElement: (globalThis as unknown as Record<string, unknown>).HTMLElement,
  Event: (globalThis as unknown as Record<string, unknown>).Event,
  CustomEvent: (globalThis as unknown as Record<string, unknown>).CustomEvent,
  EventSource: (globalThis as unknown as Record<string, unknown>).EventSource,
  WebSocket: (globalThis as unknown as Record<string, unknown>).WebSocket,
  actEnvironment: (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT
};

(globalThis as unknown as Record<string, unknown>).window = window;
(globalThis as unknown as Record<string, unknown>).document = window.document;
(globalThis as unknown as Record<string, unknown>).navigator = window.navigator;
(globalThis as unknown as Record<string, unknown>).HTMLElement = window.HTMLElement;
(globalThis as unknown as Record<string, unknown>).Event = window.Event;
(globalThis as unknown as Record<string, unknown>).CustomEvent = window.CustomEvent;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Ok, Err } = await import('../src/core/machine-types');
const { useAction, useSubscription } = await import('../src/client/hooks');
const { useWebSocket } = await import('../src/client/use-websocket');

/** Records what the hook asked the transport to do. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {}
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }
}

beforeAll(() => {
  // React only runs state updates inside act() when the environment says so.
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as Record<string, unknown>).EventSource = FakeEventSource;
  (globalThis as unknown as Record<string, unknown>).WebSocket = FakeWebSocket;
  // The hooks read the transport off `window`, which is the DOM instance here.
  (window as unknown as Record<string, unknown>).EventSource = FakeEventSource;
  (window as unknown as Record<string, unknown>).WebSocket = FakeWebSocket;
});

afterEach(() => {
  FakeEventSource.instances = [];
  FakeWebSocket.instances = [];
  window.document.body.innerHTML = '';
});

afterAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>;

  globals.window = previousGlobals.window;
  globals.document = previousGlobals.document;
  globals.navigator = previousGlobals.navigator;
  globals.HTMLElement = previousGlobals.HTMLElement;
  globals.Event = previousGlobals.Event;
  globals.CustomEvent = previousGlobals.CustomEvent;
  globals.EventSource = previousGlobals.EventSource;
  globals.WebSocket = previousGlobals.WebSocket;
  globals.IS_REACT_ACT_ENVIRONMENT = previousGlobals.actEnvironment;
});

function mount(element: unknown) {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container as never);
  const root = createRoot(container as unknown as Element);

  act(() => {
    root.render(element as never);
  });

  return { container, root };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useAction in a real DOM', () => {
  it('renders the value the action returned and then the error it reported', async () => {
    function Form() {
      const { execute, data, error, isSuccess } = useAction<{ name: string }, { id: string }, string>(
        async (payload) => (payload.name === 'ok' ? Ok({ id: 'created-1' }) : Err('INVALID_SCHEMA'))
      );

      return React.createElement(
        'div',
        null,
        React.createElement('span', { id: 'data' }, data ? data.id : 'nenhum'),
        React.createElement('span', { id: 'success' }, String(isSuccess)),
        React.createElement('span', { id: 'error' }, error ?? 'nada'),
        React.createElement('button', { id: 'run-ok', onClick: () => void execute({ name: 'ok' }) }, 'ok'),
        React.createElement('button', { id: 'run-fail', onClick: () => void execute({ name: 'nope' }) }, 'fail')
      );
    }

    const { container } = mount(React.createElement(Form));

    expect(container.querySelector('#data')?.textContent).toBe('nenhum');

    await act(async () => {
      (container.querySelector('#run-ok') as unknown as { click: () => void }).click();
    });
    await flush();

    expect(container.querySelector('#data')?.textContent).toBe('created-1');
    expect(container.querySelector('#success')?.textContent).toBe('true');

    await act(async () => {
      (container.querySelector('#run-fail') as unknown as { click: () => void }).click();
    });
    await flush();

    expect(container.querySelector('#error')?.textContent).toBe('INVALID_SCHEMA');
  });

  it('reports NO_ACTION_FUNCTION when no action is available', async () => {
    function Empty() {
      const { execute, error } = useAction<unknown, unknown, string>();

      return React.createElement(
        'div',
        null,
        React.createElement('span', { id: 'error' }, error ?? 'nada'),
        React.createElement('button', { id: 'run', onClick: () => void execute({}) }, 'run')
      );
    }

    const { container } = mount(React.createElement(Empty));

    await act(async () => {
      (container.querySelector('#run') as unknown as { click: () => void }).click();
    });
    await flush();

    expect(container.querySelector('#error')?.textContent).toBe('NO_ACTION_FUNCTION');
  });
});

describe('useSubscription in a real DOM', () => {
  it('opens the topic stream and writes a delivered event into the DOM', async () => {
    function Live() {
      const [message, setMessage] = React.useState('nenhum');

      const { isConnected } = useSubscription('tickets', (data: { id: string }) => setMessage(data.id));

      return React.createElement(
        'div',
        null,
        React.createElement('span', { id: 'connected' }, String(isConnected)),
        React.createElement('span', { id: 'message' }, message)
      );
    }

    const { container } = mount(React.createElement(Live));

    expect(FakeEventSource.instances.length).toBe(1);
    expect(FakeEventSource.instances[0].url).toBe('/_synapse/sse/tickets');

    await act(async () => {
      FakeEventSource.instances[0].onopen?.();
    });

    expect(container.querySelector('#connected')?.textContent).toBe('true');

    await act(async () => {
      FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify({ id: 't-100' }) });
    });

    expect(container.querySelector('#message')?.textContent).toBe('t-100');
  });
});

describe('useWebSocket in a real DOM', () => {
  it('connects to the slice socket and reflects a received frame', async () => {
    function Chat() {
      const { isConnected, lastMessage, send } = useWebSocket<{ type: string; text?: string }, { text: string }>(
        'chat/room',
        { reconnect: false }
      );

      return React.createElement(
        'div',
        null,
        React.createElement('span', { id: 'connected' }, String(isConnected)),
        React.createElement('span', { id: 'last' }, lastMessage ? String(lastMessage.text) : 'nenhum'),
        React.createElement('button', { id: 'send', onClick: () => send({ text: 'olá' }) }, 'enviar')
      );
    }

    const { container } = mount(React.createElement(Chat));

    expect(FakeWebSocket.instances.length).toBe(1);
    expect(FakeWebSocket.instances[0].url).toBe('ws://localhost/_synapse/ws/chat/room');

    await act(async () => {
      FakeWebSocket.instances[0].onopen?.();
    });

    expect(container.querySelector('#connected')?.textContent).toBe('true');

    await act(async () => {
      FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'ECHO', text: 'eco' }) });
    });

    expect(container.querySelector('#last')?.textContent).toBe('eco');

    await act(async () => {
      (container.querySelector('#send') as unknown as { click: () => void }).click();
    });

    expect(FakeWebSocket.instances[0].sent.length).toBe(1);
    expect(FakeWebSocket.instances[0].sent[0]).toContain('olá');
  });
});
