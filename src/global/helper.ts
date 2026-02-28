export const milliseconds = {
    second: 1_000,
    minute: 60 * 1_000,
    hour: 60 * 60 * 1_000,
    day: 24 * 60 * 60 * 1_000,
};

export function millisecondsSince(datetime: Date) {
    return Date.now() - datetime.getTime();
}

export function humanTime(lastTime: string | number | Date) {
    if (!lastTime) {
        return null;
    }

    const diff = millisecondsSince(new Date(lastTime));
    if (diff < milliseconds.minute) {
        return 'just now';
    } else if (diff < milliseconds.hour) {
        return `${Math.round(diff / 1000 / 60)} m ago`;
    } else if (diff < milliseconds.day) {
        return `${Math.round(diff / 1000 / 60 / 60)} h ago`;
    } else {
        return new Date(lastTime).toLocaleDateString();
    }
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    const mb = kb / 1024;
    if (mb < 1024) return mb.toFixed(1) + ' MB';
    const gb = mb / 1024;
    return gb.toFixed(1) + ' GB';
}

export function getAvatar(identifier: string | number) {
    return `https://robohash.org/${identifier}`;
    // let value = identifier
    // if(identifier?.length >= 2) value = `${identifier[0]}+${identifier[1]}`
    // return `https://ui-avatars.com/api/?background=random&name=${value}`
}
