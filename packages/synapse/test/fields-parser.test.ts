import { describe, expect, it } from 'bun:test';
import {
  generateFastCheckArbitraries,
  generateFormFieldsCode,
  generateSqlColumns,
  generateTableColumnsCode,
  generateTypeBoxProperties,
  parseFields
} from '../src/compiler/fields-parser';

describe('FieldsParser - Scaffolder Grammar & Code Generation', () => {
  it('parses default fields when string is empty or undefined', () => {
    const defaultFields = parseFields('');
    expect(defaultFields.length).toBe(2);
    expect(defaultFields[0].name).toBe('name');
    expect(defaultFields[0].type).toBe('string');
    expect(defaultFields[1].name).toBe('email');
    expect(defaultFields[1].format).toBe('email');
  });

  it('parses diverse types including enums and optional markers', () => {
    const spec =
      'title:string,amount:number,status:enum(DRAFT|ACTIVE|ARCHIVED),is_active:boolean,notes:string?,created_at:timestamp';
    const fields = parseFields(spec);

    expect(fields.length).toBe(6);
    expect(fields[0]).toEqual({
      name: 'title',
      type: 'string',
      required: true,
      enumValues: undefined,
      format: undefined,
      label: 'Title'
    });
    expect(fields[1]).toEqual({
      name: 'amount',
      type: 'number',
      required: true,
      enumValues: undefined,
      format: undefined,
      label: 'Amount'
    });
    expect(fields[2]).toEqual({
      name: 'status',
      type: 'enum',
      required: true,
      enumValues: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
      format: undefined,
      label: 'Status'
    });
    expect(fields[3]).toEqual({
      name: 'is_active',
      type: 'boolean',
      required: true,
      enumValues: undefined,
      format: undefined,
      label: 'Is active'
    });
    expect(fields[4].required).toBe(false);
    expect(fields[5].type).toBe('timestamp');
  });

  it('generates valid TypeBox properties', () => {
    const fields = parseFields('name:string,price:number,role:enum(ADMIN|USER),bio:string?');
    const tb = generateTypeBoxProperties(fields);

    expect(tb).toContain('name: Type.String({ minLength: 1, maxLength: 255 })');
    expect(tb).toContain('price: Type.Number()');
    expect(tb).toContain("role: Type.Union([Type.Literal('ADMIN'), Type.Literal('USER')])");
    expect(tb).toContain('bio: Type.Optional(Type.String({ minLength: 1, maxLength: 255 }))');
  });

  it('generates valid SQL DDL column statements', () => {
    const fields = parseFields('title:string,count:integer,active:boolean,created_at:timestamp');
    const sql = generateSqlColumns(fields);

    expect(sql).toContain('title TEXT NOT NULL');
    expect(sql).toContain('count INTEGER NOT NULL');
    expect(sql).toContain('active BOOLEAN DEFAULT FALSE');
    expect(sql).toContain('created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  });

  it('generates DataForm and DataTable column definitions', () => {
    const fields = parseFields('title:string,category:enum(TECH|BUSINESS)');
    const formCode = generateFormFieldsCode(fields);
    const tableCode = generateTableColumnsCode(fields);

    expect(formCode).toContain("{ name: 'title', label: 'Title', type: 'text', required: true }");
    expect(formCode).toContain("type: 'select'");
    expect(formCode).toContain("options: [{ label: 'TECH', value: 'TECH' }, { label: 'BUSINESS', value: 'BUSINESS' }]");

    expect(tableCode).toContain("{ key: 'id', header: 'ID', sortable: true }");
    expect(tableCode).toContain("{ key: 'title', header: 'Title', sortable: true }");
    expect(tableCode).toContain("{ key: 'category', header: 'Category', sortable: true }");
  });

  it('generates Fast-Check PBT test arbitraries', () => {
    const fields = parseFields('name:string,age:integer,role:enum(DEV|QA)');
    const fcCode = generateFastCheckArbitraries(fields);

    expect(fcCode).toContain('fc.string({ minLength: 2, maxLength: 50 })');
    expect(fcCode).toContain('fc.integer({ min: 1, max: 100000 })');
    expect(fcCode).toContain("fc.constantFrom('DEV', 'QA')");
  });
});
