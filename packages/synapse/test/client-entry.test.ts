import { describe, expect, it } from 'bun:test';
import {
  CLIENT_PROPS_GLOBAL,
  CLIENT_ROOT_ID,
  clientEntrySource,
  serializeClientProps
} from '../src/runtime/client-entry';

const options = {
  componentName: 'TicketTrigger',
  clientModulePath: './client.tsx',
  rpcPath: '/_synapse/rpc/tickets/create-ticket'
};

describe('client entry', () => {
  it('hydrates the component and wires onSubmitAction to the slice endpoint', () => {
    const source = clientEntrySource(options);

    expect(source).toContain('hydrateRoot(');
    expect(source).toContain('React.createElement(TicketTrigger, {');
    expect(source).toContain(
      'onSubmitAction: (payload: unknown) => rpcCall("/_synapse/rpc/tickets/create-ticket", payload)'
    );
  });

  it('imports the splitter artifact, never the slice file', () => {
    const source = clientEntrySource(options);

    expect(source).toContain(`from "./client.tsx"`);
    expect(source).not.toContain('.slice.tsx');
  });

  it('imports the browser transport from the client entry of the package', () => {
    const source = clientEntrySource(options);

    expect(source).toContain(`from 'synapsejs/client'`);
    expect(source).not.toContain(`from 'synapsejs'`);
  });

  it('reads the props the server serialized and looks for the id the shell renders', () => {
    const source = clientEntrySource(options);

    expect(source).toContain(CLIENT_PROPS_GLOBAL);
    expect(source).toContain(`document.getElementById("${CLIENT_ROOT_ID}")`);
    expect(source).toContain('...props,');

    const custom = clientEntrySource({ ...options, rootId: 'outra-raiz' });
    expect(custom).toContain('document.getElementById("outra-raiz")');
  });

  it('produces a module the TSX parser accepts, which is what the bundler will feed it to', () => {
    const source = clientEntrySource(options);
    const transpiler = new Bun.Transpiler({ loader: 'tsx' });

    expect(() => transpiler.transformSync(source)).not.toThrow();
    expect(transpiler.transformSync(source)).toContain('hydrateRoot');
  });

  it('spreads the server props first, so a prop cannot overwrite the wiring', () => {
    const source = clientEntrySource(options);

    expect(source.indexOf('...props')).toBeLessThan(source.indexOf('onSubmitAction'));
  });
});

describe('serializeClientProps', () => {
  it('escapes < so a value cannot close the script tag early', () => {
    const serialized = serializeClientProps({ name: '</script><script>alert(1)</script>' });

    expect(serialized).not.toContain('</script>');
    expect(serialized).toContain('\\u003c');
  });

  it('still parses back to the exact props it received', () => {
    const props = { rows: [{ id: 'a', name: 'A</script>B' }], total: 2, ativo: true };

    expect(JSON.parse(serializeClientProps(props))).toEqual(props);
  });
});
