/**
 * Shared constants for the insights and forecast modules.
 *
 * The values below centralize environment configuration, query-builder defaults,
 * and finance field-discovery heuristics so related modules stay aligned.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

// Query builder defaults used by the raw data explorer.
export const QUERY_SINGLE_TABLE = "trusted";
export const QUERY_TABLE_OPTIONS = [
  { value: QUERY_SINGLE_TABLE, label: "trusted (all tables)" },
  { value: "employees", label: "employees (path: trusted/{company_id}/employees)" },
  { value: "transactions", label: "transactions (path: trusted/{company_id}/finance/transactions)" },
  { value: "accounts", label: "accounts (path: trusted/{company_id}/finance/accounts)" }
];

export const QUERY_TABLE_PATH_FILTERS = {
  employees: "trusted/%/employees/",
  transactions: "trusted/%/finance/transactions/",
  accounts: "trusted/%/finance/accounts/"
};

export const QUERY_LIMIT_OPTIONS = ["20", "50", "100", "200"];
export const DEFAULT_QUERY_LIMIT = 20;
export const DEFAULT_QUERY_TABLE = QUERY_SINGLE_TABLE;
export const QUERY_ROW_SQL_PREVIEW_PREFIX = "Generated SQL: ";

// Forecast controls share one default horizon and actual-data window policy.
export const DEFAULT_FORECAST_HORIZON_DAYS = 30;
export const FORECAST_ACTUAL_WINDOW_BY_HORIZON = {
  7: 14,
  30: 30,
  90: 60
};

// Finance row discovery prefers business-facing field names when available.
export const FINANCE_DATE_FIELDS = [
  "transaction_date",
  "event_time",
  "event_timestamp",
  "timestamp",
  "datetime",
  "date",
  "created_at",
  "updated_at"
];

export const FINANCE_AMOUNT_FIELDS = [
  "amount",
  "transaction_amount",
  "value",
  "total",
  "net_amount"
];

export const FINANCE_CATEGORY_FIELDS = ["category", "transaction_type", "type", "entry_type"];

export const FINANCE_VENDOR_FIELDS = [
  "merchant",
  "merchant_name",
  "vendor",
  "vendor_name",
  "supplier",
  "payee",
  "counterparty",
  "description"
];

export const FINANCE_DEPARTMENT_FIELDS = ["department", "dept", "team", "division"];

// Keyword hints let the app classify inflows vs outflows without strict schemas.
export const FINANCE_REVENUE_HINTS = [
  "revenue",
  "income",
  "credit",
  "sale",
  "sales",
  "deposit",
  "inflow",
  "received"
];

export const FINANCE_EXPENDITURE_HINTS = [
  "expense",
  "expenditure",
  "debit",
  "cost",
  "purchase",
  "withdrawal",
  "outflow",
  "payment"
];
