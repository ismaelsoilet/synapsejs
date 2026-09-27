import React, { type ReactNode, useMemo, useState } from 'react';

// ============================================================================
// 1. BADGE COMPONENT
// ============================================================================
export interface BadgeProps {
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children?: ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  const variantStyles = {
    neutral: 'bg-slate-700/60 text-slate-300 border-slate-600',
    success: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
    warning: 'bg-amber-950/70 text-amber-300 border-amber-800',
    danger: 'bg-rose-950/70 text-rose-300 border-rose-800',
    info: 'bg-sky-950/70 text-sky-300 border-sky-800'
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

// ============================================================================
// 2. BUTTON COMPONENT
// ============================================================================
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const variantStyles = {
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-sm disabled:opacity-50',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-50',
    danger: 'bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-50',
    outline: 'border border-slate-600 hover:bg-slate-800 text-slate-300 disabled:opacity-50'
  };

  const sizeStyles = {
    sm: 'px-2.5 py-1 text-xs rounded',
    md: 'px-3.5 py-2 text-sm rounded-md',
    lg: 'px-4 py-2.5 text-base rounded-md'
  };

  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
          <title>Carregando</title>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}

// ============================================================================
// 3. CARD COMPONENT
// ============================================================================
export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Card({ title, subtitle, actions, children, className = '' }: CardProps) {
  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-lg p-5 shadow-sm ${className}`}>
      {(title || subtitle || actions) && (
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <div>
            {title && <h3 className="text-base font-semibold text-slate-100">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ============================================================================
// 4. PAGINATION COMPONENT
// ============================================================================
export interface PaginationProps {
  currentPage?: number;
  totalPages?: number;
  total?: number;
  limit?: number;
  offset?: number;
  onPageChange?: (page: number) => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  total,
  limit,
  offset,
  onPageChange,
  className = ''
}: PaginationProps) {
  const current = currentPage ?? (limit && offset !== undefined ? Math.floor(offset / limit) + 1 : 1);
  const pages = totalPages ?? (total !== undefined && limit ? Math.max(1, Math.ceil(total / limit)) : 1);
  if (pages <= 1) return null;

  return (
    <div className={`flex items-center justify-between pt-4 text-xs text-slate-400 ${className}`}>
      <span>{`Página ${current} de ${pages}`}</span>
      <div className="flex gap-1.5">
        <Button size="sm" variant="secondary" disabled={current <= 1} onClick={() => onPageChange?.(current - 1)}>
          Anterior
        </Button>
        <Button size="sm" variant="secondary" disabled={current >= pages} onClick={() => onPageChange?.(current + 1)}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// 5. DATATABLE COMPONENT
// ============================================================================
// biome-ignore lint/suspicious/noExplicitAny: generic boundary for arbitrary row objects
export interface Column<T = any> {
  key: keyof T | string;
  label?: string;
  header?: string;
  sortable?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: render callback accepts any cell value
  render?: (value: any, row: T) => ReactNode;
  width?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: generic boundary for arbitrary row records
export interface DataTableProps<T = any> {
  data: T[];
  columns: Column<T>[];
  searchable?: Array<keyof T | string>;
  pagination?: {
    pageSize?: number;
  };
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  className?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: table data rows are arbitrary records
export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  searchable,
  pagination,
  emptyMessage = 'Nenhum registro encontrado.',
  onRowClick,
  className = ''
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const pageSize = pagination?.pageSize ?? (pagination ? 10 : Infinity);

  // 1. Filter
  const filteredData = useMemo(() => {
    if (!search || !searchable || searchable.length === 0) {
      return data;
    }
    const q = search.toLowerCase();
    return data.filter((row) =>
      searchable.some((k) => {
        const val = row[k as keyof T];
        return val !== undefined && val !== null && String(val).toLowerCase().includes(q);
      })
    );
  }, [data, search, searchable]);

  // 2. Sort
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const cmp = aVal < bVal ? -1 : 1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sortKey, sortDir]);

  // 3. Paginate
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const paginatedData = useMemo(() => {
    if (pageSize === Infinity) return sortedData;
    const start = (page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {searchable && searchable.length > 0 && (
        <div className="flex justify-between items-center">
          <input
            type="text"
            placeholder="Filtrar registros..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full max-w-xs px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-800/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
            <tr>
              {columns.map((col) => {
                const keyStr = String(col.key);
                return (
                  <th
                    key={keyStr}
                    style={col.width ? { width: col.width } : undefined}
                    onClick={() => col.sortable && handleSort(keyStr)}
                    className={`px-4 py-3 ${col.sortable ? 'cursor-pointer select-none hover:text-slate-200' : ''}`}
                  >
                    <div className="flex items-center gap-1">
                      <span>{col.label ?? col.header ?? keyStr}</span>
                      {col.sortable && sortKey === keyStr && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((row, idx) => (
                <tr
                  key={row.id !== undefined && row.id !== null ? String(row.id) : idx}
                  onClick={() => onRowClick?.(row)}
                  className={`hover:bg-slate-800/40 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map((col) => {
                    const val = row[col.key as keyof T];
                    return (
                      <td key={String(col.key)} className="px-4 py-3">
                        {col.render ? col.render(val, row) : val !== null && val !== undefined ? String(val) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />}
    </div>
  );
}

// ============================================================================
// 6. DATAFORM COMPONENT
// ============================================================================
export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'password' | 'select' | 'textarea' | 'checkbox';
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
}

export interface DataFormProps {
  fields: FormField[];
  onSubmit: (formData: Record<string, unknown>) => Promise<unknown>;
  submitLabel?: string;
  isSubmitting?: boolean;
  error?: string | null;
  successMessage?: string | null;
  className?: string;
}

export function DataForm({
  fields,
  onSubmit,
  submitLabel = 'Salvar',
  isSubmitting = false,
  error,
  successMessage,
  className = ''
}: DataFormProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of fields) {
      initial[f.name] = f.defaultValue ?? (f.type === 'checkbox' ? false : '');
    }
    return initial;
  });

  const handleChange = (name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formValues);
  };

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`}>
      {error && <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-300 rounded text-xs">{error}</div>}

      {successMessage && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded text-xs">
          {successMessage}
        </div>
      )}

      {fields.map((field) => (
        <div key={field.name} className="space-y-1">
          {field.type !== 'checkbox' && (
            <label htmlFor={field.name} className="block text-xs font-medium text-slate-300">
              {field.label} {field.required && <span className="text-rose-400">*</span>}
            </label>
          )}

          {field.type === 'select' ? (
            <select
              id={field.name}
              value={
                formValues[field.name] !== undefined && formValues[field.name] !== null
                  ? String(formValues[field.name])
                  : ''
              }
              onChange={(e) => handleChange(field.name, e.target.value)}
              required={field.required}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="">Selecione...</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : field.type === 'textarea' ? (
            <textarea
              id={field.name}
              rows={3}
              value={
                formValues[field.name] !== undefined && formValues[field.name] !== null
                  ? String(formValues[field.name])
                  : ''
              }
              onChange={(e) => handleChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          ) : field.type === 'checkbox' ? (
            <label htmlFor={field.name} className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
              <input
                id={field.name}
                type="checkbox"
                checked={Boolean(formValues[field.name])}
                onChange={(e) => handleChange(field.name, e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-0"
              />
              <span>{field.placeholder || field.label}</span>
            </label>
          ) : (
            <input
              id={field.name}
              type={field.type || 'text'}
              value={
                formValues[field.name] !== undefined && formValues[field.name] !== null
                  ? String(formValues[field.name])
                  : ''
              }
              onChange={(e) =>
                handleChange(field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)
              }
              placeholder={field.placeholder}
              required={field.required}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          )}

          {field.helpText && <p className="text-[10px] text-slate-500">{field.helpText}</p>}
        </div>
      ))}

      <Button type="submit" loading={isSubmitting} variant="primary" className="w-full mt-2">
        {submitLabel}
      </Button>
    </form>
  );
}
