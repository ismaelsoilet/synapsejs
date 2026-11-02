import { afterAll, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  status = 200;
  responseText = '{"ok":true}';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(): void {}
  setRequestHeader(): void {}
  send(): void {
    FakeXhr.instances.push(this);
  }
  abort(): void {
    this.onabort?.();
  }
}

const happyWindow = new Window({ url: 'http://localhost/upload' });
const globals = globalThis as unknown as Record<string, unknown>;
const previous = {
  window: globals.window,
  document: globals.document,
  navigator: globals.navigator,
  HTMLElement: globals.HTMLElement,
  Event: globals.Event,
  MouseEvent: globals.MouseEvent,
  XMLHttpRequest: globals.XMLHttpRequest,
  FormData: globals.FormData,
  File: globals.File,
  IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT
};

globals.window = happyWindow;
globals.document = happyWindow.document;
globals.navigator = happyWindow.navigator;
globals.HTMLElement = happyWindow.HTMLElement;
globals.Event = happyWindow.Event;
globals.MouseEvent = happyWindow.MouseEvent;
globals.XMLHttpRequest = FakeXhr;
globals.FormData = happyWindow.FormData;
globals.File = happyWindow.File;
globals.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useUpload } = await import('../src/client/upload.ts');

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete globals[key];
    } else {
      globals[key] = value;
    }
  }
});

function Harness({ maxBytes, allowedTypes }: { maxBytes?: number; allowedTypes?: string[] }) {
  const [result, setResult] = useState('none');
  const upload = useUpload({
    maxBytes,
    allowedTypes,
    onProgress: (percent) => setResult(`progress:${percent}`)
  });

  return React.createElement(
    'div',
    null,
    React.createElement('span', { id: 'progress' }, String(upload.progress)),
    React.createElement('span', { id: 'uploading' }, String(upload.isUploading)),
    React.createElement('span', { id: 'result' }, result),
    React.createElement(
      'button',
      {
        id: 'send',
        onClick: async () => {
          const file = new (happyWindow.File as never as typeof File)(['hello'], 'hello.txt', {
            type: 'text/plain'
          });
          const outcome = await upload.upload(file);
          setResult(outcome.ok ? 'ok' : outcome.error);
        }
      },
      'send'
    ),
    React.createElement('button', { id: 'abort', onClick: upload.abort }, 'abort')
  );
}

async function mount(element: React.ReactElement) {
  const container = happyWindow.document.createElement('div');
  happyWindow.document.body.appendChild(container as never);
  let root: ReturnType<typeof createRoot> | undefined;

  await act(async () => {
    root = createRoot(container as unknown as Element);
    root.render(element);
  });

  return { container, root };
}

describe('useUpload client hook', () => {
  it('reports progress and resolves the upload', async () => {
    FakeXhr.instances = [];
    const { container } = await mount(React.createElement(Harness, { maxBytes: 100 }));

    await act(async () => {
      (container.querySelector('#send') as unknown as HTMLElement).click();
    });

    const xhr = FakeXhr.instances[0];
    expect(xhr).toBeDefined();
    expect(container.querySelector('#uploading')?.textContent).toBe('true');

    await act(async () => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    });

    expect(container.querySelector('#progress')?.textContent).toBe('50');

    await act(async () => {
      xhr.onload?.();
    });

    expect(container.querySelector('#progress')?.textContent).toBe('100');
    expect(container.querySelector('#uploading')?.textContent).toBe('false');
    expect(container.querySelector('#result')?.textContent).toBe('ok');
  });

  it('rejects a file over maxBytes before creating a request', async () => {
    FakeXhr.instances = [];
    const { container } = await mount(React.createElement(Harness, { maxBytes: 2 }));

    await act(async () => {
      (container.querySelector('#send') as unknown as HTMLElement).click();
    });

    expect(FakeXhr.instances.length).toBe(0);
    expect(container.querySelector('#result')?.textContent).toBe('FILE_TOO_LARGE');
  });

  it('rejects a disallowed MIME type before creating a request', async () => {
    FakeXhr.instances = [];
    const { container } = await mount(React.createElement(Harness, { allowedTypes: ['image/png'] }));

    await act(async () => {
      (container.querySelector('#send') as unknown as HTMLElement).click();
    });

    expect(FakeXhr.instances.length).toBe(0);
    expect(container.querySelector('#result')?.textContent).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('reports UPLOAD_ABORTED when the upload is cancelled', async () => {
    FakeXhr.instances = [];
    const { container } = await mount(React.createElement(Harness, { maxBytes: 100 }));

    await act(async () => {
      (container.querySelector('#send') as unknown as HTMLElement).click();
    });

    await act(async () => {
      (container.querySelector('#abort') as unknown as HTMLElement).click();
    });

    expect(container.querySelector('#result')?.textContent).toBe('UPLOAD_ABORTED');
    expect(container.querySelector('#uploading')?.textContent).toBe('false');
  });
});
