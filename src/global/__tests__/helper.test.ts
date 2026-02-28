import { humanTime, milliseconds } from '../helper';

describe('humanTime', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should return null for falsy input', () => {
        expect(humanTime('')).toBeNull();
        expect(humanTime(0)).toBeNull();
        expect(humanTime(null as any)).toBeNull();
        expect(humanTime(undefined as any)).toBeNull();
    });

    it('should return "just now" for less than a minute ago', () => {
        const thirtySecondsAgo = Date.now() - 30 * milliseconds.second;
        expect(humanTime(thirtySecondsAgo)).toBe('just now');
        expect(humanTime(new Date(thirtySecondsAgo).toISOString())).toBe('just now');
    });

    it('should return minutes ago', () => {
        const fiveMinutesAgo = Date.now() - 5 * milliseconds.minute;
        expect(humanTime(fiveMinutesAgo)).toBe('5 m ago');
    });

    it('should round minutes', () => {
        const ninetySeconds = Date.now() - 90 * milliseconds.second;
        expect(humanTime(ninetySeconds)).toBe('2 m ago');
    });

    it('should return hours ago', () => {
        const threeHoursAgo = Date.now() - 3 * milliseconds.hour;
        expect(humanTime(threeHoursAgo)).toBe('3 h ago');
    });

    it('should return localized date string for more than a day ago', () => {
        const twoDaysAgo = Date.now() - 2 * milliseconds.day;
        const result = humanTime(twoDaysAgo);
        // Should be a date string, not a relative time
        expect(result).not.toContain('ago');
        expect(result).not.toContain('just now');
    });

    it('should handle Date objects', () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * milliseconds.minute);
        expect(humanTime(fiveMinutesAgo)).toBe('5 m ago');
    });

    it('should handle ISO string input', () => {
        const tenMinutesAgo = new Date(Date.now() - 10 * milliseconds.minute).toISOString();
        expect(humanTime(tenMinutesAgo)).toBe('10 m ago');
    });

    it('should return "just now" at the boundary (just under 1 minute)', () => {
        const justUnderOneMinute = Date.now() - (milliseconds.minute - milliseconds.second);
        expect(humanTime(justUnderOneMinute)).toBe('just now');
    });

    it('should return minutes at exactly 1 minute', () => {
        const exactlyOneMinute = Date.now() - milliseconds.minute;
        expect(humanTime(exactlyOneMinute)).toBe('1 m ago');
    });
});
