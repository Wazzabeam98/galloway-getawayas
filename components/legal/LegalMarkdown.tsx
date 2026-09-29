import { Fragment, ReactNode } from 'react';

// Draws an agreement's markdown in the site's legal-page style (the same
// headings and paragraph rhythm /terms has always used). Deliberately small: it
// handles what the agreements use — headings, **bold**, horizontal rules,
// bullet lists, paragraphs with line breaks, and email addresses as links —
// and nothing else, so the text files stay plain markdown a solicitor's
// version can be pasted straight into.
//
// The document's own `# Title` is skipped: the page, panel or prompt around it
// already shows the title.

function inline(text: string, keyBase: string): ReactNode[] {
    const out: ReactNode[] = [];
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    parts.forEach((part, i) => {
        if (!part) return;
        const bold = /^\*\*([^*]+)\*\*$/.exec(part);
        const content = bold ? bold[1] : part;
        const pieces = content.split(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g).map((p, j) =>
            /@/.test(p) && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(p)
                ? <a key={j} href={`mailto:${p}`} className="text-emerald-700 underline">{p}</a>
                : <Fragment key={j}>{p}</Fragment>);
        out.push(bold
            ? <strong key={`${keyBase}-${i}`} className="font-semibold text-slate-900">{pieces}</strong>
            : <Fragment key={`${keyBase}-${i}`}>{pieces}</Fragment>);
    });
    return out;
}

export default function LegalMarkdown({ source }: { source: string }) {
    const blocks = source.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
    const out: ReactNode[] = [];
    let skippedTitle = false;

    blocks.forEach((block, b) => {
        const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
        if (!lines.length) return;
        const first = lines[0];

        if (/^# /.test(first) && !skippedTitle) {
            skippedTitle = true;
            if (lines.length > 1) out.push(<p key={b}>{inline(lines.slice(1).join(' '), `p${b}`)}</p>);
            return;
        }
        if (/^-{3,}$/.test(first.trim()) && lines.length === 1) {
            out.push(<hr key={b} className="my-6 border-slate-200" />);
            return;
        }
        const heading = /^(#{2,4}) (.*)$/.exec(first);
        if (heading) {
            const level = heading[1].length;
            out.push(level === 2
                ? <h2 key={b} className="text-xl font-bold text-slate-900 pt-4">{inline(heading[2], `h${b}`)}</h2>
                : <h3 key={b} className="text-base font-semibold text-slate-900 pt-2">{inline(heading[2], `h${b}`)}</h3>);
            if (lines.length > 1) out.push(<p key={`${b}-rest`}>{inline(lines.slice(1).join(' '), `r${b}`)}</p>);
            return;
        }
        if (lines.every((l) => /^[-*] /.test(l))) {
            out.push(
                <ul key={b} className="list-disc space-y-1 pl-5">
                    {lines.map((l, i) => <li key={i}>{inline(l.replace(/^[-*] /, ''), `li${b}-${i}`)}</li>)}
                </ul>,
            );
            return;
        }
        // A paragraph. Separate lines inside one block (an address, a contact
        // line) keep their breaks.
        out.push(
            <p key={b}>
                {lines.map((l, i) => (
                    <Fragment key={i}>
                        {i > 0 && <br />}
                        {inline(l, `p${b}-${i}`)}
                    </Fragment>
                ))}
            </p>,
        );
    });

    return <div className="text-slate-700 space-y-4">{out}</div>;
}
