import type { Operation, OpiOptions, OpiResult, Pending, TransactionResult } from "./models.js";
export declare const MAX_FRAME: number;
export declare const types: Record<Operation, string>;
export declare const financial: (op: Operation) => boolean;
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
    journal?: TransactionResult;
    dcc?: TransactionResult["dcc"];
}
export declare const emptyCapture: () => Capture;
export declare function acknowledgement(root: XmlNode, op: Operation): string;
export declare function capture(root: XmlNode, c: Capture): void;
export declare function result(root: XmlNode, p: Pending, c: Capture, override?: string): OpiResult;
