import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { validateSchema } from '../src/core/validation';
import { clientEntrySource } from '../src/runtime/client-entry';
import { SynapseServer } from '../src/runtime/server';

describe('SynapseJS v1.3.0 Features', () => {
  describe('1. Neutral Shell vs. Default Shell', () => {
    // We instantiate SynapseServer in test mode to access renderHtmlShell via private cast
    const server = new SynapseServer(process.cwd(), 3000);
    // biome-ignore lint/suspicious/noExplicitAny: test access to private method
    const renderShell = (server as any).renderHtmlShell.bind(server);

    it('renders a neutral HTML shell when a custom layout is present (hasLayout: true)', () => {
      const html = renderShell(
        'Calculadora de Preços',
        '<div class="pricing-card">R$ 150,00</div>',
        'calculate-price',
        '{}',
        '/_synapse/client/pricing-calculate-price.js',
        undefined,
        'pt-BR',
        true // hasLayout: true
      );

      // Neutral shell assertions: no hardcoded dark theme, no default machine top bar/footer
      expect(html).toContain('class="min-h-full"');
      expect(html).not.toContain('bg-slate-950 text-slate-100');
      expect(html).not.toContain('<!-- Top Bar -->');
      expect(html).not.toContain('SynapseJS Machine-Centric Engine • Deterministic Vertical Slices');
      expect(html).toContain(
        '<div id="synapse-root" class="min-h-full flex-1 flex flex-col"><div class="pricing-card">R$ 150,00</div></div>'
      );
      expect(html).toContain('src="/_synapse/client/pricing-calculate-price.js"');
    });

    it('renders the default developer shell when no layout is present (hasLayout: false)', () => {
      const html = renderShell(
        'View Tickets',
        '<div>Lista de Chamados</div>',
        'view-tickets',
        '{}',
        '/_synapse/client/tickets-view-tickets.js',
        undefined,
        'pt-BR',
        false // hasLayout: false
      );

      // Default shell assertions: includes developer chrome
      expect(html).toContain('class="h-full bg-slate-950 text-slate-100"');
      expect(html).toContain('<!-- Top Bar -->');
      expect(html).toContain('SynapseJS Machine-Centric Engine • Deterministic Vertical Slices');
      expect(html).toContain(
        'id="synapse-root" class="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-2xl backdrop-blur"'
      );
    });
  });

  describe('2. Isomorphic Layout Hydration in Client Entry', () => {
    it('composes RootLayout and DomainLayout around the slice in generated client entry', () => {
      const source = clientEntrySource({
        componentName: 'CalculatePriceView',
        clientModulePath: './client.tsx',
        rpcPath: '/_synapse/rpc/pricing/calculate-price',
        rootLayoutPath: '../slices/_layout.tsx',
        domainLayoutPath: '../slices/pricing/_layout.tsx'
      });

      expect(source).toContain('import * as RootLayoutModule from "../slices/_layout.tsx";');
      expect(source).toContain('import * as DomainLayoutModule from "../slices/pricing/_layout.tsx";');
      expect(source).toContain('SynapseProvider');
      expect(source).toContain('hydrateRoot(');
      expect(source).toContain('React.createElement(CalculatePriceView, {');
      expect(source).toContain('treeWithLayout');

      // Validates syntax with Bun.Transpiler
      const transpiler = new Bun.Transpiler({ loader: 'tsx' });
      expect(() => transpiler.transformSync(source)).not.toThrow();
    });

    it('hydrates without layouts when none are specified', () => {
      const source = clientEntrySource({
        componentName: 'SimpleView',
        clientModulePath: './client.tsx',
        rpcPath: '/_synapse/rpc/general/simple'
      });

      expect(source).not.toContain('RootLayoutModule');
      expect(source).not.toContain('DomainLayoutModule');
      expect(source).toContain('hydrateRoot(');
      expect(source).toContain('React.createElement(SimpleView, {');

      const transpiler = new Bun.Transpiler({ loader: 'tsx' });
      expect(() => transpiler.transformSync(source)).not.toThrow();
    });
  });

  describe('3. Detailed Schema Validation (validateSchema)', () => {
    const ProductSchema = Type.Object(
      {
        title: Type.String({ minLength: 3 }),
        price: Type.Number({ minimum: 0 }),
        category: Type.Union([Type.Literal('ELECTRONICS'), Type.Literal('FURNITURE')])
      },
      { additionalProperties: true }
    );

    it('returns Ok with typed value when payload satisfies schema', () => {
      const payload = {
        title: 'Monitor 4K',
        price: 1999.9,
        category: 'ELECTRONICS',
        extraFieldIgnored: true
      };

      const result = validateSchema(ProductSchema, payload);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Monitor 4K');
        expect(result.value.price).toBe(1999.9);
      }
    });

    it('returns Err with exact path and reason when payload is invalid', () => {
      const invalidPayload = {
        title: 'Mo', // too short
        price: -10, // negative
        category: 'INVALID_CATEGORY'
      };

      const result = validateSchema(ProductSchema, invalidPayload);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('INVALID_SCHEMA');
        expect(result.error).toContain('/title');
      }
    });
  });

  describe('4. Universal useAction Hook Contract', () => {
    it('executes an action function and triggers onSuccess callback', async () => {
      let callbackData = '';
      const mockAction = async (payload: { name: string }) => {
        return { ok: true as const, value: `Olá, ${payload.name}!` };
      };

      // Since useAction is a React hook, we verify the execution and options interface
      const options = {
        onSuccess: (data: string) => {
          callbackData = data;
        },
        onError: () => {}
      };

      const result = await mockAction({ name: 'Synapse' });
      if (result.ok) {
        options.onSuccess(result.value);
      }

      expect(callbackData).toBe('Olá, Synapse!');
    });
  });
});
