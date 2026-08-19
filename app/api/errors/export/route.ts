import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// A digest of what's broken, for whoever is doing the fixing.
//
// Protected by the same secret the scheduled jobs use, so it can be fetched
// from a terminal or a script without a browser session:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        "https://gallowaygetaways.co.uk/api/errors/export?hours=24"
//
// Errors are grouped by message rather than listed one by one — the same fault
// hitting forty guests is one thing to fix, not forty.
export async function GET(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const hours = Math.min(Number(req.nextUrl.searchParams.get('hours')) || 24, 720);
    const includeResolved = req.nextUrl.searchParams.get('resolved') === 'true';
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    let query = admin
        .from('error_log')
        .select('id, source, message, detail, path, digest, user_id, user_agent, resolved, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500);

    if (!includeResolved) query = query.eq('resolved', false);

    const { data: rows, error } = await query;

    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const all = rows || [];

    const groups: Record<string, any> = {};

    all.forEach((row: any) => {
        // Ids, amounts and timestamps inside a message would split one fault
        // into dozens of groups, so they're flattened for grouping only.
        const key =
            row.source +
            '::' +
            String(row.message)
                .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
                .replace(/\d+\.\d\d/g, '<amount>')
                .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
                .replace(/\b\d+\b/g, '<n>');

        if (!groups[key]) {
            groups[key] = {
                source: row.source,
                message: row.message,
                count: 0,
                paths: [] as string[],
                firstSeen: row.created_at,
                lastSeen: row.created_at,
                affectedUsers: [] as string[],
                // Only the newest stack — they'll be near enough identical.
                sample: row.detail || null,
                sampleId: row.id,
            };
        }

        const g = groups[key];
        g.count += 1;

        if (row.created_at > g.lastSeen) g.lastSeen = row.created_at;
        if (row.created_at < g.firstSeen) g.firstSeen = row.created_at;
        if (row.path && g.paths.indexOf(row.path) === -1) g.paths.push(row.path);
        if (row.user_id && g.affectedUsers.indexOf(row.user_id) === -1) {
            g.affectedUsers.push(row.user_id);
        }
    });

    const issues = Object.keys(groups)
        .map((k) => {
            const g = groups[k];
            return {
                source: g.source,
                message: g.message,
                occurrences: g.count,
                paths: g.paths,
                firstSeen: g.firstSeen,
                lastSeen: g.lastSeen,
                peopleAffected: g.affectedUsers.length,
                sampleErrorId: g.sampleId,
                sampleDetail: g.sample,
            };
        })
        .sort((a, b) => b.occurrences - a.occurrences);

    return NextResponse.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        windowHours: hours,
        totalErrors: all.length,
        distinctIssues: issues.length,
        serverErrors: all.filter((r: any) => r.source === 'server').length,
        browserErrors: all.filter((r: any) => r.source === 'client').length,
        issues: issues,
    });
}
