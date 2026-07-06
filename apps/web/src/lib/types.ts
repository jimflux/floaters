// Re-export the shared API contract from the monorepo types package so the
// web and API can never drift. Keep importing from '@/lib/types' as before.
export type {
  CashflowAccount,
  CashflowAccountInfo,
  CashflowData,
  CashflowResponse,
  IncomeClient,
  IncomeSection,
  PipelineResponse,
  PipelineProjection,
  PipelineInvoice,
  AccountGroup,
  ProjectionOverride,
  ProjectionOverridesResponse,
} from "@floaters/types";
