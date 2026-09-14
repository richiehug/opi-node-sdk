/** @module API */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { exchange, TransportError } from "./transport.js";
import { request, result, first, types, digits, financial, } from "./protocol.js";
/** One client per terminal. Retain it until commands complete; abort() is a separate control request. */
/** Retained asynchronous OPI client for a single network terminal.
 * @category Client
 */
export class OpiClient extends EventEmitter {
    options;
    queue = Promise.resolve();
    controls = Promise.resolve();
    disposed = false;
    active;
    sent = false;
    aborts = 0;
    lastAbort = 0;
    activeAbort;
    nextId = Math.floor(Date.now() / 1000) % 2147483646;
    occupied = false;
    /** Create one retained client per terminal with a stable workstation identity.
   * @category Configuration
   */
    constructor(options) {
        super();
        if (!options.terminalHost?.trim() ||
            options.terminalHost !== options.terminalHost.trim() ||
            !/^[-\w]{1,40}$/.test(options.workstationId))
            throw new Error("Invalid terminalHost/workstationId");
        for (const port of [
            options.payChannelPort ?? 4100,
            options.deviceChannelPort ?? 4102,
        ])
            if (!Number.isInteger(port) || port < 1 || port > 65535)
                throw new Error("Invalid port");
        for (const t of [
            options.connectTimeoutMs ?? 10000,
            options.operationTimeoutMs ?? 300000,
            options.abortTimeoutMs ?? 10000,
            options.connectivityLossGracePeriodMs ?? 5000,
        ])
            if (!Number.isFinite(t) || t <= 0 || t > 2147483647)
                throw new Error("Invalid timeout");
        if (!Number.isInteger(options.maxAbortAttempts ?? 3) ||
            (options.maxAbortAttempts ?? 3) < 1 || (options.maxAbortAttempts ?? 3) > 10 ||
            !Number.isFinite(options.abortRetryDelayMs ?? 1500) ||
            (options.abortRetryDelayMs ?? 1500) < 0)
            throw new Error("Invalid abort settings");
        for (const m of Object.values(options.receipts ?? {}))
            if (!["Available", "PrintLocal"].includes(m))
                throw new Error("Invalid receipt mode");
        if (options.language &&
            !["en", "de", "fr", "it"].includes(options.language))
            throw new Error("Invalid language");
        this.options = structuredClone(options);
    }
    notify(e) {
        if (e.kind === "connected" &&
            e.correlationId === this.active?.correlationId)
            this.sent = true;
        setImmediate(() => {
            for (const [name, payload] of [
                ["operationEvent", e],
                ...(e.kind === "terminalMessage"
                    ? [["terminalMessage", e.message]]
                    : [["status", e]]),
            ]) {
                for (const fn of this.rawListeners(name))
                    try {
                        const returned = fn.call(this, payload);
                        if (returned instanceof Promise)
                            returned.catch(() => { });
                    }
                    catch { }
            }
        });
    }
    run(fn) {
        if (this.occupied)
            return Promise.resolve(this.failure(this.pending("payment"), "InvalidRequest", "PENDING_TRANSACTION"));
        this.occupied = true;
        const next = this.queue.then(async () => {
            if (this.disposed)
                throw new Error("Client disposed");
            return fn();
        });
        const finished = next.finally(() => { this.occupied = false; });
        this.queue = finished.catch(() => { });
        return finished;
    }
    pending(operation, r) {
        this.nextId = this.nextId >= 2147483646 ? 1 : this.nextId + 1;
        return {
            ...r,
            operation,
            requestId: String(this.nextId),
            correlationId: randomUUID(),
        };
    }
    failure(p, status, errorCode) {
        return { status, correlationId: p.correlationId, errorCode };
    }
    complete(p, r) {
        this.notify({
            operation: p.operation,
            correlationId: p.correlationId,
            kind: "completed",
            result: r,
        });
        return r;
    }
    valid(r) {
        if (!Number.isSafeInteger(r.amount) || r.amount <= 0)
            throw new Error("Invalid positive minor-unit amount");
        r = { ...r, currency: r.currency.trim().toUpperCase() };
        digits(r.currency);
        if (r.reference && !/^[\w-]{1,20}$/.test(r.reference))
            throw new Error("Invalid reference");
        return r;
    }
    /** Take a payment using a positive amount in currency minor units. Inspect the returned status; an uncertain outcome must be reconciled before retrying.
   * @category Transactions
   */
    payment(r) {
        r = this.valid(r);
        return this.run(() => this.financial(this.pending("payment", r)));
    }
    /** Refund a positive amount in currency minor units. An optional authorization reference identifies the original terminal transaction when required.
   * @category Transactions
   */
    refund(r) {
        const v = this.valid(r);
        if (r.authReference && !/^[\w-]{1,20}$/.test(r.authReference))
            throw new Error("Invalid authorization reference");
        return this.run(() => this.financial(this.pending("refund", v), r.authReference));
    }
    /** Reverse the last eligible terminal transaction. This operation does not accept an arbitrary historical transaction reference.
   * @category Transactions
   */
    reversal() {
        return this.run(() => this.financial(this.pending("reversal")));
    }
    async financial(p, auth) {
        this.active = ["payment", "refund"].includes(p.operation) ? p : undefined;
        this.sent = false;
        this.aborts = 0;
        this.lastAbort = 0;
        this.notify({
            operation: p.operation,
            correlationId: p.correlationId,
            kind: "started",
        });
        let r;
        try {
            const x = await exchange(this.options, request(this.options, p, auth), p, (e) => this.notify(e));
            r = result(x.root, p, x.capture);
            if (["Unknown", "InProgress", "CommunicationError"].includes(r.status))
                r = this.failure(p, "Unknown", "RESULT_UNKNOWN");
        }
        catch (e) {
            r =
                e instanceof TransportError && !e.sent
                    ? this.failure(p, "CommunicationError", "CONNECTION_ERROR")
                    : this.failure(p, "Unknown", "RESULT_UNKNOWN");
        }
        finally {
            this.active = undefined;
            this.sent = false;
            this.activeAbort?.abort();
            await this.controls;
        }
        return this.complete(p, r);
    }
    /** Request the last terminal message; the ECR correlates it with its own transaction state. */
    repeatLastMessage() {
        return this.run(() => this.service("repeatLastMessage"));
    }
    async service(operation) {
        const p = this.pending(operation);
        this.notify({ operation, correlationId: p.correlationId, kind: "started" });
        let r;
        try {
            const x = await exchange(this.options, request(this.options, p), p, (e) => this.notify(e));
            if (operation === "repeatLastMessage" &&
                x.root.attrs.OverallResult === "Success") {
                const h = first(x.root, "OriginalHeader");
                const original = Object.entries(types).find(([, type]) => type === h?.attrs.RequestType)?.[0];
                r =
                    original && financial(original) && h?.attrs.OverallResult
                        ? result(x.root, { ...p, operation: original }, x.capture, h.attrs.OverallResult)
                        : this.failure(p, "Unknown", "NO_ORIGINAL_FINANCIAL_RESULT");
            }
            else
                r = result(x.root, p, x.capture);
        }
        catch (e) {
            r = this.failure(p, "CommunicationError", e instanceof TransportError && !e.sent
                ? "CONNECTION_ERROR"
                : "OPERATION_TIMEOUT");
        }
        return this.complete(p, r);
    }
    /** Send AbortRequest on a separate connection during an active payment or refund. Enable the application abort control after the connected event. An acknowledgement is not the final financial outcome: keep awaiting payment or refund.
   * @category Transactions
   */
    abort() {
        const action = this.controls.then(async () => {
            const p = this.pending("abort");
            if (this.disposed || !this.active || !this.sent)
                return this.failure(p, "InvalidRequest", "NO_ACTIVE_OPERATION");
            if (this.aborts >= (this.options.maxAbortAttempts ?? 3))
                return this.failure(p, "InvalidRequest", "ABORT_LIMIT_REACHED");
            if (Date.now() - this.lastAbort <
                (this.options.abortRetryDelayMs ?? 1500))
                return this.failure(p, "InvalidRequest", "ABORT_RETRY_DELAY");
            this.aborts++;
            this.lastAbort = Date.now();
            const controller = new AbortController();
            this.activeAbort = controller;
            try {
                const x = await exchange(this.options, request(this.options, p), p, (e) => this.notify(e), true, controller.signal);
                return this.complete(p, result(x.root, p, x.capture));
            }
            catch (e) {
                return this.complete(p, e instanceof TransportError && e.sent
                    ? this.failure(p, "Unknown", "ABORT_RESULT_UNKNOWN")
                    : this.failure(p, "CommunicationError", "CONNECTION_ERROR"));
            }
            finally {
                if (this.activeAbort === controller)
                    this.activeAbort = undefined;
            }
        });
        this.controls = action.catch(() => { });
        return action;
    }
    /** Request the last receipt using TicketReprint. Receipt evidence and RepeatLastMessage serve different purposes; correlate the returned receipt with the original transaction.
   * @category Recovery
   */
    reprint() {
        return this.run(() => this.service("reprint"));
    }
    /** Activate the terminal for transaction processing.
   * @category Terminal operations
   */
    activate() {
        return this.run(() => this.service("activate"));
    }
    /** Deactivate terminal transaction processing.
   * @category Terminal operations
   */
    deactivate() {
        return this.run(() => this.service("deactivate"));
    }
    /** Request GetInfo terminal information. A terminal may reject this operation even when GetStatus succeeds; that error is preserved.
   * @category Terminal operations
   */
    info() {
        return this.run(() => this.service("info"));
    }
    /** Request GetStatus to retrieve the current terminal state.
   * @category Terminal operations
   */
    status() {
        return this.run(() => this.service("status"));
    }
    /** Request TransmitTrx to transmit stored terminal transactions.
   * @category Terminal operations
   */
    submit() {
        return this.run(() => this.service("submit"));
    }
    /** Request CloseDay. This closes the terminal day; it does not release the client.
   * @category Terminal operations
   */
    close() {
        return this.run(() => this.service("close"));
    }
    /** Request ContactTMS to refresh terminal configuration.
   * @category Terminal operations
   */
    config() {
        return this.run(() => this.service("config"));
    }
    /** Request ContactAcq to initialize the terminal with its acquirer.
   * @category Terminal operations
   */
    init() {
        return this.run(() => this.service("init"));
    }
    /** Request RestartTerminal. Do not call during an active financial operation.
   * @category Terminal operations
   */
    reset() {
        return this.run(() => this.service("reset"));
    }
    /** Log in the workstation at the terminal.
   * @category Terminal operations
   */
    login() {
        return this.run(() => this.service("login"));
    }
    /** Log off the workstation at the terminal.
   * @category Terminal operations
   */
    logoff() {
        return this.run(() => this.service("logoff"));
    }
    /** Release the client after operations finish. This is not an abort request.
   * @category Lifecycle
   */
    async dispose() {
        if (this.disposed)
            return;
        await this.queue;
        await this.controls;
        this.disposed = true;
    }
}
