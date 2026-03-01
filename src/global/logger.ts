import DeviceInfo from 'react-native-device-info';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    message: string;
}

// --- Ring Buffer ---

const MAX_ENTRIES = 200;
const buffer: (LogEntry | null)[] = new Array(MAX_ENTRIES).fill(null);
let head = 0;
let count = 0;

function addEntry(level: LogLevel, message: string) {
    buffer[head] = { timestamp: Date.now(), level, message };
    head = (head + 1) % MAX_ENTRIES;
    if (count < MAX_ENTRIES) count++;
}

export function getEntries(): LogEntry[] {
    if (count === 0) return [];
    const start = (head - count + MAX_ENTRIES) % MAX_ENTRIES;
    const result: LogEntry[] = [];
    for (let i = 0; i < count; i++) {
        result.push(buffer[(start + i) % MAX_ENTRIES]!);
    }
    return result;
}

export function clearEntries() {
    head = 0;
    count = 0;
}

function formatArgs(args: any[]): string {
    return args
        .map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`;
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        })
        .join(' ');
}

export const logger = {
    debug(...args: any[]) {
        addEntry('debug', formatArgs(args));
        console.debug(...args);
    },
    info(...args: any[]) {
        addEntry('info', formatArgs(args));
        console.log(...args);
    },
    warn(...args: any[]) {
        addEntry('warn', formatArgs(args));
        console.warn(...args);
    },
    error(...args: any[]) {
        addEntry('error', formatArgs(args));
        console.error(...args);
    },
};

// --- Portal trigger ---
let _showPortal: ((title?: string) => void) | null = null;
export function registerPortalCallback(cb: typeof _showPortal) {
    _showPortal = cb;
}

export function showErrorPortal(title?: string) {
    _showPortal?.(title);
}

// --- Formatted export for clipboard ---
export function getFormattedLogs(): string {
    const entries = getEntries();
    const version = DeviceInfo.getVersion();
    const build = DeviceInfo.getBuildNumber();
    const header = `Foxtrot v${version} (${build}) — ${new Date().toISOString()}\n${'—'.repeat(50)}\n`;
    const lines = entries.map(e => {
        const d = new Date(e.timestamp);
        const ts =
            d.getHours().toString().padStart(2, '0') +
            ':' +
            d.getMinutes().toString().padStart(2, '0') +
            ':' +
            d.getSeconds().toString().padStart(2, '0') +
            '.' +
            d.getMilliseconds().toString().padStart(3, '0');
        return `[${ts}] [${e.level.toUpperCase().padEnd(5)}] ${e.message}`;
    });
    return header + lines.join('\n');
}
