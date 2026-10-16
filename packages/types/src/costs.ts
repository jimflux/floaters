// Cost estimates remain cash amounts. Schedules are only created by an
// explicit review/save; suggestions never become commitments on their own.
export interface CostRule {
  accountCode: string;
  streamKey: string;
  label: string;
  amount: number;
  frequencyMonths: 1 | 3 | 12;
  startMonth: string;
  endMonth: string | null;
  /** Imported streams explicitly reviewed as the same cost. */
  matchStreamKeys?: string[];
}

export interface CostSettings {
  rules: CostRule[];
  oneOffIds: string[];
  /** Costs no longer expected; recorded cash and bills still count. */
  dismissedStreams?: Pick<CostRule, 'accountCode' | 'streamKey' | 'label'>[];
}

export type CostSettingsChange =
  | { type: 'recurring'; rule: CostRule }
  | { type: 'one_off'; transactionId: string }
  | { type: 'dismissed'; stream: Pick<CostRule, 'accountCode' | 'streamKey' | 'label'> };

export interface CostPayment {
  id: string;
  accountCode: string;
  streamKey: string;
  label: string;
  date: string;
  amount: number;
}

export interface CostSuggestion extends CostRule {
  evidenceCount: number;
  reason: string;
}

export interface CostBreakdown {
  actual: number;
  bills: number;
  recurring: number;
  variable: number;
  adjustment: number;
  method: string;
}

export interface CostForecastReview {
  settings: CostSettings;
  suggestions: CostSuggestion[];
  recentPayments: CostPayment[];
  streams?: { streamKey: string; accountCode: string; label: string }[];
  managedAccountCodes?: string[];
}
