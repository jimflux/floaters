import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Trash2, CalendarClock, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PipelineResponse, PipelineProjection, PipelineInvoice } from '@/lib/types';
import { createProjection, updateProjection, deleteProjection, reviewInvoice } from '@/lib/api';

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-GB');
  return n < 0 ? `-£${formatted}` : `£${formatted}`;
}

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

// What needs Jim's attention: unreviewed invoices plus lapsed projections.
// Drives the header entry badge.
export function attentionCount(pipeline: PipelineResponse | undefined): number {
  if (!pipeline) return 0;
  return pipeline.unreviewed.length + pipeline.projections.filter(p => p.lapsed).length;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: PipelineResponse | undefined;
}

export default function PipelinePanel({ open, onOpenChange, pipeline }: Props) {
  const unreviewedCount = pipeline?.unreviewed.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[480px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-2">
          <SheetTitle className="text-sm font-semibold">Income Pipeline</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="review" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mb-2">
            <TabsTrigger value="review" className="text-xs">
              To review{unreviewedCount > 0 ? ` (${unreviewedCount})` : ''}
            </TabsTrigger>
            <TabsTrigger value="projections" className="text-xs">Projections</TabsTrigger>
          </TabsList>
          <TabsContent value="review" className="flex-1 overflow-y-auto px-6 pb-6">
            <ReviewTab pipeline={pipeline} />
          </TabsContent>
          <TabsContent value="projections" className="flex-1 overflow-y-auto px-6 pb-6">
            <ProjectionsTab pipeline={pipeline} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// Shared optimistic plumbing: snapshot the pipeline cache, apply a patch,
// roll back on error (mirrors EditableCell), refetch everything on settle.
function usePipelineCache() {
  const queryClient = useQueryClient();
  const snapshot = async (patch: (old: PipelineResponse) => PipelineResponse) => {
    await queryClient.cancelQueries({ queryKey: ['pipeline'] });
    const previous = queryClient.getQueryData<PipelineResponse>(['pipeline']);
    queryClient.setQueryData<PipelineResponse>(['pipeline'], (old) => (old ? patch(old) : old));
    return { previous };
  };
  const rollback = (ctx: { previous?: PipelineResponse } | undefined) => {
    if (ctx?.previous) queryClient.setQueryData(['pipeline'], ctx.previous);
  };
  const settle = () => {
    queryClient.invalidateQueries({ queryKey: ['pipeline'] });
    queryClient.invalidateQueries({ queryKey: ['cashflow'] });
  };
  return { snapshot, rollback, settle };
}

/* --- To review tab --- */

function ReviewTab({ pipeline }: { pipeline: PipelineResponse | undefined }) {
  const { snapshot, rollback, settle } = usePipelineCache();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const unreviewed = pipeline?.unreviewed ?? [];

  const removeRows = (ids: string[]) => (old: PipelineResponse) => ({
    ...old,
    unreviewed: old.unreviewed.filter(i => !ids.includes(i.id)),
  });

  const approveMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => reviewInvoice(id, { reviewed: true }))).then(() => undefined),
    onMutate: (ids: string[]) => {
      setSelected(new Set());
      return snapshot(removeRows(ids));
    },
    onError: (_e, _v, ctx) => { rollback(ctx); toast.error('Failed to approve — restored'); },
    onSuccess: (_d, ids) => toast.success(ids.length > 1 ? `${ids.length} invoices approved` : 'Invoice approved'),
    onSettled: settle,
  });

  const assignMutation = useMutation({
    mutationFn: ({ invoiceId, projectionId }: { invoiceId: string; projectionId: string }) =>
      reviewInvoice(invoiceId, { projectionId }),
    onMutate: ({ invoiceId }) => snapshot(removeRows([invoiceId])),
    onError: (_e, _v, ctx) => { rollback(ctx); toast.error('Failed to assign — restored'); },
    onSuccess: () => toast.success('Invoice assigned to projection'),
    onSettled: settle,
  });

  if (unreviewed.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Nothing to review — all caught up.</p>;
  }

  const allSelected = selected.size === unreviewed.length && unreviewed.length > 0;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(unreviewed.map(i => i.id)));
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between py-1">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
          Select all
        </label>
        {selected.size > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" className="h-7 text-xs">Approve selected ({selected.size})</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Approve {selected.size} invoice{selected.size > 1 ? 's' : ''}?</AlertDialogTitle>
                <AlertDialogDescription>
                  They stay in the committed line and stop appearing in the tray. You can still assign them to projections later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => approveMutation.mutate([...selected])}>Approve</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {unreviewed.map(inv => (
        <ReviewRow
          key={inv.id}
          invoice={inv}
          projections={pipeline?.projections ?? []}
          checked={selected.has(inv.id)}
          onCheck={() => toggle(inv.id)}
          onApprove={() => approveMutation.mutate([inv.id])}
          onAssign={(projectionId) => assignMutation.mutate({ invoiceId: inv.id, projectionId })}
        />
      ))}
    </div>
  );
}

function ReviewRow({ invoice, projections, checked, onCheck, onApprove, onAssign }: {
  invoice: PipelineInvoice;
  projections: PipelineProjection[];
  checked: boolean;
  onCheck: () => void;
  onApprove: () => void;
  onAssign: (projectionId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Projections matching the invoice's contact first (D6), then the rest.
  const ordered = [...projections].sort((a, b) => {
    const aMatch = a.contactId && a.contactId === invoice.contactId ? 0 : 1;
    const bMatch = b.contactId && b.contactId === invoice.contactId ? 0 : 1;
    return aMatch - bMatch || a.expectedMonth.localeCompare(b.expectedMonth);
  });

  return (
    <div className="border border-border rounded-md p-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <Checkbox checked={checked} onCheckedChange={onCheck} className="mt-0.5" aria-label={`Select ${invoice.contactName || 'invoice'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{invoice.contactName || 'Unknown client'}</p>
            {invoice.overdue && (
              <span className="text-[10px] font-medium text-red-600 bg-red-500/10 px-1.5 py-0.5 rounded">Overdue</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatGBP(invoice.amountDue || invoice.total)}
            {invoice.dueDate ? ` · due ${invoice.dueDate}` : ''}
            {invoice.status === 'PAID' ? ' · paid' : ''}
          </p>
        </div>
      </div>
      <div className="flex gap-1.5 pl-6">
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onApprove}>Approve</Button>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-6 text-xs" disabled={projections.length === 0} title={projections.length === 0 ? 'No projections to assign to' : undefined}>
              <Link2 className="h-3 w-3 mr-1" />Assign
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[260px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Find projection…" className="h-8 text-xs" />
              <CommandList>
                <CommandEmpty>No matching projection.</CommandEmpty>
                <CommandGroup>
                  {ordered.map(p => (
                    <CommandItem
                      key={p.id}
                      value={`${p.clientLabel} ${p.expectedMonth}`}
                      onSelect={() => { setPickerOpen(false); onAssign(p.id); }}
                      className="text-xs"
                    >
                      <span className="truncate">{p.clientLabel}</span>
                      <span className="ml-auto text-muted-foreground">
                        {formatMonth(p.expectedMonth)} · {formatGBP(p.remainder)} left
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/* --- Projections tab --- */

function ProjectionsTab({ pipeline }: { pipeline: PipelineResponse | undefined }) {
  const projections = pipeline?.projections ?? [];
  const lapsed = projections.filter(p => p.lapsed);
  const active = projections.filter(p => !p.lapsed);

  return (
    <div className="space-y-4">
      <CreateProjectionForm contacts={pipeline?.contacts ?? []} />

      {projections.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">No projections yet — add your first above.</p>
      )}

      {lapsed.length > 0 && (
        <div>
          <p className="text-xs font-medium text-amber-600 mb-2">Lapsed — re-date or delete</p>
          <div className="space-y-2">
            {lapsed.map(p => <ProjectionRow key={p.id} projection={p} lapsed />)}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Active</p>
          <div className="space-y-2">
            {active.map(p => <ProjectionRow key={p.id} projection={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateProjectionForm({ contacts }: { contacts: PipelineResponse['contacts'] }) {
  const { rollback, settle } = usePipelineCache();
  const [label, setLabel] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [month, setMonth] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: createProjection,
    onError: (_e, _v, ctx) => { rollback(ctx as { previous?: PipelineResponse } | undefined); toast.error('Failed to add projection'); },
    onSuccess: () => {
      toast.success('Projection added');
      setLabel(''); setContactId(null); setAmount(''); setMonth('');
    },
    onSettled: settle,
  });

  const handleAdd = () => {
    const num = parseFloat(amount);
    if (!label.trim()) { toast.error('Give the projection a client'); return; }
    if (isNaN(num) || num <= 0) { toast.error('Amount must be above zero'); return; }
    if (!/^\d{4}-\d{2}$/.test(month)) { toast.error('Pick an expected month'); return; }
    createMutation.mutate({ clientLabel: label.trim(), amount: num, expectedMonth: month, contactId });
  };

  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Add projection</p>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-8 w-full justify-start text-xs font-normal">
            {label || 'Client…'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Client name…"
              className="h-8 text-xs"
              value={label}
              onValueChange={(v) => { setLabel(v); setContactId(null); }}
            />
            <CommandList>
              <CommandEmpty>
                <span className="text-xs">Press close to use "{label}"</span>
              </CommandEmpty>
              <CommandGroup>
                {contacts.map(c => (
                  <CommandItem
                    key={c.contactId}
                    value={c.name || c.contactId}
                    onSelect={() => {
                      setLabel(c.name || c.contactId);
                      setContactId(c.contactId);
                      setPickerOpen(false);
                    }}
                    className="text-xs"
                  >
                    {c.name || c.contactId}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-muted-foreground" htmlFor="proj-amount">Amount (inc VAT)</label>
          <Input id="proj-amount" type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-muted-foreground" htmlFor="proj-month">Expected month</label>
          <Input id="proj-month" type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-sm" />
        </div>
      </div>
      <Button size="sm" className="h-7 text-xs w-full" onClick={handleAdd} disabled={createMutation.isPending}>
        Add projection
      </Button>
    </div>
  );
}

function ProjectionRow({ projection, lapsed = false }: { projection: PipelineProjection; lapsed?: boolean }) {
  const { snapshot, rollback, settle } = usePipelineCache();
  const [dateOpen, setDateOpen] = useState(false);
  const [newMonth, setNewMonth] = useState(projection.expectedMonth);

  const overAssignedBy = projection.consumed - projection.amount;

  const redateMutation = useMutation({
    mutationFn: (expectedMonth: string) => updateProjection(projection.id, { expectedMonth }),
    onMutate: (expectedMonth: string) =>
      snapshot(old => ({
        ...old,
        projections: old.projections.map(p =>
          p.id === projection.id
            ? { ...p, expectedMonth, lapsed: expectedMonth < old.currentMonth && p.remainder > 0 }
            : p
        ),
      })),
    onError: (_e, _v, ctx) => { rollback(ctx); toast.error('Failed to re-date — restored'); },
    onSuccess: () => toast.success('Projection re-dated'),
    onSettled: settle,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProjection(projection.id),
    onMutate: () =>
      snapshot(old => ({ ...old, projections: old.projections.filter(p => p.id !== projection.id) })),
    onError: (_e, _v, ctx) => { rollback(ctx); toast.error('Failed to delete — restored'); },
    onSuccess: () => toast.success('Projection deleted — its invoices stay as standalone'),
    onSettled: settle,
  });

  const handleRedate = () => {
    if (!/^\d{4}-\d{2}$/.test(newMonth)) return;
    if (newMonth < projection.expectedMonth) {
      toast.warning('Moving a projection backwards can lapse it immediately');
    }
    setDateOpen(false);
    redateMutation.mutate(newMonth);
  };

  return (
    <div className={`border rounded-md p-2.5 ${lapsed ? 'border-amber-400/60 bg-amber-500/5' : 'border-border'}`}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{projection.clientLabel}</p>
            {overAssignedBy > 0 && (
              <span className="text-[10px] font-medium text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded" title="Assigned invoices exceed the projected amount">
                Over-assigned by {formatGBP(overAssignedBy)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatGBP(projection.amount)} · {formatMonth(projection.expectedMonth)}
            {projection.invoiceIds.length > 0
              ? ` · ${formatGBP(projection.remainder)} left (${projection.invoiceIds.length} invoice${projection.invoiceIds.length > 1 ? 's' : ''})`
              : ''}
          </p>
        </div>
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Re-date">
              <CalendarClock className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-3 space-y-2" align="end">
            <p className="text-xs text-muted-foreground font-medium">Expected month</p>
            <Input type="month" value={newMonth} onChange={e => setNewMonth(e.target.value)} className="h-8 text-sm" />
            <Button size="sm" className="h-7 text-xs w-full" onClick={handleRedate}>Save</Button>
          </PopoverContent>
        </Popover>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this projection?</AlertDialogTitle>
              <AlertDialogDescription>
                {projection.invoiceIds.length > 0
                  ? `Its ${projection.invoiceIds.length} assigned invoice${projection.invoiceIds.length > 1 ? 's' : ''} will be released and stay as standalone.`
                  : 'It leaves the optimistic line immediately.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
