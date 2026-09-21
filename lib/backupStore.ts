// The off-Supabase backup store.
//
// Nothing here talks to Supabase. This is the OTHER side — an S3-compatible
// object store on a DIFFERENT provider — so that losing a Supabase bucket, or
// the whole Supabase account, cannot also lose the backup. Supabase Storage
// runs on AWS; the recommended target is Cloudflare R2, a different company on
// different infrastructure, which is the entire point of keeping a copy here.
//
// It is S3-compatible on purpose: the same five environment variables point at
// Cloudflare R2, Backblaze B2 or AWS S3 without a code change, so the choice of
// provider is an operations decision, not a code one.
//
// Server-side only. The credentials below are a WRITE path into the backup
// store and must never reach a browser — none are NEXT_PUBLIC_.

import {
    S3Client,
    PutObjectCommand,
} from '@aws-sdk/client-s3';

export type BackupStore = {
    client: S3Client;
    bucket: string;
};

// Returns the configured store, or null when it is not configured yet. Null is
// a real, expected state: the code ships before the R2 bucket exists, and the
// cron must no-op cleanly (and say so) rather than throw, until the five
// variables are set on Vercel.
export function backupStore(): BackupStore | null {
    const endpoint = process.env.BACKUP_S3_ENDPOINT;
    const region = process.env.BACKUP_S3_REGION || 'auto';
    const bucket = process.env.BACKUP_S3_BUCKET;
    const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

    const client = new S3Client({
        region,
        endpoint,
        // R2 and B2 require path-style addressing; S3 tolerates it. Forcing it
        // keeps the one code path working against all three.
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        // Since early 2025 the SDK adds a CRC32 request checksum (and a
        // x-amz-sdk-checksum-algorithm header) by default. Cloudflare R2 rejects
        // those and answers with an error the SDK can only surface as an opaque
        // "UnknownError". Both flags off means "only checksum when the operation
        // actually requires it", which R2 accepts — and AWS S3 and B2 are happy
        // with it too, so the one code path still works everywhere.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    });

    return { client, bucket };
}

// Proves the credentials work and the bucket is writable before a run starts,
// so a misconfiguration fails loudly at the top of the job rather than halfway
// through an upload.
//
// The probe is a tiny PutObject, deliberately NOT a HeadBucket. A least-
// privilege R2 token ("Object Read & Write") — the right token to hand a backup
// job — can write objects but is refused bucket-level calls like HeadBucket with
// a 403, so a HeadBucket preflight would fail a token that is in fact perfectly
// able to do the job. A PutObject exercises exactly the permission the copy
// needs, and unlike HeadBucket it returns a decodable error body, so genuinely
// wrong credentials surface as AccessDenied / SignatureDoesNotMatch rather than
// an opaque 403. The probe object is left in place (overwritten each run) as a
// cheap record of the last successful reach.
export async function assertReachable(store: BackupStore): Promise<void> {
    await putObject(
        store,
        'storage/.reachable-probe',
        new Date().toISOString(),
        'text/plain',
    );
}

// Turns an AWS-SDK error into something a log can act on. The SDK's own message
// is often just "UnknownError"; the HTTP status and the error name/code carried
// alongside it are what actually say whether it was auth (403), a wrong bucket
// or endpoint (404), or a rejected request (400).
export function describeS3Error(e: any): string {
    const status = e?.$metadata?.httpStatusCode;
    const name = e?.name || e?.Code;
    const parts = [];
    if (name) parts.push(String(name));
    if (status) parts.push(`HTTP ${status}`);
    if (e?.message && e.message !== name) parts.push(e.message);
    return parts.join(' — ') || String(e);
}

export async function putObject(
    store: BackupStore,
    key: string,
    body: Uint8Array | string,
    contentType?: string,
): Promise<void> {
    await store.client.send(
        new PutObjectCommand({
            Bucket: store.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
        }),
    );
}
