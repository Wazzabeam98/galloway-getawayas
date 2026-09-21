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
    HeadBucketCommand,
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
    });

    return { client, bucket };
}

// Proves the credentials work and the bucket is reachable before a run starts,
// so a misconfiguration fails loudly at the top of the job rather than halfway
// through an upload.
export async function assertReachable(store: BackupStore): Promise<void> {
    await store.client.send(new HeadBucketCommand({ Bucket: store.bucket }));
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
