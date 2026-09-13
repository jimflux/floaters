import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { TimeTrackingResponse } from '@/lib/types';
import { triggerTimeSync, patchTimeClientLink } from '@/lib/api';
import { formatHours } from '@/lib/time';

// Time tracking side panel: sync state, the running timer, today / this week,
// and the Toggl client -> pipeline client links that put hours next to what
// was invoiced.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  time: TimeTrackingResponse | undefined;
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  const minutes = Math.floor((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function useElapsed(startedAt: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return '';
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export default function TimePanel({ open, onOpenChange, time }: Props) {
  const queryClient = useQueryClient();
  const running = time?.running ?? null;
  const elapsed = useElapsed(running?.startedAt ?? null);

  const syncMutation = useMutation({
    mutationFn: (full: boolean) => triggerTimeSync(full),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time'] });
      toast.success('Toggl synced');
    },
    onError: (err: Error) => toast.error(err.message || 'Toggl sync failed'),
  });

  const linkMutation = useMutation({
    mutationFn: ({ togglClientId, clientKey }: { togglClientId: number; clientKey: string | null }) =>
      patchTimeClientLink(togglClientId, clientKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['time'] }),
    onError: () => toast.error('Failed to update link'),
  });

  const togglClients = (time?.clients ?? []).filter(c => c.togglClientId !== null);
  const linkOptions = time?.linkOptions ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-2">
          <SheetTitle className="text-sm font-semibold">Time tracking</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
          {!time?.configured ? (
            <p className="text-xs text-muted-foreground">
              Toggl is not connected. Set <code className="text-[11px]">TOGGL_API_TOKEN</code> on the API (your personal API token from Toggl profile settings) and redeploy, then sync.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">Toggl</p>
                  <p className="text-xs text-muted-foreground">
                    Synced {formatWhen(time.lastSyncedAt)}
                    {time.syncStatus === 'error' && time.syncError ? ` · last error: ${time.syncError}` : ''}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => syncMutation.mutate(false)} disabled={syncMutation.isPending}>
                  <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                  <span className="ml-1.5">Sync</span>
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="Today" value={formatHours(time.todayHours) || '0h'} />
                <Stat label="This week" value={formatHours(time.weekHours) || '0h'} />
              </div>

              <div className="rounded-md border border-border px-3 py-2">
                {running ? (
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">{running.description || 'No description'}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[running.clientName, running.projectName].filter(Boolean).join(' · ') || 'No project'} · running {elapsed}
                        {running.billable ? ' · billable' : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No timer running.</p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Client links</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Link each Toggl client to its pipeline client so hours sit next to what was invoiced. Names that match are linked automatically.
                </p>
                <div className="space-y-2">
                  {togglClients.length === 0 && (
                    <p className="text-xs text-muted-foreground">No Toggl clients in the current window.</p>
                  )}
                  {togglClients.map(c => (
                    <div key={c.togglClientId!} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{c.clientName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {c.linkSource === 'manual' ? 'Linked (set by you)' : c.linkSource === 'auto' ? 'Linked (matched by name)' : 'Not linked'}
                        </p>
                      </div>
                      <select
                        aria-label={`Pipeline client for ${c.clientName}`}
                        className="h-8 max-w-[190px] rounded-md border border-input bg-background px-2 text-xs"
                        value={c.linkSource === 'manual' ? c.clientKey ?? '' : ''}
                        disabled={linkMutation.isPending}
                        onChange={e => linkMutation.mutate({ togglClientId: c.togglClientId!, clientKey: e.target.value || null })}
                      >
                        <option value="">{c.linkSource === 'auto' ? `Auto: ${nameFor(linkOptions, c.clientKey)}` : 'Auto-match by name'}</option>
                        {linkOptions.map(o => (
                          <option key={o.clientKey} value={o.clientKey}>{o.clientName}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Hours bucket by their start day in {time.timeZone}. A full re-sync walks the last 12 months:{' '}
                <button className="underline" onClick={() => syncMutation.mutate(true)} disabled={syncMutation.isPending}>run one</button>.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function nameFor(options: Array<{ clientKey: string; clientName: string }>, key: string | null): string {
  return options.find(o => o.clientKey === key)?.clientName ?? key ?? '';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
