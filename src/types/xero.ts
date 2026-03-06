export interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

export interface XeroConnection {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}

export interface XeroInvoice {
  InvoiceID: string;
  Type: "ACCREC" | "ACCPAY";
  Contact: { ContactID: string; Name: string };
  Status: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "PAID" | "VOIDED" | "DELETED";
  CurrencyCode: string;
  Total: number;
  AmountDue: number;
  AmountPaid: number;
  Date: string;
  DueDate: string;
  FullyPaidOnDate?: string;
  UpdatedDateUTC: string;
  LineItems?: XeroLineItem[];
}

export interface XeroLineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
  TaxType: string;
  LineAmount: number;
}

export interface XeroBankTransaction {
  BankTransactionID: string;
  Type: "RECEIVE" | "SPEND" | "RECEIVE-OVERPAYMENT" | "RECEIVE-PREPAYMENT" | "SPEND-OVERPAYMENT" | "SPEND-PREPAYMENT";
  Contact?: { ContactID: string; Name: string };
  BankAccount: { AccountID: string; Code: string; Name: string };
  Total: number;
  Date: string;
  Status: string;
  IsReconciled: boolean;
  UpdatedDateUTC: string;
  LineItems?: XeroLineItem[];
}

export interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Class: string;
  Status: string;
  BankAccountType?: string;
}

export interface XeroPaginatedResponse<T> {
  [key: string]: T[] | unknown;
}

export interface XeroBalanceDetail {
  AccountID: string;
  Balance: number;
}
