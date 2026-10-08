import { createClient } from '@supabase/supabase-js';
import { INFO_SOURCE } from './logSources';

// Records a failure from a route or a scheduled job.
//
// Never throws. Something has already gone wrong by the time this is called,
// and a logger that fails loudly would turn one problem into two.
export async function logError(
    message: string,
    detail?: any,
    context?: { path?: string; userId?: string }
): Promise<void> {
    await record('server', message, detail, context);
}

// Records something worth keeping that is NOT a failure. Same table, same
// never-throws rule as logError; only the source differs.
export async function logInfo(
    message: string,
    detail?: any,
    context?: { path?: string; userId?: string }
): Promise<void> {
    await record(INFO_SOURCE, message, detail, context);
}

async function record(
    source: string,
    message: string,
    detail?: any,
    context?: { path?: string; userId?: string }
): Promise<void> {
    try {
        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } }
        );

        const asText =
            detail === null || detail === undefined
                ? null
                : typeof detail === 'string'
                    ? detail
                    : detail instanceof Error
                        ? (detail.stack || detail.message)
                        : JSON.stringify(detail);

        await admin.from('error_log').insert({
            source,
            message: String(message).slice(0, 500),
            detail: asText ? String(asText).slice(0, 4000) : null,
            path: (context && context.path) || null,
            user_id: (context && context.userId) || null,
        });
    } catch (err) {
        // Console only. If the database is the thing that's broken, there is
        // nowhere else to put this.
        console.error('[logError failed]', message);
    }
}
