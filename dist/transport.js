import net from "node:net";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { performance } from "node:perf_hooks";
import { MAX_FRAME, parseXml, acknowledgement, capture, emptyCapture, } from "./protocol.js";
export class TransportError extends Error {
    sent;
    constructor(message, sent) {
        super(message);
        this.sent = sent;
    }
}
export function frame(xml) {
    const body = Buffer.from(xml);
    if (!body.length || body.length > MAX_FRAME)
        throw new Error("INVALID_FRAME");
    const b = Buffer.allocUnsafe(4 + body.length);
    b.writeUInt32BE(body.length);
    body.copy(b, 4);
    return b;
}
export class Frames {
    buffer = Buffer.alloc(0);
    push(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const frames = [];
        while (this.buffer.length >= 4) {
            const n = this.buffer.readUInt32BE();
            if (n < 1 || n > MAX_FRAME)
                throw new Error("INVALID_FRAME");
            if (this.buffer.length < n + 4)
                break;
            frames.push(new TextDecoder("utf-8", { fatal: true }).decode(this.buffer.subarray(4, n + 4)));
            this.buffer = this.buffer.subarray(n + 4);
        }
        return frames;
    }
}
export function hasLocalAddress(address, interfaces = networkInterfaces()) {
    return Object.values(interfaces).some((entries) => entries?.some((entry) => entry.address === address));
}
export async function exchange(o, xml, p, emit, control = false, signal) {
    let sent = false;
    let finished = false;
    const peers = new Set();
    let server;
    const socket = new net.Socket();
    const c = emptyCapture();
    let timer;
    let connectTimer;
    let networkTimer;
    let cancelled;
    try {
        return await new Promise((resolve, reject) => {
            const fail = (e) => {
                if (!finished) {
                    finished = true;
                    reject(new TransportError(e instanceof Error ? e.message : String(e), sent));
                }
            };
            cancelled = () => fail(new Error("EXCHANGE_CANCELLED"));
            signal?.addEventListener("abort", cancelled, { once: true });
            if (signal?.aborted) {
                cancelled();
                return;
            }
            timer = setTimeout(() => fail(new Error("OPERATION_TIMEOUT")), control
                ? Math.min(o.operationTimeoutMs ?? 300000, o.abortTimeoutMs ?? 10000)
                : o.operationTimeoutMs ?? 300000);
            void (async () => {
                const { address } = await lookup(o.terminalHost, { family: 4 });
                if (finished)
                    return;
                if (!control) {
                    server = net.createServer((peer) => {
                        if (peers.size >= 32 ||
                            peer.remoteAddress?.replace(/^::ffff:/, "") !== address) {
                            peer.destroy();
                            return;
                        }
                        peers.add(peer);
                        peer.setNoDelay(true);
                        peer.setTimeout(o.operationTimeoutMs ?? 300000, () => peer.destroy());
                        peer.on("close", () => peers.delete(peer));
                        peer.on("error", () => { });
                        const decoder = new Frames();
                        peer.on("data", (chunk) => {
                            try {
                                for (const text of decoder.push(chunk)) {
                                    const root = parseXml(text);
                                    peer.write(frame(acknowledgement(root, p.operation)));
                                    const before = c.messages.length, previous = { ...c.receipts }, dcc = c.dcc;
                                    capture(root, c);
                                    // ACK is queued before application listeners. Consumers must keep the Node event loop responsive.
                                    for (const message of c.messages.slice(before))
                                        emit({
                                            operation: p.operation,
                                            correlationId: p.correlationId,
                                            kind: "terminalMessage",
                                            message,
                                        });
                                    for (const [key, type] of [
                                        ["merchantReceipt", "merchant"],
                                        ["customerReceipt", "customer"],
                                    ])
                                        if (c.receipts[key] !== previous[key])
                                            emit({
                                                operation: p.operation,
                                                correlationId: p.correlationId,
                                                kind: "receiptCaptured",
                                                receipt: c.receipts[key],
                                                receiptType: type,
                                            });
                                    if (c.dcc !== dcc)
                                        emit({
                                            operation: p.operation,
                                            correlationId: p.correlationId,
                                            kind: "dccCaptured",
                                        });
                                }
                            }
                            catch {
                                peer.destroy();
                            }
                        });
                    });
                    await new Promise((r, j) => {
                        server.once("error", j);
                        server.listen(o.deviceChannelPort ?? 4102, "0.0.0.0", () => {
                            server.removeListener("error", j);
                            server.on("error", fail);
                            r();
                        });
                    });
                }
                if (finished) {
                    if (server?.listening)
                        server.close();
                    return;
                }
                const decoder = new Frames();
                socket.setNoDelay(true);
                socket.setKeepAlive(true, 5000);
                socket.on("error", fail);
                socket.on("end", () => fail(new Error("CONNECTION_CLOSED")));
                socket.on("close", () => fail(new Error("CONNECTION_CLOSED")));
                socket.on("data", (chunk) => {
                    try {
                        const items = decoder.push(chunk);
                        if (items.length && !finished) {
                            const root = parseXml(items[0]);
                            finished = true;
                            resolve({ root, capture: c });
                        }
                    }
                    catch (e) {
                        fail(e);
                    }
                });
                connectTimer = setTimeout(() => fail(new Error("CONNECT_TIMEOUT")), o.connectTimeoutMs ?? 10000);
                socket.connect(o.payChannelPort ?? 4100, address, () => {
                    if (finished)
                        return;
                    clearTimeout(connectTimer);
                    const localAddress = socket.localAddress;
                    let unavailableSince;
                    if (localAddress)
                        networkTimer = setInterval(() => {
                            try {
                                if (hasLocalAddress(localAddress))
                                    unavailableSince = undefined;
                                else {
                                    unavailableSince ??= performance.now();
                                    if (performance.now() - unavailableSince >= (o.connectivityLossGracePeriodMs ?? 5000))
                                        fail(new Error("NETWORK_LOST"));
                                }
                            }
                            catch { /* Socket I/O and the exchange deadline remain authoritative. */ }
                        }, 250);
                    sent = true;
                    socket.write(frame(xml));
                    emit({
                        operation: p.operation,
                        correlationId: p.correlationId,
                        kind: "connected",
                    });
                });
            })().catch(fail);
        });
    }
    finally {
        clearTimeout(timer);
        clearTimeout(connectTimer);
        clearInterval(networkTimer);
        if (cancelled)
            signal?.removeEventListener("abort", cancelled);
        socket.destroy();
        for (const peer of peers)
            peer.destroy();
        if (server?.listening)
            await new Promise((r) => server.close(() => r()));
    }
}
