import axios from 'axios';
import { Buffer } from 'buffer';
import RNFS from 'react-native-fs';
import { createAsyncThunk } from '@reduxjs/toolkit';

import { API_URL } from '~/global/variables';
import { encryptFile, decryptFile } from '~/global/crypto';
import { formatBytes } from '~/global/helper';
import { AppDispatch, RootState } from '~/store/store';

const createDefaultAsyncThunk = createAsyncThunk.withTypes<{ state: RootState; dispatch: AppDispatch }>();

function axiosBearerConfig(token: string) {
    return { headers: { Authorization: `JWT ${token}` } };
}

interface UploadResult {
    objectKey: string;
    keyBase64: string;
    ivBase64: string;
}

/** Encrypts a file and uploads the ciphertext to S3 via a pre-signed URL. Returns the objectKey and decryption key+IV to embed in the E2EE message. */
export const uploadMedia = createDefaultAsyncThunk<UploadResult, { filePath: string; contentType: string }>(
    'uploadMedia',
    async ({ filePath, contentType }, thunkAPI) => {
        const state = thunkAPI.getState().userReducer;

        // Fetch presigned URL while reading + encrypting the file (independent operations)
        const urlPromise = axios.post(`${API_URL}/media/upload-url`, { contentType }, axiosBearerConfig(state.token));

        // Read file from disk and decode base64 → binary
        let fileBase64: string | null = await RNFS.readFile(filePath, 'base64');
        const fileData = Buffer.from(fileBase64, 'base64');
        fileBase64 = null; // Release base64 string for GC before encryption allocates

        // Encrypt with a random per-file key
        const { encrypted, keyBase64, ivBase64 } = await encryptFile(fileData);

        // Await presigned URL (likely already resolved by now)
        const { data } = await urlPromise;
        const { uploadUrl, objectKey } = data;

        // Upload encrypted data directly to S3
        await axios.put(uploadUrl, encrypted, {
            headers: { 'Content-Type': 'application/octet-stream' },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });

        return { objectKey, keyBase64, ivBase64 };
    },
);

const CACHE_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

/** Deletes oldest cached files until total size is under CACHE_MAX_BYTES. Fire-and-forget on app start. */
export async function evictMediaCache(): Promise<void> {
    try {
        const files = await RNFS.readDir(RNFS.CachesDirectoryPath);
        const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
        if (totalBytes <= CACHE_MAX_BYTES) return;

        // Sort oldest first by mtime
        files.sort((a, b) => (a.mtime?.getTime() ?? 0) - (b.mtime?.getTime() ?? 0));

        let freed = 0;
        const target = totalBytes - CACHE_MAX_BYTES;
        for (const file of files) {
            if (freed >= target) break;
            if (!file.isFile()) continue;
            await RNFS.unlink(file.path);
            freed += file.size || 0;
        }
        console.debug(`Media cache eviction: freed ${formatBytes(freed)}`);
    } catch (err) {
        console.error('Media cache eviction failed:', err);
    }
}

/** Returns the local cache file path for a given S3 object key. */
export function getMediaCachePath(objectKey: string): string {
    const extension = objectKey.split('.').pop() || 'bin';
    const fileName = `${objectKey.split('/').pop()?.split('.')[0] || Date.now()}.${extension}`;
    return `${RNFS.CachesDirectoryPath}/${fileName}`;
}

/** Downloads encrypted media from S3 and decrypts it. Returns a local file:// URI pointing to the decrypted file. */
export const downloadMedia = createDefaultAsyncThunk<string, { objectKey: string; keyBase64: string; ivBase64: string }>(
    'downloadMedia',
    async ({ objectKey, keyBase64, ivBase64 }, thunkAPI) => {
        const state = thunkAPI.getState().userReducer;

        // Check if already cached
        const filePath = getMediaCachePath(objectKey);
        if (await RNFS.exists(filePath)) {
            return `file://${filePath}`;
        }

        // Get pre-signed download URL from backend
        const { data } = await axios.post(`${API_URL}/media/download-url`, { objectKey }, axiosBearerConfig(state.token));
        const { downloadUrl } = data;

        // Download encrypted data from S3
        const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });

        // Decrypt (response.data is already an ArrayBuffer, no need to copy into Buffer)
        const decrypted = await decryptFile(response.data, keyBase64, ivBase64);

        // Write decrypted file to cache dir
        await RNFS.writeFile(filePath, decrypted.toString('base64'), 'base64');

        return `file://${filePath}`;
    },
);
