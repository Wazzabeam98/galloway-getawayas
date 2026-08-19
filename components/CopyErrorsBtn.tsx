'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'react-toastify';

// Puts everything outstanding on the clipboard in one go, written to be
// pasted straight into a conversation with whoever is fixing it. Grouped by
// message, because the same fault hitting forty guests is one thing to fix.
export default function CopyErrorsBtn({ rows }: { rows: any[] }) {
    const [copied, setCopied] = useState(false);

    const build = () => {
        if (rows.length === 0) return 'No outstanding errors.';

        const groups: Record<string, any> = {};

        rows.forEach((row) => {
            const key =
                row.source +
                '::' +
                String(row.message)
                    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
                    .replace(/\d+\.\d\d/g, '<amount>')
                    .replace(/\b\d+\b/g, '<n>');

            if (!groups[key]) {
                groups[key] = {
                    source: row.source,
                    message: row.message,
                    count: 0,
                    paths: [] as string[],
                    last: row.created_at,
                    detail: row.detail,
                };
            }

            const g = groups[key];
            g.count += 1;
            if (row.created_at > g.last) {
                g.last = row.created_at;
                g.detail = row.detail || g.detail;
            }
            if (row.path && g.paths.indexOf(row.path) === -1) g.paths.push(row.path);
        });

        const issues = Object.keys(groups)
            .map((k) => groups[k])
            .sort((a, b) => b.count - a.count);

        const lines: string[] = [];
        lines.push('Galloway Getaways — outstanding errors');
        lines.push('Taken ' + new Date().toLocaleString('en-GB'));
        lines.push(issues.length + ' distinct issue(s), ' + rows.length + ' occurrence(s)');
        lines.push('');

        issues.forEach((g, i) => {
            lines.push('--- ' + (i + 1) + ' ---');
            lines.push('Where: ' + (g.source === 'server' ? 'server' : 'browser'));
            lines.push('What: ' + g.message);
            lines.push('Happened: ' + g.count + ' time(s), last ' + new Date(g.last).toLocaleString('en-GB'));
            if (g.paths.length) lines.push('Pages: ' + g.paths.join(', '));
            if (g.detail) {
                lines.push('Detail:');
                lines.push(String(g.detail).split('\n').slice(0, 15).join('\n'));
            }
            lines.push('');
        });

        return lines.join('\n');
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(build());
            setCopied(true);
            toast.success('Copied. Paste it to whoever is fixing it.', { theme: 'colored' });
            setTimeout(() => setCopied(false), 3000);
        } catch (err) {
            toast.error('Your browser wouldn\u2019t let us copy that.', { theme: 'colored' });
        }
    };

    return (
        <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 hover:border-slate-900 text-sm font-semibold text-slate-700 rounded-xl transition"
        >
            {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy all for fixing'}
        </button>
    );
}
