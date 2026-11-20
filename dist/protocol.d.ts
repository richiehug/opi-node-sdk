import type { Operation, OpiOptions, OpiResult, Pending, Receipt, TransactionResult } from "./models.js";
export declare const MAX_FRAME: number;
export declare const types: Record<Operation, string>;
export declare const financial: (op: Operation) => boolean;
/** Service operations whose printer and journal output is returned as service receipts. */
export declare const returnsServiceReceipts: (op: Operation) => boolean;
export interface XmlNode {
    name: string;
    attrs: Record<string, string>;
    text: string;
    children: XmlNode[];
}
export declare function parseXml(xml: string): XmlNode;
export declare function all(n: XmlNode, name: string): XmlNode[];
export declare const first: (n: XmlNode, name: string) => XmlNode;
export declare const value: (n: XmlNode, name: string) => string | undefined;
export declare const escapeXml: (s: unknown) => string;
export declare function digits(currency: string): number;
export declare function major(amount: number, currency: string): string;
export declare function minor(s: string | undefined, c: string | undefined): number | undefined;
export declare function request(o: OpiOptions, p: Pending, authReference?: string): string;
export interface Capture {
    messages: string[];
    receipts: NonNullable<TransactionResult["receipts"]>;
    serviceReceipts: Receipt[];
    journal?: TransactionResult;
    dcc?: TransactionResult["dcc"];
}
export declare const emptyCapture: () => Capture;
export declare function acknowledgement(root: XmlNode, op: Operation): string;
export declare function capture(root: XmlNode, c: Capture, serviceReceiptOperation?: boolean): void;
export declare function result(root: XmlNode, p: Pending, c: Capture, override?: string): OpiResult;
/** Reads identification fields from a GetInfo receipt ("Label:   value" lines). Labels are the
 * terminal's English receipt labels; unknown or translated labels are ignored and the full
 * receipt text remains available in the result's receipts. */
export declare function infoReceiptFields(text: string): Record<string, string>;
/** True when a result carries no terminal information values (empty lists do not count). */
export declare const hasTerminalInfo: (t?: OpiResult["terminal"]) => boolean;
