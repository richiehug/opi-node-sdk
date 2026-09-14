# OPI Node.js SDK

A TypeScript SDK for integrating OPI-compatible payment terminals with POS and ECR applications over a network connection to a separate terminal. Applications own their transaction UI.

## Installation

Download the `.tgz` package from the [latest release](https://github.com/richiehug/opi-node-sdk/releases/latest) and install it:

```sh
npm install ./richiehug-opi-*.tgz
```

## Requirements

- Node.js 22+

## Quick start

```typescript
import { OpiClient } from '@richiehug/opi';

const terminal = new OpiClient({
  terminalHost: '192.168.0.69',
  workstationId: 'ECR-01',
  dataDirectory: './private-opi-state',
});

const result = await terminal.payment({ amount: 1250, currency: 'CHF' });
switch (result.status) {
  case 'Success': showSuccess(result); break;
  case 'Declined': showDecline(result.errorCode); break;
  default: showPaymentError(result); break;
}
// When the application has finished using this terminal:
await terminal.dispose();
```

Amounts use the currency's minor unit: `1250` represents CHF 12.50. The `show…` functions belong to your application. Keep one client per terminal, handle thrown errors, and reconcile uncertain outcomes before retrying a payment.

## What the SDK provides

- Take payments, issue refunds and reverse the last eligible transaction.
- Abort an active payment or refund through a separate control connection.
- Run terminal login, activation, information, status, initialization and close-day operations.
- Receive typed results, terminal messages, receipts and DCC details when supplied.
- Return merchant and customer receipts to your application by default, or explicitly request terminal printing.
- Configure English, German, French or Italian terminal language, timeouts and Force Acceptance.
- Read the last terminal message or reprint its receipt through explicit commands.
- Return unknown financial outcomes to the ECR without hidden retries or persistent SDK transaction locks.

## Documentation

- [Integration guide](integration.md)
- [TypeScript API reference](https://richiehug.github.io/opi-node-sdk/)

The reference groups configuration, transaction commands, recovery, terminal operations, results and events. It includes method signatures, option defaults and model fields.

## Network requirements

A provisioned OPI-compatible terminal must be reachable from the application. Commands use TCP 4100 and terminal callbacks use TCP 4102 by default. Configure the terminal's callback address and allow inbound traffic to the application. See the integration guide for platform-specific lifecycle and network setup.

## Support

For help, questions or bug reports, [open an issue on GitHub](https://github.com/richiehug/opi-node-sdk/issues).

## License

See [LICENSE](LICENSE) for commercial application integration and distribution terms. This is not an open-source license.

OPI Node.js SDK is an independent software project created and maintained by [Richard Hug](https://richiehug.com). This SDK is not owned, maintained, supported, warranted or endorsed by payment providers. It follows the OPI protocol specifications.

There is no SLA, guaranteed response or resolution time, release schedule, or commitment to resolve individual issues. Its goal is simple: make the OPI protocol brilliantly straightforward to use from TypeScript.
