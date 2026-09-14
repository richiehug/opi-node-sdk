# Integrating the OPI Node.js SDK

Install the local `.tgz` as shown in the README. TypeScript compilation is not needed in the consuming application. Keep one client per terminal and persist sale intent, results and receipts in your application. Separate ECR instances must not control the same terminal concurrently.

## Configure the client

```typescript
const terminal = new OpiClient({
  terminalHost: '192.168.0.69',
  workstationId: 'ECR-01',
  payChannelPort: 4100,
  deviceChannelPort: 4102,
  language: 'en',
  receipts: { merchantReceipt: 'Available', customerReceipt: 'Available' },
  forceAcceptance: false,
  connectTimeoutMs: 10000,
  operationTimeoutMs: 300000,
  abortTimeoutMs: 10000,
  connectivityLossGracePeriodMs: 5000,
});
```

The language setting controls terminal requests, not your application's labels. Use Node.js directly or Electron's main process; web browsers do not provide the raw TCP listener required by OPI.

## Network and lifecycle

The terminal receives commands on `payChannelPort` (4100) and connects back to the application on `deviceChannelPort` (4102). Configure the terminal's ECR callback IP and allow inbound TCP on that port. Run on the same reachable network; no HTTP proxy is used. The callback listener accepts only the configured terminal's resolved IPv4 address. Keep the Node process running while an operation is active. Do not block the event loop: perform CPU-heavy work in workers and return promptly from event listeners. Callback acknowledgements are queued before events; synchronous blocking JavaScript can still delay all network I/O.

Call `dispose()` after operations have completed. `close()` means terminal close-day, not disposal. The ECR must persist its own sale intent and reconcile an interrupted operation.

Socket closure fails promptly. Loss of the connected local network address ends the exchange after `connectivityLossGracePeriodMs` (5 seconds by default), even if a different adapter remains connected. TCP keepalive is enabled; a silent remote outage may still take longer to detect, up to `operationTimeoutMs`. There is no immediate guarantee when the OS continues to report a viable connection. A valid final approval arriving before the exchange ends remains `Success`, even after a temporary outage. If transmission may have occurred and the final result is lost, the outcome is `Unknown`, never an inferred decline.

## Commands

All commands return `Promise<OpiResult>` and overlapping commands return `PENDING_TRANSACTION`:

- `payment({ amount, currency, reference? })`
- `refund({ amount, currency, authReference? })`
- `reversal()` reverses the last eligible transaction, without accepting an older reference.
- `abort()` sends a separate control request during payment/refund.
- `reprint()` requests the last ticket; `repeatLastMessage()` requests the last response.
- `login()`, `logoff()`, `activate()`, `deactivate()`, `info()`, `status()`.
- `init()`, `config()`, `submit()`, `close()`, `reset()`.

Amounts are positive integer minor units. CHF 10.00 is `1000`. Invalid options/arguments throw; terminal outcomes use `result.status` and `errorCode`. Handle thrown errors too, and never infer a declined transaction from an interrupted local call.

## Events and abort

```typescript
terminal.on('operationEvent', event => {
  if (event.kind === 'terminalMessage') updatePaymentText(event.message);
  if (event.kind === 'receiptCaptured') storeReceipt(event.receiptType, event.receipt);
});
const payment = terminal.payment({ amount: 1000, currency: 'CHF' });
// From your abort button, while payment is active:
// await terminal.abort();
const finalResult = await payment;
```

`terminalMessage` is a convenience event with a string payload. `status` carries other operation events. An abort acknowledgement is not the original payment result: keep awaiting the payment. Listener errors are isolated from payment processing. UI is never part of the SDK.

Abort has its own 10-second deadline (`abortTimeoutMs`, capped by the exchange deadline). The SDK closes an outstanding abort wait when the original transaction finishes, so it cannot hold the final result open. A lost abort response returns `Unknown` / `ABORT_RESULT_UNKNOWN` if the request may have reached the terminal. It does not establish cancellation. Dismiss progress from the original operation's completion and keep its result visible.

## Receipts and DCC

Both copies default to `Available`, returning receipt text to the app. Set `receipts: { merchantReceipt: 'PrintLocal', customerReceipt: 'PrintLocal' }` only when terminal printing is intended and supported. The E-journal remains Available. Render receipt text with a monospace font and preserve whitespace. Copies may be absent.

`result.transaction` contains amount, currency, optional tip, card method, masked card number, authorization information, receipts and DCC details when supplied. The successful reversal zero-amount fallback uses only a positive journal amount in the same currency from that exchange. An explicit nonzero amount is preserved. No amount or receipt alone changes the final terminal outcome.

## Transaction state and reconciliation

**SDK owns OPI communication; ECR owns transaction state and reconciliation.**

The SDK keeps no persistent transaction ledger or cross-restart transaction lock. An overlapping operation is rejected with `PENDING_TRANSACTION` while an exchange is active. Save the sale intent, terminal identity, result and receipts in your ECR.

`payment()` → `PRINTLASTTICKET` → ECR decides → `reprint()` if required → ECR explicitly starts a new payment.

`PRINTLASTTICKET` is returned unchanged. The SDK does not reprint, reconcile an older sale, check readiness, or retry the new payment automatically. A successful reprint does not start another payment.

If a financial request may have been sent but its final response is lost or unusable, the SDK returns `UNKNOWN` / `RESULT_UNKNOWN`. This is neither approval nor proof of failure. Keep the sale unresolved and **do not blindly retry**: reconcile using the terminal/acquirer records and any explicitly requested evidence. A connection failure before transmission returns a communication/connection error. A definitive terminal response preserves its outcome and error code.

`repeatLastMessage()` explicitly requests the terminal's last registered message. `reprint()` explicitly requests its last receipt and available transaction details using the configured receipt handling. These are distinct commands; neither calls the other. The ECR must correlate their evidence with its own sale, especially if another ECR has used the terminal. Neither command updates an SDK ledger.

An `AbortRequest` acknowledgement does not prove that a financial transaction was cancelled. Keep awaiting the original financial result. If that response is lost, its outcome remains unknown; do not infer cancellation from an abort acknowledgement or closed socket.

## Interpreting results

| Outcome | Application action |
| --- | --- |
| Success | Complete the sale and retain its transaction details. |
| Declined | Show the decline and preserve the error code. |
| Aborted | Show cancellation after the original financial operation completes. |
| Unknown / InProgress | Keep an uncertain record and reconcile; do not blindly retry payment. |
| CommunicationError / TerminalError | Preserve the result and error code; inspect transaction/recovery context. |
| InvalidRequest or thrown validation/storage error | Correct the local setup or request. Do not infer a terminal decline from an exception. |

Optional card, receipt and DCC fields are absent when the terminal does not provide them. Do not fill missing data from another transaction. An abort acknowledgement or receipt alone does not override the original financial result.

### Payment method normalization

`transaction.paymentMethod` uses the same lowercase brand identifiers as the Android and .NET SDKs: `visa`, `mastercard`, `maestro`, `vpay`, `amex`, `jcb`, `diners`, `discover`, `unionpay`, `girocard`, and `twint`. Terminal aliases such as `ECMC`, `MAES`, `DINC`, `DISC`, `UNUP`, and `TWNT` map to these identifiers. Case, punctuation and surrounding whitespace are ignored when recognizing known brands. Blank values are absent; unknown brands retain their trimmed text in lowercase. This applies to the final response and callback-derived transaction information. Display names and logos remain application-owned.
