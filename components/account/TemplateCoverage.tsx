'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronDown, ChevronRight, KeyRound } from 'lucide-react';

// Which messages cover which properties.
//
// The mistake this exists to catch: narrowing a template to two cottages and
// forgetting the third, which then silently gets no check-in message — no door
// code, no directions, nothing. A host should see the gap rather than deduce
// it.
//
// Two rules keep it glanceable. Colour carries the meaning — green is covered,
// whether by its own message or the catch-all; anything that sends nothing is
// amber or red — so the cells never need reading one by one. And it stays shut
// until asked for: the headline says whether anything is wrong, which for most
// hosts is the whole answer. With a single property there is no grid at all,
// only the headline, because a one-row table says nothing a host does not
// already know.

interface Cell {
    listingId: string;
    templateType: string;
    state: 'specific' | 'default' | 'none' | 'disabled';
    clash?: boolean;
}

const LOOK: Record<string, { text: string; className: string; title: string }> = {
    specific: { text: 'Own', className: 'bg-emerald-50 text-emerald-800 border-emerald-200', title: 'Has its own message for this property' },
    default:  { text: 'Default', className: 'bg-emerald-50 text-emerald-800 border-emerald-200', title: 'Covered by a message that applies to all your properties' },
    disabled: { text: 'Off', className: 'bg-amber-50 text-amber-800 border-amber-300', title: 'A message exists but is switched off, so nothing will be sent' },
    none:     { text: 'None', className: 'bg-red-50 text-red-800 border-red-300 font-semibold', title: 'Nothing will be sent for this property' },
};

export default function TemplateCoverage() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/message-templates/coverage');
                const body = await res.json();
                if (!cancelled && body && body.ok) setData(body);
            } catch (err) {
                // The grid is a check on the messages, not the messages
                // themselves. Failing quietly beats an alarming banner.
            }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);

    if (loading || !data || data.listings.length < 1) return null;

    const cellAt = (listingId: string, type: string): Cell | undefined =>
        data.cells.filter((c: Cell) => c.listingId === listingId && c.templateType === type)[0];

    // Counted by property rather than by cell: a host thinks in cottages, not
    // in cottage-by-message combinations.
    const propertiesWith = (test: (c: Cell) => boolean) =>
        data.listings.filter((l: any) => data.cells.some((c: Cell) => c.listingId === l.id && test(c))).length;

    const silent = propertiesWith((c) => c.state === 'none');
    const switchedOff = propertiesWith((c) => c.state === 'disabled' && !c.clash);
    const clashing = propertiesWith((c) => !!c.clash);

    // Worst state wins the headline, so the one line a host reads is the one
    // that matters.
    const summary = silent > 0
        ? {
            tone: 'text-red-800',
            Icon: AlertTriangle,
            iconClass: 'text-red-700',
            text: silent === 1 ? '1 property will send nothing' : silent + ' properties will send nothing',
          }
        : clashing > 0
        ? {
            tone: 'text-red-800',
            Icon: AlertTriangle,
            iconClass: 'text-red-700',
            text: clashing === 1
                ? '1 property has two messages of the same kind'
                : clashing + ' properties have two messages of the same kind',
          }
        : switchedOff > 0
        ? {
            tone: 'text-amber-800',
            Icon: AlertTriangle,
            iconClass: 'text-amber-700',
            text: switchedOff === 1 ? '1 property has a message switched off' : switchedOff + ' properties have a message switched off',
          }
        : {
            tone: 'text-slate-700',
            Icon: Check,
            iconClass: 'text-emerald-700',
            text: 'All properties covered',
          };

    const showGrid = data.listings.length > 1;
    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <div className="mt-10 border rounded-2xl p-5">
            <h3 className="font-semibold text-slate-900 mb-2">What each property sends</h3>

            {showGrid ? (
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                    className={'flex items-center gap-2 text-sm font-medium w-full text-left ' + summary.tone}
                >
                    <summary.Icon className={'w-4 h-4 shrink-0 ' + summary.iconClass} />
                    <span>{summary.text}</span>
                    <Chevron className="w-4 h-4 shrink-0 text-slate-400" />
                </button>
            ) : (
                <div className={'flex items-center gap-2 text-sm font-medium ' + summary.tone}>
                    <summary.Icon className={'w-4 h-4 shrink-0 ' + summary.iconClass} />
                    <span>{summary.text}</span>
                </div>
            )}

            {showGrid && open && (
                <div className="mt-4">
                    <p className="text-sm text-slate-500 mb-4">
                        A message with no properties chosen covers all of them. One set up for a particular
                        property is used instead, for that property.
                    </p>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr>
                                    <th className="text-left font-medium text-slate-500 pb-2 pr-3">Property</th>
                                    {data.types.map((t: any) => (
                                        <th key={t.key} className="text-left font-medium text-slate-500 pb-2 px-2 whitespace-nowrap">
                                            {t.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.listings.map((l: any) => (
                                    <tr key={l.id} className="border-t">
                                        <td className="py-2 pr-3 text-slate-800 max-w-[14rem] truncate">{l.title}</td>
                                        {data.types.map((t: any) => {
                                            const cell = cellAt(l.id, t.key);
                                            const look = LOOK[cell?.state || 'none'];
                                            return (
                                                <td key={t.key} className="py-2 px-2">
                                                    <span
                                                        title={cell?.clash ? 'Two messages both name this property' : look.title}
                                                        className={
                                                            'inline-block text-xs px-2 py-1 rounded-md border ' +
                                                            (cell?.clash
                                                                ? 'bg-red-50 text-red-800 border-red-300 font-semibold'
                                                                : look.className)
                                                        }
                                                    >
                                                        {cell?.clash ? 'Clash' : look.text}
                                                    </span>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {silent > 0 && (
                        <p className="mt-4 text-sm text-slate-600">
                            If that is deliberate, ignore this — if it is not, a guest arrives with no
                            instructions.
                        </p>
                    )}
                </div>
            )}

            {/* The code lives on the listing, because it is per-property and
                this page is per-host. So this points at it rather than asking
                for it here — but this is where the failure shows up, so this is
                where a host needs telling. */}
            {(data.missingCode || []).length > 0 && (
                <div className="mt-4 border border-amber-300 bg-amber-50 rounded-xl p-4">
                    <div className="flex items-start gap-2">
                        <KeyRound className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                        <div>
                            <div className="text-sm font-semibold text-amber-900">
                                {data.missingCode.length === 1
                                    ? 'One property has no door code set'
                                    : data.missingCode.length + ' properties have no door code set'}
                            </div>
                            <p className="text-sm text-amber-800 mt-0.5">
                                A message covering {data.missingCode.length === 1 ? 'it' : 'them'} uses{' '}
                                <code className="text-xs bg-amber-100 px-1 rounded">{'{lockbox_code}'}</code>,
                                so it will be held back rather than sent with a gap in it.
                            </p>
                            <ul className="mt-2 space-y-1">
                                {data.missingCode.map((l: any) => (
                                    <li key={l.id}>
                                        <Link
                                            href={'/edit-listing/' + l.id}
                                            className="text-sm font-semibold text-amber-900 underline hover:text-amber-950"
                                        >
                                            Set the code for {l.title}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* The headline already says a clash exists; this says what it
                means. Kept outside the collapsed detail because a host with one
                property has nothing to expand. */}
            {clashing > 0 && (
                <p className="mt-2 text-sm text-red-800">
                    Two messages of the same kind both name the same property. Only one will send.
                </p>
            )}
        </div>
    );
}
