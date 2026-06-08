// Tiny test runner for on-device dev integration tests. NOT shipped in release builds
// (callers are gated by __DEV__).

export type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

export interface TestCase {
    id: string;
    name: string;
    category: 'crypto' | 'database' | 'storage' | 'integration';
    run: () => Promise<void>;
}

export interface TestResult {
    status: TestStatus;
    durationMs?: number;
    error?: string;
}

export function assert(condition: unknown, msg = 'assertion failed'): asserts condition {
    if (!condition) throw new Error(msg);
}

export function assertEq<T>(actual: T, expected: T, msg?: string): void {
    if (actual !== expected) {
        throw new Error(msg || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

export function assertBytesEq(a: Uint8Array, b: Uint8Array, msg?: string): void {
    if (a.length !== b.length) throw new Error(msg || `length mismatch: ${a.length} vs ${b.length}`);
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) throw new Error(msg || `byte mismatch at index ${i}`);
    }
}

export async function assertRejects(fn: () => Promise<unknown>, msg = 'expected rejection'): Promise<void> {
    let threw = false;
    try {
        await fn();
    } catch {
        threw = true;
    }
    if (!threw) throw new Error(msg);
}
