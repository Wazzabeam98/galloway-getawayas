import { Award, Star } from 'lucide-react';

// A trailing full stop makes a one-line detail read like a headline's
// punctuation; drop it so the credential sits as a quiet fact.
function tidy(text: string) {
    return text.trim().replace(/\.+$/, '');
}

// The host's credentials — their qualifications and any recognition — rendered
// as quiet details, not headings: a small muted icon, the line in normal weight
// and slightly smaller, with no grey label beneath. Shared by the experience
// listing page and the order page's host card so the two can't drift.
//
// Qualifications are optional and an unfilled one is never shown, so a host who
// wrote neither renders nothing at all — no empty row.
export default function HostCredentials({
    qualifications,
    recognition,
    className = '',
}: {
    qualifications?: string | null;
    recognition?: string | null;
    className?: string;
}) {
    const q = qualifications ? tidy(qualifications) : '';
    const r = recognition ? tidy(recognition) : '';
    if (!q && !r) return null;
    return (
        <div className={('space-y-2.5 ' + className).trim()}>
            {q ? (
                <div className="flex items-start gap-2.5 text-[13px] text-slate-600">
                    <Award className="mt-0.5 h-4 w-4 flex-none text-slate-400" aria-hidden />
                    <span className="min-w-0 whitespace-pre-line leading-snug">{q}</span>
                </div>
            ) : null}
            {r ? (
                <div className="flex items-start gap-2.5 text-[13px] text-slate-600">
                    <Star className="mt-0.5 h-4 w-4 flex-none text-slate-400" aria-hidden />
                    <span className="min-w-0 whitespace-pre-line leading-snug">{r}</span>
                </div>
            ) : null}
        </div>
    );
}
