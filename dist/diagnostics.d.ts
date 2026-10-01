import type { OpiOptions, OpiResult, Pending, Operation } from "./models.js";
/** Bounded asynchronous diagnostics. File and listener failures cannot change terminal outcomes. */
export declare class DiagnosticLog {
    private readonly options;
    private readonly path;
    constructor(options: OpiOptions);
    private write;
    private method;
    private details;
    request(p: Pending): void;
    response(operation: Operation, r: OpiResult): void;
    communication(direction: string, xml: string): void;
    flush(): Promise<void>;
}
/** Only the diagnostic copy is changed; useful protocol fields remain verbatim. */
export declare function redactedXML(xml: string): string;
