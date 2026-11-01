import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface SliceErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface SliceErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class SliceErrorBoundary extends Component<SliceErrorBoundaryProps, SliceErrorBoundaryState> {
  override state: SliceErrorBoundaryState = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): SliceErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.onError) {
      this.props.onError(error, info);
    } else {
      console.error('[SliceErrorBoundary] Erro capturado na interface da fatia:', error, info);
    }
  }

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          role="alert"
          style={{
            padding: '1rem',
            border: '1px solid #f43f5e',
            borderRadius: '0.375rem',
            background: 'rgba(244, 63, 94, 0.1)',
            color: '#f43f5e',
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Erro na interface da fatia:</strong>
          <span>{this.state.error.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
