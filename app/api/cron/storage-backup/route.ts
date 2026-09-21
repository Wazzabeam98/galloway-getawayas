import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import {
    backupStore,
    assertReachable,
    putObject,
    type BackupStore,
} from '@/lib/backupStore';

export const dynamic = 'force-dynamic';
// The whole of both buckets is a few dozen files and tens of megabytes, so a
// full copy finishes well inside a minute. maxDuration stays at the platform's
// default cap; if the photo library ever grows into the gigabytes this becomes
// an incremental sync, but it is nowhere near that today.
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// THE OFF-SUPABASE STORAGE BACKUP
// ---------------------------------------------------------------------------
//
// Nothing currently copies Supabase Storage anywhere. If a bucket were deleted
// — by an account compromise, a billing lapse, or a mistake — every listing
// photo would be gone with no way back. This copies both photo buckets to an
// S3-compatible store on a DIFFERENT provider once a day, so a Supabase-side
// loss is recoverable.
//
// Each run is a full, self-contained, DATED snapshot:
//
//   storage/<YYYY-MM-DD>/listings/<path>
//   storage/<YYYY-MM-DD>/listings-removed/<path>
//   storage/<YYYY-MM-DD>/manifest.json
//
// Full rather than incremental because the data is small and a full copy is
// trivially verifiable — the manifest lists every object and its size, so a
// restore can prove it took back exactly what was stored. Dated rather than
// overw-in-place so that a corruption or a bad delete discovered days later can
// still be recovered from an earlier day. Yesterday's snapshot is untouched by
// today's run.
//
// Retention (how many days of snapshots to keep) is a lifecycle rule set on the
// bucket itself at the provider, not something this job prunes — see
// docs/BACKUP-AND-RESTORE.md.

const BUCKETS = ['listings', 'listings-removed'] as const;

type ManifestEntry = { bucket: string; path: string; size: number };

// Supabase Storage list() is one directory, 1000 rows at a time. Listing rows
// have a null id; file rows carry size in metadata. This walks the tree.
async function listBucket(
    admin: ReturnType<typeof adminClient>,
    bucket: string,
): Promise<ManifestEntry[]> {
    const out: ManifestEntry[] = [];
    const dirs: string[] = [''];
    while (dirs.length) {
        const dir = dirs.pop() as string;
        let offset = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { data, error } = await admin.storage
                .from(bucket)
                .list(dir, { limit: 1000, offset });
            if (error) throw new Error(`list ${bucket}/${dir}: ${error.message}`);
            if (!data || data.length === 0) break;
            for (const item of data) {
                const path = dir ? `${dir}/${item.name}` : item.name;
                if (item.id === null) dirs.push(path);
                else out.push({ bucket, path, size: item.metadata?.size ?? 0 });
            }
            if (data.length < 1000) break;
            offset += 1000;
        }
    }
    return out;
}

async function copyObject(
    admin: ReturnType<typeof adminClient>,
    store: BackupStore,
    day: string,
    entry: ManifestEntry,
): Promise<void> {
    const { data, error } = await admin.storage
        .from(entry.bucket)
        .download(entry.path);
    if (error || !data) {
        throw new Error(`download ${entry.bucket}/${entry.path}: ${error?.message}`);
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const key = `storage/${day}/${entry.bucket}/${entry.path}`;
    await putObject(store, key, bytes, data.type || 'application/octet-stream');
}

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const store = backupStore();
    if (!store) {
        // Not a failure: the code is live but the destination is not wired yet.
        // Say so plainly so a monitoring glance can tell "off" from "broken".
        return NextResponse.json({
            ok: false,
            configured: false,
            error: 'Backup store not configured (BACKUP_S3_* env vars unset)',
        });
    }

    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

    try {
        await assertReachable(store);

        const admin = adminClient();
        const manifest: ManifestEntry[] = [];
        for (const bucket of BUCKETS) {
            manifest.push(...(await listBucket(admin, bucket)));
        }

        let copied = 0;
        let bytes = 0;
        for (const entry of manifest) {
            await copyObject(admin, store, day, entry);
            copied += 1;
            bytes += entry.size;
        }

        // The manifest is written LAST, so its presence is itself the signal
        // that the snapshot completed: a run that died halfway leaves photos
        // but no manifest, and a restore knows not to trust it.
        const summary = {
            day,
            takenAt: new Date().toISOString(),
            source: process.env.NEXT_PUBLIC_SUPABASE_URL,
            buckets: BUCKETS,
            fileCount: manifest.length,
            totalBytes: bytes,
            files: manifest,
        };
        await putObject(
            store,
            `storage/${day}/manifest.json`,
            JSON.stringify(summary, null, 2),
            'application/json',
        );

        return NextResponse.json({ ok: true, day, copied, bytes });
    } catch (e: any) {
        await logError('storage-backup failed', e, { path: '/api/cron/storage-backup' });
        return NextResponse.json(
            { ok: false, day, error: e?.message || String(e) },
            { status: 500 },
        );
    }
}
