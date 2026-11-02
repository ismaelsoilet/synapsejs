import { afterAll, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToString } from 'react-dom/server';
import { SynapseProvider } from '../src/client/context';
import { useParams, useSearchParams } from '../src/client/hooks';

const happyWindow = new Window({ url: 'http://localhost/members/profile/client-42?q=client-test' });
const globals = globalThis as unknown as Record<string, unknown>;
const previousWindow = globals.window;

globals.window = happyWindow;
(happyWindow as unknown as { __SYNAPSE_ROUTE_PARAMS__?: Record<string, string> }).__SYNAPSE_ROUTE_PARAMS__ = {
  id: 'client-42',
  filter: 'active'
};

afterAll(() => {
  if (previousWindow === undefined) {
    delete globals.window;
  } else {
    globals.window = previousWindow;
  }
});

function ClientComponent() {
  const params = useParams<{ id: string; filter?: string }>();
  const [searchParams] = useSearchParams();

  return (
    <div>
      <span id="param-id">{params.id}</span>
      <span id="param-filter">{params.filter ?? 'none'}</span>
      <span id="search-query">{searchParams.get('q') ?? 'empty'}</span>
    </div>
  );
}

describe('dynamic route hooks on the client', () => {
  it('reads the injected route params and the browser search string', () => {
    const html = renderToString(
      <SynapseProvider props={{}}>
        <ClientComponent />
      </SynapseProvider>
    );

    expect(html).toContain('client-42');
    expect(html).toContain('active');
    expect(html).toContain('client-test');
  });
});
