/** @module API */
import { EventEmitter } from "node:events";
import type { OpiOptions, OpiResult, PaymentRequest, RefundRequest, OperationEvent } from "./models.js";
export type * from "./models.js";
/** One client per terminal. Retain it until commands complete; abort() is a separate control request. */
/** Retained asynchronous OPI client for a single network terminal.
 * @category Client
 */
export declare class OpiClient extends EventEmitter<{
    operationEvent: [OperationEvent];
    terminalMessage: [string];
    /** Structured operation outcome. Unknown is unresolved, not a decline; reconcile before retrying. */
    status: [OperationEvent];
}> {
    private readonly options;
    private queue;
    private controls;
    private disposed;
    private active?;
    private sent;
    private aborts;
    private lastAbort;
    private activeAbort?;
    private nextId;
    private occupied;
    /** Create one retained client per terminal with a stable workstation identity.
   * @category Configuration
   */
    constructor(options: OpiOptions);
    private notify;
    private run;
    private pending;
    private failure;
    private complete;
    private valid;
    /** Take a payment using a positive amount in currency minor units. Inspect the returned status; an uncertain outcome must be reconciled before retrying.
   * @category Transactions
   */
    payment(r: PaymentRequest): Promise<OpiResult>;
    /** Refund a positive amount in currency minor units. An optional authorization reference identifies the original terminal transaction when required.
   * @category Transactions
   */
    refund(r: RefundRequest): Promise<OpiResult>;
    /** Reverse the last eligible terminal transaction. This operation does not accept an arbitrary historical transaction reference.
   * @category Transactions
   */
    reversal(): Promise<OpiResult>;
    private financial;
    /** Request the last terminal message; the ECR correlates it with its own transaction state. */
    repeatLastMessage(): Promise<OpiResult>;
    private service;
    /** Send AbortRequest on a separate connection during an active payment or refund. Enable the application abort control after the connected event. An acknowledgement is not the final financial outcome: keep awaiting payment or refund.
   * @category Transactions
   */
    abort(): Promise<OpiResult>;
    /** Request the last receipt using TicketReprint. Receipt evidence and RepeatLastMessage serve different purposes; correlate the returned receipt with the original transaction.
   * @category Recovery
   */
    reprint(): Promise<OpiResult>;
    /** Activate the terminal for transaction processing.
   * @category Terminal operations
   */
    activate(): Promise<OpiResult>;
    /** Deactivate terminal transaction processing.
   * @category Terminal operations
   */
    deactivate(): Promise<OpiResult>;
    /** Request GetInfo terminal information. A terminal may reject this operation even when GetStatus succeeds; that error is preserved.
   * @category Terminal operations
   */
    info(): Promise<OpiResult>;
    /** Request GetStatus to retrieve the current terminal state.
   * @category Terminal operations
   */
    status(): Promise<OpiResult>;
    /** Request TransmitTrx to transmit stored terminal transactions.
   * @category Terminal operations
   */
    submit(): Promise<OpiResult>;
    /** Request CloseDay. This closes the terminal day; it does not release the client.
   * @category Terminal operations
   */
    close(): Promise<OpiResult>;
    /** Request ContactTMS to refresh terminal configuration.
   * @category Terminal operations
   */
    config(): Promise<OpiResult>;
    /** Request ContactAcq to initialize the terminal with its acquirer.
   * @category Terminal operations
   */
    init(): Promise<OpiResult>;
    /** Request RestartTerminal. Do not call during an active financial operation.
   * @category Terminal operations
   */
    reset(): Promise<OpiResult>;
    /** Log in the workstation at the terminal.
   * @category Terminal operations
   */
    login(): Promise<OpiResult>;
    /** Log off the workstation at the terminal.
   * @category Terminal operations
   */
    logoff(): Promise<OpiResult>;
    /** Release the client after operations finish. This is not an abort request.
   * @category Lifecycle
   */
    dispose(): Promise<void>;
}
