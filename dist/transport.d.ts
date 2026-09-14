import { type NetworkInterfaceInfo } from "node:os";
import type { OpiOptions, Pending, OperationEvent } from "./models.js";
import { type Capture, type XmlNode } from "./protocol.js";
export declare class TransportError extends Error {
    readonly sent: boolean;
    constructor(message: string, sent: boolean);
}
export declare function frame(xml: string): Buffer;
export declare class Frames {
    private buffer;
    push(chunk: Buffer): string[];
}
export interface Exchange {
    root: XmlNode;
    capture: Capture;
}
export declare function hasLocalAddress(address: string, interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): boolean;
export declare function exchange(o: OpiOptions, xml: string, p: Pending, emit: (e: OperationEvent) => void, control?: boolean, signal?: AbortSignal): Promise<Exchange>;
