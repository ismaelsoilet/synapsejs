/**
 * SynapseJS - Scaffolder Fields Parser & Code Generator
 *
 * Parses `--fields="name:string,email:string,status:enum(ACTIVE|INACTIVE),price:number"`
 * and compiles into TypeBox definitions, SQL DDL column statements,
 * DataForm/DataTable specs, and Fast-Check PBT test arbitraries.
 */

import { Err, Ok, type Result } from '../core/machine-types';

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'date' | 'timestamp' | 'json';

export interface ParsedField {
  name: string;
  type: FieldType;
  required: boolean;
  enumValues?: string[];
  format?: string;
  label: string;
}

/**
 * Field and enum-value names are interpolated into generated DDL and generated
 * TypeScript, so they must be plain identifiers before any code generation runs.
 */
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validates every field name (and enum value) in a parsed field list.
 * Returns the first offending name as the error value.
 */
export function validateFieldNames(fields: ParsedField[]): Result<ParsedField[], string> {
  for (const field of fields) {
    if (!FIELD_NAME_PATTERN.test(field.name)) {
      return Err(field.name);
    }

    for (const value of field.enumValues ?? []) {
      if (!FIELD_NAME_PATTERN.test(value)) {
        return Err(value);
      }
    }
  }

  return Ok(fields);
}

function fieldToLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase());
}

/**
 * Parses a comma-separated field specification string.
 * Example: "name:string,email:string,status:enum(PENDING|ACTIVE|CANCELLED),price:number,notes:string?"
 */
export function parseFields(fieldsStr?: string): ParsedField[] {
  if (!fieldsStr?.trim()) {
    return [
      { name: 'name', type: 'string', required: true, label: 'Name' },
      { name: 'email', type: 'string', format: 'email', required: true, label: 'Email' }
    ];
  }

  const rawFields = fieldsStr
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  const fields: ParsedField[] = [];

  for (const raw of rawFields) {
    let [namePart, typePart = 'string'] = raw.split(':').map((s) => s.trim());
    let required = true;

    if (namePart.endsWith('?')) {
      namePart = namePart.slice(0, -1);
      required = false;
    } else if (typePart.endsWith('?')) {
      typePart = typePart.slice(0, -1);
      required = false;
    }

    let type: FieldType = 'string';
    let enumValues: string[] | undefined;
    let format: string | undefined;

    const lowerType = typePart.toLowerCase();

    if (lowerType.startsWith('enum(') && lowerType.endsWith(')')) {
      type = 'enum';
      const inner = typePart.slice(5, -1);
      enumValues = inner
        .split('|')
        .map((v) => v.trim())
        .filter(Boolean);
      if (enumValues.length === 0) {
        enumValues = ['DEFAULT'];
      }
    } else if (lowerType === 'number' || lowerType === 'float' || lowerType === 'double') {
      type = 'number';
    } else if (lowerType === 'int' || lowerType === 'integer') {
      type = 'integer';
    } else if (lowerType === 'bool' || lowerType === 'boolean') {
      type = 'boolean';
    } else if (lowerType === 'date') {
      type = 'date';
      format = 'date';
    } else if (lowerType === 'timestamp' || lowerType === 'datetime') {
      type = 'timestamp';
    } else if (lowerType === 'json' || lowerType === 'object') {
      type = 'json';
    } else {
      type = 'string';
      if (namePart.toLowerCase().includes('email')) {
        format = 'email';
      }
    }

    fields.push({
      name: namePart,
      type,
      required,
      enumValues,
      format,
      label: fieldToLabel(namePart)
    });
  }

  return fields;
}

/**
 * Emits TypeBox schema definitions for the parsed fields.
 */
export function generateTypeBoxProperties(fields: ParsedField[]): string {
  const lines = fields.map((f) => {
    let tbType = '';
    switch (f.type) {
      case 'string':
        if (f.format === 'email') {
          tbType = `Type.String({ format: 'email' })`;
        } else {
          tbType = `Type.String({ minLength: 1, maxLength: 255 })`;
        }
        break;
      case 'number':
        tbType = `Type.Number()`;
        break;
      case 'integer':
        tbType = `Type.Integer()`;
        break;
      case 'boolean':
        tbType = `Type.Boolean()`;
        break;
      case 'enum': {
        const literals = (f.enumValues || ['DEFAULT']).map((v) => `Type.Literal('${v}')`).join(', ');
        tbType = `Type.Union([${literals}])`;
        break;
      }
      case 'date':
      case 'timestamp':
        tbType = `Type.String()`;
        break;
      case 'json':
        tbType = `Type.Record(Type.String(), Type.Any())`;
        break;
    }

    if (!f.required) {
      tbType = `Type.Optional(${tbType})`;
    }

    return `  ${f.name}: ${tbType}`;
  });

  return lines.join(',\n');
}

/**
 * Emits SQL DDL column declarations for the parsed fields.
 */
export function generateSqlColumns(fields: ParsedField[]): string {
  const lines = fields.map((f) => {
    let sqlType = 'TEXT';
    switch (f.type) {
      case 'number':
        sqlType = 'REAL';
        break;
      case 'integer':
        sqlType = 'INTEGER';
        break;
      case 'boolean':
        sqlType = 'BOOLEAN DEFAULT FALSE';
        break;
      case 'date':
      case 'timestamp':
        sqlType = 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP';
        break;
      case 'json':
      case 'string':
      case 'enum':
        sqlType = 'TEXT';
        break;
    }

    const nullability = f.required && f.type !== 'boolean' && f.type !== 'timestamp' ? ' NOT NULL' : '';
    return `    ${f.name} ${sqlType}${nullability}`;
  });

  return lines.join(',\n');
}

/**
 * Emits Fast-Check PBT test arbitraries for the parsed fields.
 */
export function generateFastCheckArbitraries(fields: ParsedField[]): string {
  const arbs = fields.map((f) => {
    let arb = '';
    switch (f.type) {
      case 'string':
        if (f.format === 'email') {
          arb = `fc.stringMatching(/^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$/)`;
        } else {
          arb = `fc.string({ minLength: 2, maxLength: 50 })`;
        }
        break;
      case 'number':
        arb = `fc.double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 10000 })`;
        break;
      case 'integer':
        arb = `fc.integer({ min: 1, max: 100000 })`;
        break;
      case 'boolean':
        arb = `fc.boolean()`;
        break;
      case 'enum': {
        const vals = (f.enumValues || ['DEFAULT']).map((v) => `'${v}'`).join(', ');
        arb = `fc.constantFrom(${vals})`;
        break;
      }
      case 'date':
      case 'timestamp':
        arb = `fc.date().map((d) => d.toISOString())`;
        break;
      case 'json':
        arb = `fc.constant({})`;
        break;
    }

    return arb;
  });

  return arbs.join(',\n            ');
}

/**
 * Emits FormField array code for the React <DataForm> component.
 */
export function generateFormFieldsCode(fields: ParsedField[]): string {
  const items = fields.map((f) => {
    let formType = 'text';
    let extra = '';

    if (f.type === 'number' || f.type === 'integer') {
      formType = 'number';
    } else if (f.type === 'boolean') {
      formType = 'checkbox';
    } else if (f.type === 'date') {
      formType = 'date';
    } else if (f.type === 'enum') {
      formType = 'select';
      const opts = (f.enumValues || ['DEFAULT']).map((v) => `{ label: '${v}', value: '${v}' }`).join(', ');
      extra = `, options: [${opts}]`;
    }

    return `  { name: '${f.name}', label: '${f.label}', type: '${formType}', required: ${f.required}${extra} }`;
  });

  return `[\n${items.join(',\n')}\n]`;
}

/**
 * Emits DataTableColumn array code for the React <DataTable> component.
 */
export function generateTableColumnsCode(fields: ParsedField[]): string {
  const items = [
    `  { key: 'id', header: 'ID', sortable: true }`,
    ...fields.map((f) => `  { key: '${f.name}', header: '${f.label}', sortable: true }`)
  ];

  return `[\n${items.join(',\n')}\n]`;
}
