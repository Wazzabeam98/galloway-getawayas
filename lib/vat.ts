// A host's or provider's own UK VAT registration — the one rule, shared by the
// settings form (as you type) and the save route (before anything is written),
// so the browser and the server can never disagree about what a valid number is.
//
// Accepted shapes (HMRC's, with GB or XI for Northern Ireland; spaces, dots and
// dashes are ignored, and a bare nine or twelve digits is read as GB):
//   GB123456789      standard — nine digits, the last two a check number
//   GB123456789001   a branch — the standard nine plus a three-digit branch
//   GBGD001          a government department (000–499)
//   GBHA599          a health authority (500–999)
// The nine digits are checked with HMRC's weighted check (both the old series
// and the post-2010 "+55" series), so a single mistyped digit is caught here
// rather than printed on a guest's receipt.
//
// Settled: Galloway Getaways is NOT VAT registered. There is no VAT on our
// commission and no VAT number of ours anywhere — not on receipts, not in the
// email footer, not in config. Everything here is about a SUPPLIER's own VAT.
//
// A supplier's price already includes their VAT by law, so VAT is never added on
// top of a price or as an extra line in a total — the guest pays exactly the
// price shown. Where a registered supplier's receipt shows VAT it only BREAKS
// the price already paid into net + VAT + total (vatBreakdown below), so a
// business guest can reclaim it; the gross never changes.
export const UK_VAT_RATE = 0.20;

// Split a VAT-inclusive gross into the net and the VAT within it. VAT is gross −
// net, so the three figures always add to the penny and the "total" printed is
// exactly what the guest paid.
export function vatBreakdown(gross: number | string | null | undefined): { net: number; vat: number; gross: number } {
    const g = Math.round((Number(gross) || 0) * 100) / 100;
    const net = Math.round((g / (1 + UK_VAT_RATE)) * 100) / 100;
    const vat = Math.round((g - net) * 100) / 100;
    return { net, vat, gross: g };
}

export interface VatSettings {
    registered: boolean;
    number: string | null;   // normalised, e.g. GB999999973; null when not registered
    name: string | null;     // the business name registered for VAT
}

export const VAT_NAME_MAX = 120;

export function normaliseVatNumber(raw: string): string {
    let v = String(raw || '').toUpperCase().replace(/[\s.\-]/g, '');
    if (/^\d{9}$|^\d{12}$/.test(v)) v = 'GB' + v;
    return v;
}

function checkDigitsOk(nine: string): boolean {
    const d = nine.split('').map(Number);
    const weighted = d.slice(0, 7).reduce((sum, digit, i) => sum + digit * (8 - i), 0);
    const total = weighted + d[7] * 10 + d[8];
    return total % 97 === 0 || (total + 55) % 97 === 0;
}

// null when valid; otherwise the sentence to show under the box.
export function vatNumberProblem(raw: string): string | null {
    const v = normaliseVatNumber(raw);
    if (!v) return 'Enter your VAT number.';
    const m = v.match(/^(GB|XI)(.*)$/);
    if (!m) return 'A UK VAT number starts with GB (or XI in Northern Ireland).';
    const body = m[2];
    const gd = body.match(/^GD(\d{3})$/);
    if (gd) return Number(gd[1]) < 500 ? null : 'A GD number runs from GD000 to GD499.';
    const ha = body.match(/^HA(\d{3})$/);
    if (ha) return Number(ha[1]) >= 500 ? null : 'An HA number runs from HA500 to HA999.';
    if (!/^\d{9}(\d{3})?$/.test(body)) {
        return 'A UK VAT number is GB followed by 9 digits, for example GB 123 4567 89.';
    }
    if (!checkDigitsOk(body.slice(0, 9))) {
        return "That number doesn't pass HMRC's check — look for a mistyped digit.";
    }
    return null;
}

export function vatNameProblem(raw: string): string | null {
    const v = String(raw || '').trim();
    if (!v) return 'Enter the business name you are registered under.';
    if (v.length > VAT_NAME_MAX) return 'Keep the name to ' + VAT_NAME_MAX + ' characters.';
    return null;
}

// The whole form, as the server checks it. Returns the clean value to store or
// the first problem, keyed to its field.
export function checkVatSettings(input: { registered?: unknown; number?: unknown; name?: unknown }):
    { ok: true; value: VatSettings } | { ok: false; field: 'number' | 'name'; message: string } {
    if (input.registered !== true) return { ok: true, value: { registered: false, number: null, name: null } };
    const numberProblem = vatNumberProblem(String(input.number || ''));
    if (numberProblem) return { ok: false, field: 'number', message: numberProblem };
    const nameProblem = vatNameProblem(String(input.name || ''));
    if (nameProblem) return { ok: false, field: 'name', message: nameProblem };
    return {
        ok: true,
        value: {
            registered: true,
            number: normaliseVatNumber(String(input.number)),
            name: String(input.name).trim(),
        },
    };
}

// HMRC's printed spacing: GB 123 4567 89 (and a branch's three digits after).
export function formatVatNumber(stored: string | null | undefined): string {
    const v = normaliseVatNumber(String(stored || ''));
    const m = v.match(/^(GB|XI)(\d{3})(\d{4})(\d{2})(\d{3})?$/);
    if (m) return [m[1], m[2], m[3], m[4], m[5]].filter(Boolean).join(' ');
    return v.replace(/^(GB|XI)/, '$1 ');
}

// The supplier block on a receipt, from the snapshot frozen on the booking or
// order — null (show nothing) unless both halves are there.
export function supplierFromSnapshot(row: { supplier_vat_number?: string | null; supplier_vat_name?: string | null } | null | undefined):
    { name: string; vatNumber: string } | null {
    const number = row && row.supplier_vat_number ? String(row.supplier_vat_number) : '';
    const name = row && row.supplier_vat_name ? String(row.supplier_vat_name).trim() : '';
    if (!number || !name) return null;
    return { name, vatNumber: formatVatNumber(number) };
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The supplier block for a receipt email, from the snapshot plus the gross the
// guest paid. '' — nothing at all — when the supplier isn't VAT registered. The
// price already includes VAT, so this only breaks `gross` into net + VAT @20% +
// total so a business guest can reclaim it; nothing is added.
export function supplierVatHtml(
    row: { supplier_vat_number?: string | null; supplier_vat_name?: string | null } | null | undefined,
    gross?: number | string | null,
): string {
    const supplier = supplierFromSnapshot(row);
    if (!supplier) return '';
    const b = vatBreakdown(gross);
    const money = (n: number) => '&pound;' + n.toFixed(2);
    const line = (label: string, value: number, strong = false) =>
        '<tr>'
        + '<td style="padding:3px 0;font-size:13px;color:' + (strong ? '#111827' : '#6b7280') + ';' + (strong ? 'font-weight:600;' : '') + '">' + label + '</td>'
        + '<td style="padding:3px 0;font-size:13px;text-align:right;color:' + (strong ? '#111827' : '#6b7280') + ';' + (strong ? 'font-weight:600;' : '') + '">' + money(value) + '</td>'
        + '</tr>';
    return '<div style="margin:16px 0 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;">'
        + '<div style="font-size:13px;color:#6b7280;">Supplied by <strong style="color:#111827;">'
        + escapeHtml(supplier.name) + '</strong> &middot; VAT number ' + escapeHtml(supplier.vatNumber) + '</div>'
        + '<div style="margin-top:8px;font-size:12px;color:#9ca3af;">This price includes VAT at 20%</div>'
        + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:2px;">'
        + line('Net', b.net) + line('VAT (20%)', b.vat) + line('Total', b.gross, true)
        + '</table>'
        + '<div style="margin-top:8px;font-size:13px;color:#6b7280;">Galloway Getaways takes payment on their behalf.</div>'
        + '</div>';
}
