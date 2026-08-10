import type { ActionCore } from '../../src/action/core.js';

export class FakeActionCore implements ActionCore {
    readonly failures: string[] = [];
    readonly infos: string[] = [];
    readonly outputs = new Map<string, unknown>();
    readonly secrets: string[] = [];
    readonly summaries: string[] = [];

    constructor(private readonly inputs: Readonly<Record<string, string>> = {}) {}

    getInput(name: string): string {
        return this.inputs[name] ?? '';
    }

    info(message: string): void {
        this.infos.push(message);
    }

    setFailed(message: string | Error): void {
        this.failures.push(message instanceof Error ? message.message : message);
    }

    async setOutput(name: string, value: unknown): Promise<void> {
        this.outputs.set(name, value);
    }

    setSecret(secret: string): void {
        this.secrets.push(secret);
    }

    async writeSummary(markdown: string): Promise<void> {
        this.summaries.push(markdown);
    }
}
