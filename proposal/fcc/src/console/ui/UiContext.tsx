import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type PanelId = 'agents' | 'drafts' | 'ledger' | 'log' | 'layers';

interface UiState {
  panel: PanelId | null;
  setPanel: (p: PanelId | null) => void;
  togglePanel: (p: PanelId) => void;
  /** Action whose draft is open in the Drafts drawer. */
  draftId: string | null;
  openDraft: (actionId: string | null) => void;
  legend: boolean;
  setLegend: (on: boolean) => void;
  summary: boolean;
  setSummary: (on: boolean) => void;
}

const Ctx = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [legend, setLegend] = useState(false);
  const [summary, setSummary] = useState(false);
  const value = useMemo<UiState>(
    () => ({
      panel,
      setPanel,
      togglePanel: (p) => setPanel((cur) => (cur === p ? null : p)),
      draftId,
      openDraft: (id) => {
        setDraftId(id);
        if (id) setPanel('drafts');
      },
      legend,
      setLegend,
      summary,
      setSummary,
    }),
    [panel, draftId, legend, summary],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUi must be used inside <UiProvider>');
  return v;
}
