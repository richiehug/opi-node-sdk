import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseXml } from "./protocol.js";
const queues = new Map();
const safeCode = (value) => value === undefined ? "none" :
    /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : "[redacted]";
/** Bounded asynchronous diagnostics. File and listener failures cannot change terminal outcomes. */
export class DiagnosticLog {
    options;
    path;
    constructor(options) {
        this.options = options;
        this.path = resolve(options.logDirectory ?? join(process.cwd(), "opi-sdk", "logs"), "diagnostics.log");
    }
    write(message) {
        if (this.options.loggingEnabled === false)
            return;
        const previous = queues.get(this.path) ?? Promise.resolve();
        const next = previous.then(async () => {
            const text = message();
            try {
                await mkdir(resolve(this.path, ".."), { recursive: true });
                let data = Buffer.concat([
                    await readFile(this.path).catch(() => Buffer.alloc(0)),
                    Buffer.from(`${new Date().toISOString()} ${text}\n`),
                ]);
                const limit = this.options.maxLogStorageBytes ?? 1024 * 1024;
                if (data.length > limit) {
                    data = data.subarray(data.length - limit);
                    let newline = data.indexOf(10);
                    while (newline >= 0 && !/^\d{4}-\d{2}-\d{2}T/.test(data.subarray(newline + 1, newline + 21).toString()))
                        newline = data.indexOf(10, newline + 1);
                    data = newline < 0 ? Buffer.alloc(0) : data.subarray(newline + 1);
                }
                await writeFile(this.path, data);
            }
            catch { /* Diagnostics are best effort. */ }
            try {
                await this.options.logger?.(text);
            }
            catch { /* Listener failures are isolated. */ }
        }).catch(() => { });
        queues.set(this.path, next);
        void next.then(() => { if (queues.get(this.path) === next)
            queues.delete(this.path); });
    }
    method(operation) {
        return `OpiClient.${operation}(${operation === "payment" ? "request: PaymentRequest" : operation === "refund" ? "request: RefundRequest" : ""})`;
    }
    details(fields) {
        return Object.entries(fields).map(([key, value]) => `${key}=${value ?? "none"}`).join("\n");
    }
    request(p) {
        const o = this.options;
        const details = this.details({
            method: this.method(p.operation), correlationId: p.correlationId, requestId: p.requestId,
            "request.amount": p.amount, "request.currency": safeCode(p.currency),
            "request.reference": p.reference === undefined ? "not supplied" : safeCode(p.reference),
            "request.authReference": p.authReferenceProvided ? "supplied (see extended XML)" : "not supplied",
            "options.terminalHost": /^[A-Za-z0-9.:-]{1,253}$/.test(o.terminalHost) ? o.terminalHost : "[redacted]",
            "options.workstationId": safeCode(o.workstationId),
            "options.payChannelPort": o.payChannelPort ?? 4100,
            "options.deviceChannelPort": o.deviceChannelPort ?? 4102,
            "options.language": o.language ?? "en", "options.forceAcceptance": o.forceAcceptance ?? false,
            "options.requestFullPan": o.requestFullPan ?? "not specified",
            "options.receipts.merchantReceipt": o.receipts?.merchantReceipt ?? "Available",
            "options.receipts.customerReceipt": o.receipts?.customerReceipt ?? "Available",
            "options.connectTimeoutMs": o.connectTimeoutMs ?? 10000,
            "options.operationTimeoutMs": o.operationTimeoutMs ?? 300000,
        });
        this.write(() => `request ${p.operation} ${p.correlationId} amount=${p.amount ?? "none"} currency=${safeCode(p.currency)} minor units\n${details}`);
    }
    response(operation, r) {
        const details = this.details({
            method: this.method(operation), correlationId: r.correlationId,
            "result.status": r.status, "result.errorCode": safeCode(r.errorCode),
            "result.transaction.amount": r.transaction?.amount,
            "result.transaction.currency": safeCode(r.transaction?.currency),
            "result.transaction.reference": safeCode(r.transaction?.reference),
            "result.transaction.authReference": safeCode(r.transaction?.authReference),
            "result.transaction.approvalCode": safeCode(r.transaction?.approvalCode),
            "result.transaction.tip": r.transaction?.tip,
            "result.transaction.paymentMethod": safeCode(r.transaction?.paymentMethod),
            "result.transaction.receipts.merchantReceipt": r.transaction?.receipts?.merchantReceipt ? "returned (content omitted)" : "not returned",
            "result.transaction.receipts.customerReceipt": r.transaction?.receipts?.customerReceipt ? "returned (content omitted)" : "not returned",
        });
        this.write(() => `response ${operation} ${r.correlationId} status=${r.status} amount=${r.transaction?.amount ?? "none"} currency=${safeCode(r.transaction?.currency)} minor units errorCode=${safeCode(r.errorCode)}\n${details}`);
    }
    communication(direction, xml) {
        if (this.options.logLevel !== "extended")
            return;
        this.write(() => `${direction} ${redactedXML(xml)}`);
    }
    async flush() { await queues.get(this.path); }
}
// Match original XML tokens instead of serializing a parsed tree: namespaces, mixed
// content, whitespace, attribute order and CDATA remain intact in the log copy.
const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[\w:.-]+(?:"[^"]*"|'[^']*'|[^'">])*\/?>|[^<]+/g;
const attributes = /([\w:.-]+)(\s*=\s*)(["'])([\s\S]*?)\3/g;
const local = (name) => name.split(":").at(-1).replace(/[-_]/g, "").toLowerCase();
const panFields = new Set(["pan", "cardpan", "cardnumber", "primaryaccountnumber", "applicationpan", "apppan", "maskedpan", "maskedcardnumber"]);
const secretFields = new Set(["track1", "track2", "track3", "trackdata", "track1data", "track2data", "expirydate", "expirationdate", "cardexpirydate", "pin", "pinblock", "cvv", "cvv2", "cvc", "cvc2", "cid", "securitycode", "token", "accesstoken", "authtoken", "password", "apppanenc", "encryptedpan"]);
const textFields = /^(text|textline|receipt|receipttext|display|displaytext|message|merchantreceipt|customerreceipt)$/;
const decode = (s) => s.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos);/gi, (entity, n) => {
    if (n) {
        const c = Number.parseInt(n.startsWith("x") || n.startsWith("X") ? n.slice(1) : n, /^[xX]/.test(n) ? 16 : 10);
        return c <= 0x10ffff ? String.fromCodePoint(c) : entity;
    }
    return { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }[entity] ?? entity;
});
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
function maskPAN(value) {
    const compact = value.trim().replace(/[ -]/g, "");
    if (!compact)
        return value;
    if (/^[0-9Xx*•]{4,19}$/.test(compact) && /[Xx*•]/.test(compact))
        return value;
    if (!/^[0-9]{12,19}$/.test(compact))
        return "[REDACTED]";
    let digit = 0;
    return value.replace(/[0-9]/g, c => { const i = digit++; return i < 6 || i >= compact.length - 4 ? c : "X"; });
}
function luhn(value) {
    let sum = 0, double = false;
    for (const c of [...value].reverse()) {
        let n = Number(c);
        if (double) {
            n *= 2;
            if (n > 9)
                n -= 9;
        }
        sum += n;
        double = !double;
    }
    return sum % 10 === 0;
}
function maskText(value) {
    return value.replace(/(^|[^\w.*•-])([0-9Xx*•](?:[ -]?[0-9Xx*•]){11,})(?![\w.*•-])/g, (whole, prefix, candidate, offset) => {
        if (/[Xx*•]/.test(candidate))
            return whole; // Already masked; never match its exposed prefix/suffix separately.
        const before = value.slice(0, offset + prefix.length).split(/[\r\n]/).at(-1);
        const card = /(?:\bPAN\b|\bcard(?:\s*(?:number|no\.?))?\b|\bKarte\b|\bcarte\b)\s*[:=#-]?\s*$/i.test(before);
        const reference = /\b(?:ref(?:erence)?|transaction|trx|timestamp|date|time|amount|auth(?:orization)?|terminal|workstation|id)\b/i.test(before);
        const digits = candidate.replace(/[ -]/g, "");
        if (!card && (reference || digits.length < 13 || digits.length > 19 || !luhn(digits)))
            return whole;
        return prefix + maskPAN(candidate);
    });
}
function fieldValue(name, raw, cdata = false) {
    const value = cdata ? raw : decode(raw);
    let result = secretFields.has(name) ? (value.trim() ? "[REDACTED]" : value) : panFields.has(name) ? maskPAN(value) : textFields.test(name) ? maskText(value) : value;
    result = result.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
    return result === value ? raw : cdata ? result : escape(result);
}
/** Only the diagnostic copy is changed; useful protocol fields remain verbatim. */
export function redactedXML(xml) {
    try {
        parseXml(xml);
    }
    catch {
        return "[invalid XML omitted]";
    }
    const stack = [];
    return xml.replace(tokens, token => {
        const context = [...stack].reverse().find(n => secretFields.has(n) || panFields.has(n)) ?? [...stack].reverse().find(n => textFields.test(n)) ?? "";
        if (token.startsWith("<![CDATA["))
            return "<![CDATA[" + fieldValue(context, token.slice(9, -3), true) + "]]>";
        if (token.startsWith("<!--"))
            return "<!--" + maskText(token.slice(4, -3)) + "-->";
        if (token.startsWith("<?"))
            return token;
        if (token.startsWith("</")) {
            stack.pop();
            return token;
        }
        if (token.startsWith("<")) {
            const name = local(/^<([\w:.-]+)/.exec(token)[1]);
            const result = token.replace(attributes, (_, key, equal, quote, value) => key + equal + quote + (/^xmlns(?::|$)/.test(key) ? value : fieldValue(local(key), value)) + quote);
            if (!token.endsWith("/>"))
                stack.push(name);
            return result;
        }
        return fieldValue(context, token);
    });
}
