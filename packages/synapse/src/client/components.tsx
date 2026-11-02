import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

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
// 6. DATAFORM COMPONENT WITH NESTED DOT-NOTATION & FILE SUPPORT
// ============================================================================
export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'password' | 'select' | 'textarea' | 'checkbox' | 'file';
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
  fieldErrors?: Record<string, string>;
  successMessage?: string | null;
  className?: string;
}

const FORBIDDEN_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype']);

export function setNestedProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  if (parts.some((p) => FORBIDDEN_PROPERTIES.has(p.trim()))) {
    return;
  }
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (FORBIDDEN_PROPERTIES.has(part)) return;
    if (!cur[part] || typeof cur[part] !== 'object') {
      cur[part] = Object.create(null);
    }
    cur = cur[part] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  if (!FORBIDDEN_PROPERTIES.has(lastKey)) {
    cur[lastKey] = value;
  }
}

export function getNestedProperty(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  if (parts.some((p) => FORBIDDEN_PROPERTIES.has(p.trim()))) {
    return undefined;
  }
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || FORBIDDEN_PROPERTIES.has(part)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function expandNestedObject(flat: Record<string, unknown>): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (FORBIDDEN_PROPERTIES.has(key.trim())) {
      continue;
    }
    if (key.includes('.')) {
      setNestedProperty(nested, key, value);
    } else {
      nested[key] = value;
    }
  }
  return nested;
}

export function DataForm({
  fields,
  onSubmit,
  submitLabel = 'Salvar',
  isSubmitting = false,
  error,
  fieldErrors,
  successMessage,
  className = ''
}: DataFormProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of fields) {
      initial[f.name] = f.defaultValue ?? (f.type === 'checkbox' ? false : f.type === 'file' ? null : '');
    }
    return initial;
  });

  const handleChange = (name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = expandNestedObject(formValues);
    await onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`}>
      {error && <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-300 rounded text-xs">{error}</div>}

      {successMessage && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded text-xs">
          {successMessage}
        </div>
      )}

      {fields.map((field) => {
        const fieldError =
          fieldErrors?.[field.name] || (getNestedProperty(fieldErrors || {}, field.name) as string | undefined);
        const borderClass = fieldError
          ? 'border-rose-500 focus:border-rose-400'
          : 'border-slate-700 focus:border-emerald-500';

        return (
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
                className={`w-full px-3 py-2 text-xs bg-slate-800 border rounded text-slate-100 focus:outline-none ${borderClass}`}
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
                className={`w-full px-3 py-2 text-xs bg-slate-800 border rounded text-slate-100 placeholder-slate-500 focus:outline-none ${borderClass}`}
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
            ) : field.type === 'file' ? (
              <input
                id={field.name}
                type="file"
                onChange={(e) => handleChange(field.name, e.target.files?.[0] ?? null)}
                required={field.required}
                className={`w-full px-3 py-2 text-xs bg-slate-800 border rounded text-slate-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600 ${borderClass}`}
              />
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
                className={`w-full px-3 py-2 text-xs bg-slate-800 border rounded text-slate-100 placeholder-slate-500 focus:outline-none ${borderClass}`}
              />
            )}

            {fieldError && <p className="text-[11px] text-rose-400">{fieldError}</p>}
            {field.helpText && !fieldError && <p className="text-[10px] text-slate-500">{field.helpText}</p>}
          </div>
        );
      })}

      <Button type="submit" loading={isSubmitting} variant="primary" className="w-full mt-2">
        {submitLabel}
      </Button>
    </form>
  );
}

// ============================================================================
// 7. MODAL / DIALOG COMPONENT (WAI-ARIA COMPLIANT)
// ============================================================================
export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  className = '',
  closeOnBackdrop = true
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeStyles = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw] h-[90vh]'
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 }}
      onClick={closeOnBackdrop ? onClose : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      aria-modal="true"
      role="dialog"
      tabIndex={-1}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
        className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col w-full overflow-hidden transition-all duration-200 transform scale-100 ${sizeStyles[size]} ${className}`}
      >
        {(title || description) && (
          <div className="flex items-start justify-between p-5 border-b border-slate-800">
            <div>
              {title && <h3 className="text-lg font-bold text-slate-100 tracking-tight">{title}</h3>}
              {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar diálogo"
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors text-base font-mono leading-none"
            >
              ✕
            </button>
          </div>
        )}
        <div className="p-5 overflow-y-auto flex-1 text-slate-200 text-sm leading-relaxed">{children}</div>
        {footer && (
          <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 8. DRAWER / SLIDE-OVER SHEET COMPONENT
// ============================================================================
export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  position?: 'left' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'full';
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  position = 'right',
  size = 'md',
  children,
  footer,
  className = '',
  closeOnBackdrop = true
}: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    full: 'max-w-full'
  };

  const posStyles = {
    right: 'inset-y-0 right-0',
    left: 'inset-y-0 left-0'
  };

  return (
    <div
      className="fixed inset-0 z-50 flex bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 }}
      onClick={closeOnBackdrop ? onClose : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      aria-modal="true"
      role="dialog"
      tabIndex={-1}
    >
      <div
        ref={drawerRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
        className={`fixed ${posStyles[position]} flex flex-col h-full w-full bg-slate-900 border-${position === 'right' ? 'l' : 'r'} border-slate-800 shadow-2xl overflow-hidden transition-transform duration-300 ${sizeStyles[size]} ${className}`}
        style={{ position: 'fixed', top: 0, bottom: 0, [position]: 0 }}
      >
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div>
            {title && <h3 className="text-lg font-bold text-slate-100 tracking-tight">{title}</h3>}
            {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel lateral"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors text-base font-mono leading-none"
          >
            ✕
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 text-slate-200 text-sm leading-relaxed">{children}</div>
        {footer && (
          <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 9. TABS ACCESSIBLE COMPONENT
// ============================================================================
interface TabsContextValue {
  value: string;
  setValue: (val: string) => void;
}
const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (val: string) => void;
  syncQueryParam?: string;
  children?: ReactNode;
  className?: string;
}

export function Tabs({
  defaultValue = '',
  value: controlledValue,
  onValueChange,
  syncQueryParam,
  children,
  className = ''
}: TabsProps) {
  const [internalValue, setInternalValue] = useState<string>(() => {
    if (typeof window !== 'undefined' && syncQueryParam) {
      const sp = new URLSearchParams(window.location.search);
      const fromUrl = sp.get(syncQueryParam);
      if (fromUrl) return fromUrl;
    }
    return defaultValue;
  });

  const activeValue = controlledValue !== undefined ? controlledValue : internalValue;

  const handleValueChange = useCallback(
    (newVal: string) => {
      if (controlledValue === undefined) {
        setInternalValue(newVal);
      }
      onValueChange?.(newVal);

      if (typeof window !== 'undefined' && syncQueryParam) {
        const url = new URL(window.location.href);
        url.searchParams.set(syncQueryParam, newVal);
        window.history.replaceState({}, '', url.toString());
      }
    },
    [controlledValue, onValueChange, syncQueryParam]
  );

  return (
    <TabsContext.Provider value={{ value: activeValue, setValue: handleValueChange }}>
      <div className={`space-y-4 ${className}`}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  children?: ReactNode;
  className?: string;
}

export function TabList({ children, className = '' }: TabListProps) {
  return (
    <div
      role="tablist"
      className={`flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto ${className}`}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Tab({ value, children, disabled = false, className = '' }: TabProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('<Tab> must be used within <Tabs>');

  const isSelected = ctx.value === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={() => ctx.setValue(value)}
      className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap ${
        isSelected
          ? 'bg-slate-800 text-cyan-400 shadow-sm border border-slate-700/80 font-bold'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  children?: ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className = '' }: TabPanelProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('<TabPanel> must be used within <Tabs>');

  if (ctx.value !== value) return null;

  return (
    <div role="tabpanel" className={`focus:outline-none ${className}`}>
      {children}
    </div>
  );
}

// ============================================================================
// 10. DROPDOWN MENU ACCESSIBLE COMPONENT
// ============================================================================
export interface DropdownMenuProps {
  trigger: ReactNode;
  align?: 'left' | 'right';
  children?: ReactNode;
  className?: string;
}

export function DropdownMenu({ trigger, align = 'right', children, className = '' }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const alignStyles = {
    left: 'left-0',
    right: 'right-0'
  };

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      {/* biome-ignore lint/a11y/useSemanticElements: custom trigger wrapper avoids button-inside-button HTML nesting */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className="text-left bg-transparent border-0 p-0 m-0 cursor-pointer inline-block"
      >
        {trigger}
      </div>
      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          tabIndex={-1}
          className={`absolute ${alignStyles[align]} mt-2 w-52 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-1 z-50 animate-in fade-in duration-150`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface DropdownItemProps {
  onClick?: () => void;
  variant?: 'default' | 'danger';
  icon?: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}

export function DropdownItem({
  onClick,
  variant = 'default',
  icon,
  disabled = false,
  children,
  className = ''
}: DropdownItemProps) {
  const variantStyles = {
    default: 'text-slate-300 hover:text-white hover:bg-slate-800',
    danger: 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/50'
  };

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${variantStyles[variant]} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}
