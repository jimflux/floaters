import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CashflowPage from "./pages/CashflowPage";
import RetirementPage from "./pages/RetirementPage";
import { useEffect, useState } from "react";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const App = () => {
  const [tab, setTab] = useState(() => window.location.hash === '#retirement' ? 'retirement' : 'cashflow');
  const [retirementMounted, setRetirementMounted] = useState(() => window.location.hash === '#retirement');
  useEffect(() => {
    const onHashChange = () => {
      const next = window.location.hash === '#retirement' ? 'retirement' : 'cashflow';
      setTab(next);
      if (next === 'retirement') setRetirementMounted(true);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const selectTab = (next: string) => {
    setTab(next);
    if (next === 'retirement') setRetirementMounted(true);
    window.location.hash = next;
  };
  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <nav aria-label="Floaters views" className="bg-aubergine px-4 pt-3 sm:px-6">
        <div role="tablist" aria-label="Planning views" className="mx-auto flex max-w-[1440px] gap-2">
          {['cashflow', 'retirement'].map(view => (
            <button key={view} id={`${view}-tab`} role="tab" type="button" aria-selected={tab === view} aria-controls={`${view}-panel`}
              className={`rounded-t-xl px-5 py-2 text-sm font-semibold transition-colors ${tab === view ? 'bg-background text-aubergine' : 'text-cloud hover:bg-cloud/10'}`}
              onClick={() => selectTab(view)}>{view === 'cashflow' ? 'Cashflow' : 'Retirement'}</button>
          ))}
        </div>
      </nav>
      <div id="cashflow-panel" role="tabpanel" aria-labelledby="cashflow-tab" hidden={tab !== 'cashflow'}><CashflowPage /></div>
      {retirementMounted && <div id="retirement-panel" role="tabpanel" aria-labelledby="retirement-tab" hidden={tab !== 'retirement'}><RetirementPage active={tab === 'retirement'} /></div>}
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
