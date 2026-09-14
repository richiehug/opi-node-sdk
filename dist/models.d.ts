/** Supported OPI transaction and terminal operation names.
 * @category Events
 */
export type Operation = "payment" | "refund" | "reversal" | "abort" | "reprint" | "repeatLastMessage" | "activate" | "deactivate" | "info" | "status" | "submit" | "close" | "config" | "init" | "reset" | "login" | "logoff";
/** Operation outcomes. Success is confirmed approval; Declined is a decline; Aborted is cancellation. Unknown/InProgress require reconciliation rather than an automatic new payment.
 * @category Results
 */
export type ResultState = "Success" | "Declined" | "Aborted" | "CommunicationError" | "TerminalError" | "InvalidRequest" | "InProgress" | "Unknown";
/** Available returns receipt data, PrintLocal requests terminal printing.
 * @category Configuration
 */
export type ReceiptHandlingMode = "Available" | "PrintLocal";
/** Positive payment/refund amount in currency minor units, currency and optional reference.
 * @category Requests
 */
export interface PaymentRequest {
    /** Positive amount in currency minor units; CHF 12.50 is 1250. */
    amount: number;
    /** ISO 4217 currency code, for example CHF. */
    currency: string;
    /** Optional application or terminal transaction reference. */
    reference?: string;
}
/** Refund request with an optional original authorization reference.
 * @category Requests
 */
export interface RefundRequest extends PaymentRequest {
    /** Terminal authorization/transaction reference; not the application correlation ID. */
    authReference?: string;
}
/** Receipt copy returned to the application.
 * @category Receipts and DCC
 */
export interface Receipt {
    /** Receipt text. Preserve whitespace and use a monospace font when displaying or printing. */
    content: string;
    /** Receipt media type: text/plain. */
    contentType: "text/plain";
}
/** Dynamic Currency Conversion offer/result details when returned by the terminal.
 * @category Receipts and DCC
 */
export interface DccDetails {
    /** Whether a DCC offer was observed. */
    offered: boolean;
    /** Whether acceptance is established from returned DCC data and the observed offer. */
    accepted: boolean;
    /** Terminal-provided DCC amount as decimal text. */
    amount?: string;
    /** ISO 4217 currency code, for example CHF. */
    currency?: string;
    /** Terminal-provided currency code for DCC. */
    currencyCode?: string;
    /** Terminal-provided DCC exchange rate as text. */
    exchangeRate?: string;
    /** Terminal-provided DCC markup percentage as text. */
    markupPercentage?: string;
}
/** Terminal-supplied financial, card, receipt and DCC details.
 * @category Results
 */
export interface TransactionResult {
    /** Optional application or terminal transaction reference. */
    reference?: string;
    /** Terminal-supplied amount in currency minor units. */
    amount?: number;
    /** ISO 4217 currency code, for example CHF. */
    currency?: string;
    /** Tip in currency minor units when supplied. */
    tip?: number;
    /** Terminal-supplied payment method or card brand. */
    /** Normalized lowercase brand; unknown values are trimmed and lowercased. */
    paymentMethod?: string;
    /** Masked card number when supplied by the terminal. */
    maskedCardNumber?: string;
    /** Terminal authorization/transaction reference; not the application correlation ID. */
    authReference?: string;
    /** Authorization approval code supplied by the terminal. */
    approvalCode?: string;
    /** Terminal-supplied transaction timestamp. */
    transactionDate?: string;
    /** Acquirer identifier supplied by the terminal. */
    acquirerId?: string;
    /** Merchant and customer receipt copies. Options default to Available for both; results may omit copies not supplied by the terminal. */
    receipts?: {
        merchantReceipt?: Receipt;
        customerReceipt?: Receipt;
    };
    /** Dynamic Currency Conversion information when supplied. */
    dcc?: DccDetails;
}
/** Structured outcome of a terminal operation. Optional fields are populated only when supplied.
 * @category Results
 */
export interface OpiResult {
    /** Structured operation outcome. Unknown is unresolved, not a decline; reconcile before retrying. */
    status: ResultState;
    /** SDK tracking identifier linking events and results for the same logical operation. */
    correlationId: string;
    /** Terminal or SDK error code when available. Preserve it for diagnosis and reconciliation. */
    errorCode?: string;
    /** Financial details when provided by the terminal. */
    transaction?: TransactionResult;
    /** Terminal information/status fields when supplied. */
    terminal?: Record<string, string | string[]>;
}
/** Lifecycle and terminal data for one correlated operation.
 * @category Events
 */
export interface OperationEvent {
    /** The logical operation associated with this event. */
    operation: Operation;
    /** SDK tracking identifier linking events and results for the same logical operation. */
    correlationId: string;
    /** Event lifecycle stage; connected enables abort, recoveryStarted disables it, completed supplies the outcome. */
    kind: "started" | "connected" | "terminalMessage" | "receiptCaptured" | "dccCaptured" | "recoveryStarted" | "recoveryCompleted" | "transactionRecovered" | "completed";
    /** Terminal display text when supplied. The application chooses whether and where to show it. */
    message?: string;
    /** Captured receipt copy. */
    receipt?: Receipt;
    /** Identifies the merchant or customer receipt. */
    receiptType?: "merchant" | "customer";
    /** Completed or recovered result. Update the original transaction identified by correlationId. */
    result?: OpiResult;
}
/** Connection, protocol, receipt and recovery configuration for one terminal.
 * @category Configuration
 */
export interface OpiOptions {
    /** Terminal IPv4 address or resolvable host name. Configure explicitly. */
    terminalHost: string;
    /** Stable ECR identity: 1–40 letters, digits, underscores or hyphens. */
    workstationId: string;
    /** Terminal command TCP port. Default: 4100. */
    payChannelPort?: number;
    /** Inbound terminal callback TCP port. Default: 4102. */
    deviceChannelPort?: number;
    /** Terminal language: en, de, fr or it. Default: en. This does not localize application UI. */
    language?: "en" | "de" | "fr" | "it";
    /** Merchant and customer receipt copies. Options default to Available for both; results may omit copies not supplied by the terminal. */
    receipts?: {
        merchantReceipt?: ReceiptHandlingMode;
        customerReceipt?: ReceiptHandlingMode;
    };
    /** Request Force Acceptance for payment when supported by the terminal. Default: false. */
    forceAcceptance?: boolean;
    /** Optional protocol RequestFullPAN flag. Omitted by default. The structured card-number result remains masked. */
    requestFullPan?: boolean;
    /** Connection deadline in milliseconds. Default: 10000. */
    connectTimeoutMs?: number;
    /** Exchange deadline in milliseconds. Default: 300000. */
    operationTimeoutMs?: number;
    /** Independent abort exchange deadline in milliseconds, capped by operationTimeoutMs. Default: 10000. */
    abortTimeoutMs?: number;
    /** Grace period for loss of the local network address used by the terminal connection. Default: 5000 ms. Silent remote outages still depend on TCP detection or the exchange deadline. */
    connectivityLossGracePeriodMs?: number;
    /** Maximum abort attempts for one active transaction. Default: 3. */
    maxAbortAttempts?: number;
    /** Minimum delay between abort attempts in milliseconds. Default: 1500. */
    abortRetryDelayMs?: number;
}
/** @internal */
export interface Pending extends Partial<PaymentRequest> {
    /** The logical operation associated with this event. */
    operation: Operation;
    /** SDK tracking identifier linking events and results for the same logical operation. */
    correlationId: string;
    requestId: string;
}
