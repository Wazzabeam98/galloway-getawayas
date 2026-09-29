// A heartbeat for scheduled jobs.
//
// A cron with no charge-retry (the subscription/billing run) fails silently when
// it stops firing: nothing downstream notices its absence. recordCronRun stamps
// the last time a job finished into the cron_runs table (service-role only), and
// the daily error-digest reads it back with cronRunOverdue() to tell a job that
// has stopped from one that simply had nothing to do — and alerts the directors
// if a job is overdue.
//
// Neither function throws: a heartbeat write or read that fails must not turn a
// working cron into a failing one, so both swallow errors (logged, not raised).

import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';

export interface CronRun {
    job: string;
    ran_at: string;
    ok: boolean;
    detail: string | null;
}

// Stamp a job's completion. Called at the end of the run (success) and on the
// failure path (ok = false), so the digest can see both "hasn't run" and "ran
// but failed".
export async function recordCronRun(job: string, ok: boolean, detail?: string | null): Promise<void> {
    try {
        const admin = adminClient();
        await admin
            .from('cron_runs')
            .upsert(
                { job, ran_at: new Date().toISOString(), ok, detail: detail ?? null },
                { onConflict: 'job' }
            );
    } catch (err: any) {
        await logError('cron-heartbeat-write', { job, error: String(err && err.message) });
    }
}

// The last recorded run of a job, or null if it has never run (or the read
// failed — treated the same, because "we can't tell" and "never" both warrant a
// look).
export async function lastCronRun(job: string): Promise<CronRun | null> {
    try {
        const admin = adminClient();
        const { data } = await admin
            .from('cron_runs')
            .select('job, ran_at, ok, detail')
            .eq('job', job)
            .maybeSingle();
        return (data as CronRun) || null;
    } catch (err: any) {
        await logError('cron-heartbeat-read', { job, error: String(err && err.message) });
        return null;
    }
}

// Whether a daily job is overdue: it has never run, its last run failed, or its
// last successful run was more than `maxAgeHours` ago (26h by default — a full
// day plus a couple of hours' slack for a late scheduler). Returns the reason so
// the alert can say which.
export async function cronRunOverdue(
    job: string,
    maxAgeHours = 26
): Promise<{ overdue: boolean; reason: string; ranAt: string | null }> {
    const row = await lastCronRun(job);
    if (!row) return { overdue: true, reason: 'has never recorded a run', ranAt: null };
    if (!row.ok) return { overdue: true, reason: 'its last run failed', ranAt: row.ran_at };
    const ageMs = Date.now() - new Date(row.ran_at).getTime();
    if (ageMs > maxAgeHours * 3600 * 1000) {
        return { overdue: true, reason: 'has not run since ' + row.ran_at, ranAt: row.ran_at };
    }
    return { overdue: false, reason: '', ranAt: row.ran_at };
}
