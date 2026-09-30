import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateSliceTemplate, scaffoldCrud, scaffoldShared, scaffoldSlice } from '../src/compiler/scaffolder';

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-scaffolder-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('generateSliceTemplate', () => {
  const template = generateSliceTemplate('orders', 'process-checkout');

  it('derives PascalCase and camelCase names', () => {
    expect(template).toContain('export const ProcessCheckoutInputSchema');
    expect(template).toContain('export async function processCheckoutAction');
    expect(template).toContain('export function ProcessCheckoutTrigger');
  });

  it('imports from the published package entry, never from an internal alias', () => {
    expect(template).toContain(`from 'synapsejs'`);
    expect(template).not.toContain(`from '@/`);
  });

  it('declares the slice contract pieces in one file', () => {
    expect(template).toContain('export const sliceSchema');
    expect(template).toContain('export const sliceTests');
    expect(template).toContain('Type.Object(');
  });

  it('accepts a session context so RBAC can be enforced', () => {
    expect(template).toContain('session?: SessionContext');
  });
});

describe('scaffoldSlice', () => {
  it('creates the slice inside an existing app', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(path.join(appDir, 'src', 'slices', 'welcome'), { recursive: true });
    fs.writeFileSync(path.join(appDir, 'src', 'slices', 'welcome', 'hello.slice.tsx'), '// fixture\n');

    const created = scaffoldSlice('orders', 'process-checkout', appDir);

    expect(created.ok).toBe(true);
    if (created.ok) {
      const expected = path.join(appDir, 'src', 'slices', 'orders', 'process-checkout.slice.tsx');
      expect(created.value).toBe(expected);
      expect(fs.existsSync(expected)).toBe(true);
      expect(fs.readFileSync(expected, 'utf-8')).toContain(`from 'synapsejs'`);
    }
  });

  it('creates src/slices when the app has none yet', () => {
    const appDir = path.join(sandbox, 'fresh');
    fs.mkdirSync(appDir, { recursive: true });

    const created = scaffoldSlice('billing', 'create-invoice', appDir);

    expect(created.ok).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'src', 'slices', 'billing', 'create-invoice.slice.tsx'))).toBe(true);
  });

  it('refuses to overwrite an existing slice', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    scaffoldSlice('billing', 'create-invoice', appDir);
    const again = scaffoldSlice('billing', 'create-invoice', appDir);

    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error.code).toBe('SLICE_EXISTS');
    }
  });

  it('refuses to guess the target inside an ambiguous workspace', () => {
    fs.writeFileSync(
      path.join(sandbox, 'package.json'),
      JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }),
      'utf-8'
    );
    for (const app of ['crm', 'shop']) {
      const dir = path.join(sandbox, 'apps', app, 'src', 'slices', 'core');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'seed.slice.tsx'), '// fixture\n');
    }

    const created = scaffoldSlice('orders', 'process-checkout', sandbox);

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error.code).toBe('AMBIGUOUS_SLICES_DIR');
    }
  });

  it('scaffolds slice with custom fields grammar', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(path.join(appDir, 'src', 'slices', 'store'), { recursive: true });

    const created = scaffoldSlice(
      'store',
      'create-product',
      appDir,
      'create',
      'title:string,price:number,in_stock:boolean,category:enum(ELECTRONICS|BOOKS)'
    );

    expect(created.ok).toBe(true);
    if (created.ok) {
      const content = fs.readFileSync(created.value, 'utf-8');
      expect(content).toContain('title: Type.String(');
      expect(content).toContain('price: Type.Number()');
      expect(content).toContain('in_stock: Type.Boolean()');
      expect(content).toContain("category: Type.Union([Type.Literal('ELECTRONICS'), Type.Literal('BOOKS')])");
      expect(content).toContain('price REAL NOT NULL');
      expect(content).toContain('in_stock BOOLEAN DEFAULT FALSE');
      expect(content).toContain('DataForm');
    }
  });

  it('scaffolds oauth-github slice and passes invariant checks', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(path.join(appDir, 'src', 'slices', 'auth'), { recursive: true });

    const created = scaffoldSlice('auth', 'github-callback', appDir, 'oauth-github');
    expect(created.ok).toBe(true);

    if (created.ok) {
      const content = fs.readFileSync(created.value, 'utf-8');
      expect(content).toContain('GithubCallbackInputSchema');
      expect(content).toContain('githubCallbackAction');
      expect(content).toContain('GithubCallbackTrigger');
      expect(content).toContain('oauth_accounts');
      expect(content).toContain('https://github.com/login/oauth/access_token');
      expect(content).toContain('sliceTests');
    }
  });
});

describe('scaffoldSlice containment', () => {
  it('refuses traversal in the domain argument without writing anything', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(path.join(appDir, 'src', 'slices', 'billing'), { recursive: true });

    const created = scaffoldSlice('../../../../tmp', 'pwn', appDir);

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error.code).toBe('INVALID_PATH_SEGMENT');
    }
    expect(fs.existsSync(path.join('/tmp', 'pwn.slice.tsx'))).toBe(false);
    expect(fs.existsSync(path.join('/tmp', 'pwn'))).toBe(false);
  });

  it('refuses traversal in the slice-name argument', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(path.join(appDir, 'src', 'slices', 'billing'), { recursive: true });

    const created = scaffoldSlice('billing', '../../../outside/pwn', appDir);

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error.code).toBe('INVALID_PATH_SEGMENT');
    }
    expect(fs.existsSync(path.join(sandbox, 'outside'))).toBe(false);
  });

  it('refuses every operation of a traversing crud resource', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(path.join(appDir, 'src', 'slices', 'billing'), { recursive: true });

    const created = scaffoldCrud('billing', '../../escape', appDir);

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error.code).toBe('INVALID_PATH_SEGMENT');
    }
    expect(fs.existsSync(path.join(sandbox, 'escape'))).toBe(false);
  });

  it('refuses a field name carrying a statement terminator, before writing the slice', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(path.join(appDir, 'src', 'slices', 'store'), { recursive: true });

    const created = scaffoldSlice(
      'store',
      'create-product',
      appDir,
      'create',
      'title); DROP TABLE customers; --:string'
    );

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error.code).toBe('INVALID_FIELD_NAME');
    }
    expect(fs.existsSync(path.join(appDir, 'src', 'slices', 'store', 'create-product.slice.tsx'))).toBe(false);
  });

  it('still scaffolds a valid field grammar after the guard', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(path.join(appDir, 'src', 'slices', 'store'), { recursive: true });

    const created = scaffoldSlice('store', 'create-product', appDir, 'create', 'title:string,amount:number');

    expect(created.ok).toBe(true);
    if (created.ok) {
      const content = fs.readFileSync(created.value, 'utf-8');
      expect(content).toContain('title: Type.String(');
      expect(content).toContain('amount REAL NOT NULL');
    }
  });
});

describe('scaffoldShared containment', () => {
  it('refuses a traversing module name without creating any directory', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    const created = scaffoldShared('../../../escape', appDir);

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error.code).toBe('INVALID_PATH_SEGMENT');
    }
    expect(fs.existsSync(path.join(sandbox, 'escape.ts'))).toBe(false);
    expect(fs.existsSync(path.join(appDir, 'src', 'shared'))).toBe(false);
  });

  it('still scaffolds an ordinary module name', () => {
    const appDir = path.join(sandbox, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    const created = scaffoldShared('billing-rules', appDir);

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value).toBe(path.join(appDir, 'src', 'shared', 'billing-rules.ts'));
      expect(fs.existsSync(created.value)).toBe(true);
    }
  });
});
