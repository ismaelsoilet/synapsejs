import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  Badge,
  Button,
  Card,
  DataForm,
  DataTable,
  Pagination,
  SynapseProvider,
  useLoaderData,
  useSession
} from '../src/client';

describe('Client Primitives - Context & SSR Hydration', () => {
  function TestConsumer() {
    const data = useLoaderData<{ title: string; count: number }>();
    const session = useSession();
    return React.createElement(
      'div',
      null,
      React.createElement('h1', null, data.title),
      React.createElement('span', null, `Count: ${data.count}`),
      React.createElement('p', null, `User: ${session?.userId ?? 'anonymous'}`)
    );
  }

  test('SynapseProvider supplies loader data and session to consumers during SSR', () => {
    const element = React.createElement(
      SynapseProvider,
      {
        props: { title: 'CRM Dashboard', count: 42 },
        session: {
          isAuthenticated: true,
          userId: 'usr_123',
          roles: ['sales', 'admin']
        }
      },
      React.createElement(TestConsumer)
    );

    const html = renderToString(element);
    expect(html).toContain('CRM Dashboard');
    expect(html).toContain('Count: 42');
    expect(html).toContain('User: usr_123');
  });
});

describe('Client Primitives - Declarative UI Components', () => {
  test('Badge renders with variant styles', () => {
    const htmlSuccess = renderToString(React.createElement(Badge, { variant: 'success' }, 'Ativo'));
    expect(htmlSuccess).toContain('Ativo');
    expect(htmlSuccess).toContain('bg-emerald-950');

    const htmlDanger = renderToString(React.createElement(Badge, { variant: 'danger' }, 'Cancelado'));
    expect(htmlDanger).toContain('Cancelado');
    expect(htmlDanger).toContain('bg-rose-950');
  });

  test('Button renders with variants, sizes and loading state', () => {
    const htmlBtn = renderToString(React.createElement(Button, { variant: 'primary', size: 'md' }, 'Salvar'));
    expect(htmlBtn).toContain('Salvar');
    expect(htmlBtn).toContain('bg-emerald-600');

    const htmlLoading = renderToString(React.createElement(Button, { loading: true }, 'Carregando'));
    expect(htmlLoading).toContain('animate-spin');
    expect(htmlLoading).toContain('disabled=""');
  });

  test('Card renders title, subtitle, actions and content', () => {
    const htmlCard = renderToString(
      React.createElement(
        Card,
        {
          title: 'Visão Geral',
          subtitle: 'Métricas do mês',
          actions: React.createElement(Button, { size: 'sm' }, 'Exportar')
        },
        React.createElement('p', null, 'Conteúdo do Card')
      )
    );

    expect(htmlCard).toContain('Visão Geral');
    expect(htmlCard).toContain('Métricas do mês');
    expect(htmlCard).toContain('Exportar');
    expect(htmlCard).toContain('Conteúdo do Card');
  });

  test('Pagination renders page info and disabled states', () => {
    const htmlPage1 = renderToString(
      React.createElement(Pagination, {
        currentPage: 1,
        totalPages: 5,
        onPageChange: () => {}
      })
    );
    expect(htmlPage1).toContain('Página 1 de 5');
    expect(htmlPage1).toContain('disabled=""'); // Anterior disabled

    // Single page pagination returns null
    const htmlSingle = renderToString(
      React.createElement(Pagination, {
        currentPage: 1,
        totalPages: 1,
        onPageChange: () => {}
      })
    );
    expect(htmlSingle).toBe('');
  });

  test('DataTable renders accessible table with columns, rows and empty state', () => {
    interface Customer {
      id: string;
      name: string;
      email: string;
      status: string;
    }

    const customers: Customer[] = [
      { id: '1', name: 'Alice Smith', email: 'alice@example.com', status: 'ACTIVE' },
      { id: '2', name: 'Bob Jones', email: 'bob@example.com', status: 'INACTIVE' }
    ];

    const htmlTable = renderToString(
      React.createElement(DataTable<Customer>, {
        data: customers,
        columns: [
          { key: 'name', label: 'Nome', sortable: true },
          { key: 'email', label: 'E-mail' },
          {
            key: 'status',
            label: 'Situação',
            render: (val: string) =>
              React.createElement(Badge, { variant: val === 'ACTIVE' ? 'success' : 'neutral' }, val)
          }
        ],
        searchable: ['name', 'email']
      })
    );

    expect(htmlTable).toContain('Nome');
    expect(htmlTable).toContain('E-mail');
    expect(htmlTable).toContain('Alice Smith');
    expect(htmlTable).toContain('bob@example.com');
    expect(htmlTable).toContain('Filtrar registros...');

    // Empty state
    const htmlEmpty = renderToString(
      React.createElement(DataTable<Customer>, {
        data: [],
        columns: [{ key: 'name', label: 'Nome' }],
        emptyMessage: 'Nenhum cliente cadastrado ainda.'
      })
    );
    expect(htmlEmpty).toContain('Nenhum cliente cadastrado ainda.');
  });

  test('DataForm renders form with fields, submit button and error messages', () => {
    const htmlForm = renderToString(
      React.createElement(DataForm, {
        fields: [
          { name: 'name', label: 'Nome Completo', required: true, placeholder: 'Digite o nome...' },
          { name: 'email', label: 'E-mail', type: 'email', required: true },
          {
            name: 'segment',
            label: 'Segmento',
            type: 'select',
            options: [
              { label: 'Varejo', value: 'RETAIL' },
              { label: 'Corporativo', value: 'CORPORATE' }
            ]
          },
          { name: 'newsletter', label: 'Receber novidades', type: 'checkbox' }
        ],
        onSubmit: async () => {},
        submitLabel: 'Cadastrar Cliente',
        error: 'E-mail já cadastrado.',
        successMessage: null
      })
    );

    expect(htmlForm).toContain('Nome Completo');
    expect(htmlForm).toContain('E-mail já cadastrado.');
    expect(htmlForm).toContain('Cadastrar Cliente');
    expect(htmlForm).toContain('Varejo');
    expect(htmlForm).toContain('Corporativo');
    expect(htmlForm).toContain('Receber novidades');
  });
});
