import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { CashflowAccountInfo, AccountGroup } from '@/lib/types';
import {
  hideAccount, unhideAccount,
  getAccountGroups, createAccountGroup, deleteAccountGroup,
  getVatSettings, patchVat,
} from '@/lib/api';

export interface VatClient {
  clientKey: string;
  clientName: string;
  vatable?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: CashflowAccountInfo[];
  vatClients?: VatClient[];
  vatCurrentQuarter?: { key: string; paid: boolean };
}

export default function AccountManagementPanel({ open, onOpenChange, accounts, vatClients = [], vatCurrentQuarter }: Props) {
  const queryClient = useQueryClient();
  const costAccounts = accounts.filter(a => a.section === 'costs');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-2">
          <SheetTitle className="text-sm font-semibold">Account Management</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="accounts" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mb-2">
            <TabsTrigger value="accounts" className="text-xs">Accounts</TabsTrigger>
            <TabsTrigger value="groups" className="text-xs">Groups</TabsTrigger>
            <TabsTrigger value="vat" className="text-xs">VAT</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts" className="flex-1 overflow-y-auto px-6 pb-6">
            <AccountsTab
              costAccounts={costAccounts}
              queryClient={queryClient}
            />
          </TabsContent>
          <TabsContent value="groups" className="flex-1 overflow-y-auto px-6 pb-6">
            <GroupsTab accounts={accounts} queryClient={queryClient} />
          </TabsContent>
          <TabsContent value="vat" className="flex-1 overflow-y-auto px-6 pb-6">
            <VatTab vatClients={vatClients} vatCurrentQuarter={vatCurrentQuarter} queryClient={queryClient} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function VatTab({
  vatClients, vatCurrentQuarter, queryClient,
}: {
  vatClients: VatClient[];
  vatCurrentQuarter?: { key: string; paid: boolean };
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const { data: vat } = useQuery({ queryKey: ['vat'], queryFn: getVatSettings });
  const enabled = vat?.enabled ?? false;

  const mutate = useMutation({
    mutationFn: patchVat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vat'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    },
    onError: () => toast.error('Failed to update VAT settings'),
  });

  // Prefer the resolved flag from the cashflow response; fall back to the
  // stored override when the client isn't in the current grid.
  const overrideFor = (key: string) => vat?.overrides.find(o => o.clientKey === key)?.vatable;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between py-1.5">
        <div className="min-w-0">
          <p className="text-sm">Enable VAT</p>
          <p className="text-xs text-muted-foreground">Accrue output VAT and show the quarterly bill</p>
        </div>
        <Switch
          checked={enabled}
          disabled={mutate.isPending}
          onCheckedChange={(v) => mutate.mutate({ enabled: v })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Standard accrual, 20%. Quarters end May, Aug, Nov, Feb; paid ~1 month + 7 days after.
      </p>

      {enabled && (
        <>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">VATable clients</p>
            <div className="space-y-1">
              {vatClients.length === 0 && (
                <p className="text-xs text-muted-foreground">No clients in the current view.</p>
              )}
              {vatClients.map(c => {
                const checked = c.vatable ?? overrideFor(c.clientKey) ?? true;
                return (
                  <div key={c.clientKey} className="flex items-center justify-between py-1.5">
                    <p className="text-sm truncate">{c.clientName}</p>
                    <Switch
                      checked={checked}
                      disabled={mutate.isPending}
                      onCheckedChange={(v) => mutate.mutate({ clientKey: c.clientKey, vatable: v })}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {vatCurrentQuarter && (
            <label className="flex items-center gap-2 py-1.5 cursor-pointer">
              <Checkbox
                checked={vatCurrentQuarter.paid}
                disabled={mutate.isPending}
                onCheckedChange={(v) =>
                  mutate.mutate(
                    v
                      ? { markPaidQuarter: vatCurrentQuarter.key }
                      : { unmarkPaidQuarter: vatCurrentQuarter.key }
                  )
                }
              />
              <span className="text-sm">This quarter's VAT is paid</span>
            </label>
          )}
        </>
      )}
    </div>
  );
}

function AccountsTab({
  costAccounts, queryClient,
}: {
  costAccounts: CashflowAccountInfo[];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  // Income is rolled up by client now, not account rows, so hiding an income
  // account would change nothing on the grid. Only cost accounts still have a
  // meaningful visibility toggle.
  return (
    <div className="space-y-4">
      <AccountSection label="Cost Accounts" accounts={costAccounts} queryClient={queryClient} />
    </div>
  );
}

function AccountSection({
  label, accounts, queryClient,
}: {
  label: string;
  accounts: CashflowAccountInfo[];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      <div className="space-y-1">
        {accounts.map(account => (
          <AccountToggleRow key={account.code} account={account} queryClient={queryClient} />
        ))}
      </div>
    </div>
  );
}

function AccountToggleRow({
  account, queryClient,
}: {
  account: CashflowAccountInfo;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const mutation = useMutation({
    mutationFn: () => account.hidden ? unhideAccount(account.code) : hideAccount(account.code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    },
    onError: () => toast.error('Failed to update account visibility'),
  });

  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="min-w-0">
        <p className="text-sm truncate">{account.name}</p>
        <p className="text-xs text-muted-foreground">{account.code}</p>
      </div>
      <Switch
        checked={!account.hidden}
        disabled={mutation.isPending}
        onCheckedChange={() => mutation.mutate()}
      />
    </div>
  );
}

function GroupsTab({
  accounts, queryClient,
}: {
  accounts: CashflowAccountInfo[];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['account-groups'],
    queryFn: getAccountGroups,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccountGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-groups'] });
      toast.success('Group deleted');
    },
    onError: () => toast.error('Failed to delete group'),
  });

  const groups = data?.groups || [];
  const accountMap = new Map(accounts.map(a => [a.code, a.name]));

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {groups.map(group => (
        <div key={group.id} className="border border-border rounded-md p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium">{group.name}</p>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => deleteMutation.mutate(group.id)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {group.accountCodes.map(c => accountMap.get(c) || c).join(', ')}
          </p>
        </div>
      ))}

      {creating ? (
        <CreateGroupForm
          accounts={accounts}
          onDone={() => {
            setCreating(false);
            queryClient.invalidateQueries({ queryKey: ['account-groups'] });
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Group
        </Button>
      )}
    </div>
  );
}

function CreateGroupForm({
  accounts, onDone, onCancel,
}: {
  accounts: CashflowAccountInfo[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: () => createAccountGroup(name, Array.from(selected)),
    onSuccess: () => { toast.success('Group created'); onDone(); },
    onError: () => toast.error('Failed to create group'),
  });

  const toggle = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  return (
    <div className="border border-border rounded-md p-3 space-y-3">
      <Input
        placeholder="Group name"
        value={name}
        onChange={e => setName(e.target.value)}
        className="h-8 text-sm"
      />
      <div className="max-h-[200px] overflow-y-auto space-y-1">
        {accounts.map(a => (
          <label key={a.code} className="flex items-center gap-2 py-1 cursor-pointer">
            <Checkbox
              checked={selected.has(a.code)}
              onCheckedChange={() => toggle(a.code)}
            />
            <span className="text-sm truncate">{a.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">{a.code}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => mutation.mutate()} disabled={!name.trim() || selected.size === 0 || mutation.isPending}>
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
