import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from './api';

export type Framework = {
  frameworkId: string;
  displayName: string;
  status: 'verified' | 'disabled' | 'unavailable' | 'unsupported';
  enabled: boolean;
};

type FrameworkContextValue = {
  frameworks: Framework[];
  frameworkId: string;
  framework: Framework | undefined;
  loading: boolean;
  error: string;
  selectionIssue: string;
  selectFramework: (frameworkId: string) => void;
  refreshFrameworks: () => Promise<void>;
};

const FrameworkContext = createContext<FrameworkContextValue | null>(null);

function requestedFramework(): string {
  return new URLSearchParams(window.location.search).get('framework') ?? '';
}

function writeFrameworkToUrl(frameworkId: string) {
  const url = new URL(window.location.href);
  if (frameworkId) url.searchParams.set('framework', frameworkId);
  else url.searchParams.delete('framework');
  window.history.replaceState(null, '', url);
}

export function FrameworkProvider({ children }: { children: React.ReactNode }) {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [frameworkId, setFrameworkId] = useState('');
  const frameworkIdRef = useRef('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectionIssue, setSelectionIssue] = useState('');

  const refreshFrameworks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api<{ items: Framework[] }>('/frameworks');
      const available = response.items.filter((item) => item.enabled && item.status === 'verified');
      setFrameworks(available);
      const current = frameworkIdRef.current;
      if (current && available.some((item) => item.frameworkId === current)) return;
      const requested = requestedFramework();
      if (requested && !available.some((item) => item.frameworkId === requested)) {
        frameworkIdRef.current = '';
        setFrameworkId('');
        setSelectionIssue(
          `Framework ${requested} is not enabled and verified. Select an available framework.`,
        );
        writeFrameworkToUrl('');
        return;
      }
      const selected = requested || available[0]?.frameworkId || '';
      frameworkIdRef.current = selected;
      setFrameworkId(selected);
      setSelectionIssue('');
      writeFrameworkToUrl(selected);
    } catch (cause) {
      setFrameworks([]);
      setFrameworkId('');
      setError(cause instanceof Error ? cause.message : 'Hermes framework discovery failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshFrameworks();
  }, [refreshFrameworks]);

  const selectFramework = useCallback(
    (next: string) => {
      if (!next) {
        frameworkIdRef.current = '';
        setFrameworkId('');
        setSelectionIssue('Select an enabled, verified framework.');
        writeFrameworkToUrl('');
        return;
      }
      if (!frameworks.some((item) => item.frameworkId === next)) {
        frameworkIdRef.current = '';
        setFrameworkId('');
        setSelectionIssue(`Framework ${next} is not enabled and verified.`);
        writeFrameworkToUrl('');
        return;
      }
      frameworkIdRef.current = next;
      setFrameworkId(next);
      setSelectionIssue('');
      writeFrameworkToUrl(next);
    },
    [frameworks],
  );

  const value = useMemo<FrameworkContextValue>(
    () => ({
      frameworks,
      frameworkId,
      framework: frameworks.find((item) => item.frameworkId === frameworkId),
      loading,
      error,
      selectionIssue,
      selectFramework,
      refreshFrameworks,
    }),
    [error, frameworkId, frameworks, loading, refreshFrameworks, selectFramework, selectionIssue],
  );

  return <FrameworkContext.Provider value={value}>{children}</FrameworkContext.Provider>;
}

export function useFrameworkContext(): FrameworkContextValue {
  const context = useContext(FrameworkContext);
  if (!context) throw new Error('useFrameworkContext must be used inside FrameworkProvider');
  return context;
}
