import { SaxesParser } from "saxes";
export const MAX_FRAME = 4 * 1024 * 1024;
export const types = {
    payment: "CardPayment",
    refund: "PaymentRefund",
    reversal: "PaymentReversal",
    abort: "AbortRequest",
    reprint: "TicketReprint",
    repeatLastMessage: "RepeatLastMessage",
    activate: "ActivateTerminal",
    deactivate: "DeactivateTerminal",
    info: "GetInfo",
    status: "GetStatus",
    submit: "TransmitTrx",
    close: "CloseDay",
    config: "ContactTMS",
    init: "ContactAcq",
    reset: "RestartTerminal",
    login: "Login",
    logoff: "Logoff",
};
export const financial = (op) => ["payment", "refund", "reversal"].includes(op);
export function parseXml(xml) {
    if (Buffer.byteLength(xml) > MAX_FRAME || /<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new Error("INVALID_XML");
    let root;
    const stack = [];
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
        if (stack.length >= 64)
            throw new Error("XML_DEPTH");
        const n = { name: tag.local, attrs: {}, text: "", children: [] };
        for (const a of Object.values(tag.attributes))
            n.attrs[a.local] = a.value;
        if (stack.length)
            stack.at(-1).children.push(n);
        else
            root = n;
        stack.push(n);
    });
    parser.on("text", (t) => {
        if (stack.length)
            stack.at(-1).text += t;
    });
    parser.on("cdata", (t) => {
        if (stack.length)
            stack.at(-1).text += t;
    });
    parser.on("closetag", () => {
        stack.pop();
    });
    parser.write(xml).close();
    if (!root)
        throw new Error("INVALID_XML");
    return root;
}
export function all(n, name) {
    return [
        ...(n.name === name ? [n] : []),
        ...n.children.flatMap((c) => all(c, name)),
    ];
}
export const first = (n, name) => all(n, name)[0];
export const value = (n, name) => first(n, name)?.text.trim() || undefined;
export const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
})[c]);
export function digits(currency) {
    if (!Intl.supportedValuesOf("currency").includes(currency))
        throw new Error("INVALID_CURRENCY");
    return new Intl.NumberFormat("en", {
        style: "currency",
        currency,
    }).resolvedOptions().maximumFractionDigits;
}
export function major(amount, currency) {
    if (!Number.isSafeInteger(amount) || amount < 0)
        throw new Error("INVALID_AMOUNT");
    const d = digits(currency), s = String(amount).padStart(d + 1, "0");
    return d ? s.slice(0, -d) + "." + s.slice(-d) : s;
}
export function minor(s, c) {
    if (!s || !c || !/^\d+(\.\d+)?$/.test(s))
        return;
    try {
        const d = digits(c), [w, f = ""] = s.split(".");
        if (f.length > d && /[1-9]/.test(f.slice(d)))
            return;
        const n = Number(w + f.slice(0, d).padEnd(d, "0"));
        return Number.isSafeInteger(n) ? n : undefined;
    }
    catch {
        return;
    }
}
export function request(o, p, authReference) {
    const card = financial(p.operation) ||
        ["abort", "reprint", "repeatLastMessage"].includes(p.operation), type = types[p.operation], e = escapeXml;
    const attrs = card
        ? ` RequestTransactionInformation="true" RequestToken="true"${o.requestFullPan === undefined ? "" : ` RequestFullPAN="${o.requestFullPan}"`}${!["reprint", "repeatLastMessage"].includes(p.operation) ? ' RequestReceiptHeader="true"' : ""}${authReference ? ` TrxReferenceNumber="${e(authReference)}"` : ""}`
        : "";
    return `<?xml version="1.0" encoding="utf-8"?><${card ? "CardServiceRequest" : "ServiceRequest"} xmlns="http://www.nrf-arts.org/IXRetail/namespace" WorkstationID="${e(o.workstationId)}" RequestID="${p.requestId}" RequestType="${type}"${p.reference ? ` ReferenceNumber="${e(p.reference)}"` : ""}><POSdata LanguageCode="${o.language ?? "en"}"${attrs}><POSTimeStamp>${new Date().toISOString()}</POSTimeStamp>${card ? `<PrinterStatus>${o.receipts?.customerReceipt ?? "Available"}</PrinterStatus><E-JournalStatus>Available</E-JournalStatus><JournalPrinterStatus>${o.receipts?.merchantReceipt ?? "Available"}</JournalPrinterStatus>${p.operation === "payment" && o.forceAcceptance ? "<ForceAcceptance>true</ForceAcceptance>" : ""}` : ""}</POSdata>${p.amount !== undefined && p.currency ? `<TotalAmount Currency="${p.currency}">${major(p.amount, p.currency)}</TotalAmount>` : ""}</${card ? "CardServiceRequest" : "ServiceRequest"}>`;
}
export const emptyCapture = () => ({ messages: [], receipts: {} });
export function acknowledgement(root, op) {
    if (root.name !== "DeviceRequest")
        throw new Error("INVALID_DEVICE_REQUEST");
    const output = first(root, "Output")?.attrs.OutDeviceTarget, input = first(root, "Input")?.attrs.InDeviceTarget;
    const confirm = !!input &&
        all(root, "Command").some((n) => n.text.trim() === "GetConfirmation") &&
        (op === "reversal" ||
            all(root, "TextLine").some((n) => /receipt|ticket|re[cç]u|quittance|beleg|bon/i.test(n.text)));
    return `<DeviceResponse xmlns="http://www.nrf-arts.org/IXRetail/namespace" WorkstationID="${escapeXml(root.attrs.WorkstationID ?? "")}" RequestID="${escapeXml(root.attrs.RequestID ?? "")}" RequestType="${escapeXml(root.attrs.RequestType ?? "")}" OverallResult="Success"><Output OutDeviceTarget="${escapeXml(output ?? input ?? "CashierDisplay")}" OutResult="Success"/>${input ? `<Input InDeviceTarget="${escapeXml(input)}" InResult="Success"><InputValue>${confirm ? "<InBoolean>true</InBoolean>" : ""}</InputValue></Input>` : ""}</DeviceResponse>`;
}
const mask = (s) => !s
    ? undefined
    : /[*xX•]/.test(s)
        ? s
        : /^[\d -]+$/.test(s)
            ? s.replace(/\D/g, "").replace(/\d(?=\d{4})/g, "*")
            : undefined;
export function capture(root, c) {
    const out = first(root, "Output"), target = out?.attrs.OutDeviceTarget, ticket = out?.attrs.TicketType, lines = all(root, "TextLine").map((n) => n.text.replace(/\r/g, "").trimEnd());
    if (["CashierDisplay", "Display"].includes(target ?? ""))
        c.messages.push(...lines.map((s) => s.trim()).filter(Boolean));
    if (["Printer", "JournalPrinter"].includes(target ?? "") &&
        ticket !== "DccOffer" &&
        lines.join("").trim()) {
        const receipt = {
            content: lines.join("\n").trimEnd(),
            contentType: "text/plain",
        };
        if (ticket === "MerchantReceipt" || target === "JournalPrinter")
            c.receipts.merchantReceipt = receipt;
        else if (!ticket)
            c.receipts.customerReceipt = receipt;
    }
    if (first(root, "TransactionInfo"))
        c.journal = {
            amount: minor(value(root, "TotalAmount") ?? value(root, "DetailedAmount"), first(root, "TotalAmount")?.attrs.Currency),
            currency: first(root, "TotalAmount")?.attrs.Currency,
            paymentMethod: value(root, "CardLabelName"),
            maskedCardNumber: mask(value(root, "CardNumber")),
            authReference: value(root, "TransactionRefNumber") ??
                value(root, "TrxReferenceNumber"),
            approvalCode: value(root, "AuthorisationCode") ?? value(root, "AuthorizationCode"),
            transactionDate: value(root, "DateAndTime"),
            acquirerId: value(root, "AcquirerIdentifier"),
        };
    if (first(root, "DccInfo") || first(root, "DCCInfo"))
        c.dcc = {
            offered: true,
            accepted: true,
            amount: value(root, "CardHolderBillingAmount"),
            currency: value(root, "CardHolderBillingCurrencyName")?.toUpperCase(),
            currencyCode: value(root, "CardHolderBillingCurrencyCode"),
            exchangeRate: value(root, "Exchangerate") ?? value(root, "ExchangeRate"),
            markupPercentage: (value(root, "CommissionPercentage") ?? value(root, "MarkupPercentage"))?.replace(/%$/, ""),
        };
}
export function result(root, p, c, override) {
    if (!["CardServiceResponse", "ServiceResponse"].includes(root.name))
        throw new Error("INVALID_RESPONSE");
    const code = (override ??
        root.attrs.OverallResult ??
        value(root, "OverallResult") ??
        "Unknown").toUpperCase(), diag = first(root, "Diagnosis"), host = value(root, "HostDeclineReason") ?? diag?.attrs.HostDeclineReason, reason = value(root, "TerminalDeclineReason") ?? diag?.attrs.TerminalDeclineReason;
    let status = "TerminalError";
    if ([
        "SUCCESS",
        "ACTIVATED",
        "ALREADYACTIVATED",
        "DEACTIVATED",
        "ALREADYDEACTIVATED",
        "DAYCLOSED",
    ].includes(code))
        status = "Success";
    else if (code === "ABORTED" || (code === "FAILURE" && reason === "107"))
        status = "Aborted";
    else if (code === "BUSY")
        status = "InProgress";
    else if (code === "UNKNOWN")
        status = "Unknown";
    else if (["CONNECTIONERROR", "FLOWTIMEDOUT"].includes(code))
        status = "CommunicationError";
    else if ([
        "FORMATERROR",
        "MISSINGMANDATORYDATA",
        "PARSINGERROR",
        "VALIDATIONERROR",
    ].includes(code))
        status = "InvalidRequest";
    else if (code === "FAILURE" && host && host !== "0")
        status = "Declined";
    const hints = c.messages
        .join(" ")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]|[^a-zA-Z]/g, "")
        .toLowerCase();
    if (code === "FAILURE") {
        if (["activate", "login"].includes(p.operation) &&
            /activationfinished|activationcompleted|alreadyactivated|alreadyactive|aktivierungabgeschlossen|bereitsaktiviert|activationterminee|dejaactive|attivazionecompletata|giaattivo/.test(hints))
            status = "Success";
        if (["deactivate", "logoff"].includes(p.operation) &&
            /deactivationfinished|deactivationcompleted|alreadydeactivated|alreadyinactive|deaktivierungabgeschlossen|bereitsdeaktiviert|desactivationterminee|disattivazionecompletata/.test(hints))
            status = "Success";
        if (financial(p.operation) &&
            /paymentaborted|transactionaborted|paymentcancelled|transactioncancelled|zahlungabgebrochen|transaktionabgebrochen|paiementannule|pagamentoannullato/.test(hints))
            status = "Aborted";
    }
    const r = {
        status,
        correlationId: p.correlationId,
        ...(status === "Success"
            ? {}
            : {
                errorCode: host && host !== "0"
                    ? host
                    : reason && reason !== "0"
                        ? reason
                        : code,
            }),
    };
    const total = first(root, "TotalAmount"), currency = total?.attrs.Currency ?? c.journal?.currency ?? p.currency;
    let amount = minor(total?.text.trim(), currency) ?? c.journal?.amount ?? p.amount;
    if (p.operation === "reversal" &&
        status === "Success" &&
        amount === 0 &&
        c.journal?.currency === currency &&
        (c.journal?.amount ?? 0) > 0)
        amount = c.journal.amount;
    const auth = first(root, "Authorisation");
    if (financial(p.operation) || p.operation === "reprint")
        r.transaction = {
            ...c.journal,
            reference: p.reference ??
                root.attrs.ReferenceNumber ??
                value(root, "ReferenceNumber"),
            amount,
            currency,
            tip: p.operation === "payment" &&
                status === "Success" &&
                currency === p.currency &&
                amount !== undefined &&
                p.amount !== undefined &&
                amount > p.amount
                ? amount - p.amount
                : undefined,
            paymentMethod: normalizePaymentMethod(value(root, "CardCircuit") ?? auth?.attrs.CardCircuit ?? c.journal?.paymentMethod),
            maskedCardNumber: mask(value(root, "MaskedCardNumber") ?? auth?.attrs.MaskedCardNumber) ??
                c.journal?.maskedCardNumber,
            authReference: value(root, "TrxReferenceNumber") ??
                auth?.attrs.TrxReferenceNumber ??
                value(root, "TransactionRefNumber") ??
                c.journal?.authReference,
            approvalCode: value(root, "ApprovalCode") ??
                auth?.attrs.ApprovalCode ??
                c.journal?.approvalCode,
            transactionDate: value(root, "TimeStamp") ??
                auth?.attrs.TimeStamp ??
                c.journal?.transactionDate,
            receipts: c.receipts,
            dcc: c.dcc?.amount &&
                (c.dcc.currency || c.dcc.currencyCode) &&
                (/choose currency|exchange rate|ex\.?\s*rate|wechselkurs|mark-?up/i.test(c.messages.join(" ")) ||
                    new Set([
                        ...c.messages
                            .join(" ")
                            .matchAll(/\b([A-Z]{3})\s+[0-9]+(?:[.,][0-9]+)?\b/g),
                    ].map((m) => m[1])).size >= 2)
                ? c.dcc
                : undefined,
        };
    const terminal = {};
    for (const [k, n] of Object.entries({
        terminalId: "TerminalID",
        terminalIp: "TerminalIP",
        appVersion: "AppVersion",
        merchantId: "Ep2MID",
        status: "TerminalStatus",
        subStatus: "TerminalSubStatus",
        hardware: "Hardware",
        serialNumber: "SerialNumber",
        configurationName: "ConfigurationName",
        configurationVersion: "ConfigurationVersion",
    })) {
        const v = value(root, n) ?? first(root, "Identification")?.attrs[n];
        if (v)
            terminal[k] = v;
    }
    terminal.supportedBrands = all(root, "CardCircuit").map((n) => n.text);
    terminal.initialisedAcquirers = all(root, "Acq").map((n) => n.text);
    r.terminal = terminal;
    return r;
}
const paymentMethodAliases = {
    "VISA": "visa",
    "MASTERCARD": "mastercard",
    "ECMC": "mastercard",
    "MAESTRO": "maestro",
    "MAES": "maestro",
    "VPAY": "vpay",
    "AMEX": "amex",
    "JCB": "jcb",
    "DINERS": "diners",
    "DINC": "diners",
    "DISCOVER": "discover",
    "DISC": "discover",
    "UNIONPAY": "unionpay",
    "UNUP": "unionpay",
    "GIROCARD": "girocard",
    "TWINT": "twint",
    "TWNT": "twint"
};
function normalizePaymentMethod(value) {
    const raw = value?.trim();
    if (!raw)
        return undefined;
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return Object.hasOwn(paymentMethodAliases, code) ? paymentMethodAliases[code] : raw.toLowerCase();
}
