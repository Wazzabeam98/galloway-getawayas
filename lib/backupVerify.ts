// Checking a storage-backup snapshot against what was meant to be in it.
//
// Kept apart from lib/backupStore (which pulls in the AWS SDK) and free of '@/'
// imports, so the unit test can run it directly.

// The name the nightly run is stamped under in cron_runs; the error digest reads
// it back to notice a backup that has stopped running altogether.
export const BACKUP_JOB = 'storage-backup';

// Compares what was meant to be copied with what the store now holds. Returns
// the problems in plain words; an empty list means every file is there at the
// size Supabase reported. Pure, so the unit test can run it.
export function verifySnapshot(
    day: string,
    expected: { bucket: string; path: string; size: number }[],
    held: Map<string, number>,
): string[] {
    const problems: string[] = [];
    let missing = 0;
    let wrongSize = 0;
    let firstMissing = '';
    let firstWrong = '';
    for (const e of expected) {
        const key = `storage/${day}/${e.bucket}/${e.path}`;
        if (!held.has(key)) {
            missing += 1;
            if (!firstMissing) firstMissing = key;
        } else if (e.size > 0 && held.get(key) !== e.size) {
            wrongSize += 1;
            if (!firstWrong) firstWrong = `${key} (${held.get(key)} bytes, expected ${e.size})`;
        }
    }
    if (missing) problems.push(`${missing} file(s) missing from the bucket, e.g. ${firstMissing}`);
    if (wrongSize) problems.push(`${wrongSize} file(s) the wrong size, e.g. ${firstWrong}`);
    if (!held.has(`storage/${day}/manifest.json`)) problems.push('manifest.json missing from the bucket');
    return problems;
}
