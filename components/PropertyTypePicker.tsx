// The property-type tiles on the new-listing wizard (/addhome step 1). The
// listing editor uses a dropdown instead (listing-editor/PropertyTypeCard). The common types
// first, then the rarer ones under "Unique stays" — Airbnb's list in UK
// wording, plus static caravan, lodge and glamping pod. The list and its words
// live in lib/propertyTypes.ts.
import PropertyTypeIcon from '@/components/PropertyTypeIcon';
import { pickerTypes, UNIQUE_STAYS_HEADING, type PropertyType } from '@/lib/propertyTypes';

export default function PropertyTypePicker({ value, onChange, compact = false }: {
    value: string;
    onChange: (name: string) => void;
    // The editor's smaller tiles; the wizard's are larger.
    compact?: boolean;
}) {
    const { common, unique } = pickerTypes(value);

    const tile = (t: PropertyType) => {
        const selected = value === t.name;
        return (
            <button
                key={t.name}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(t.name)}
                className={`${compact ? 'p-4' : 'p-5'} rounded-2xl border-2 text-left transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
            >
                <PropertyTypeIcon icon={t.icon} className={`${compact ? 'w-5 h-5 mb-2' : 'w-6 h-6 mb-3'} text-slate-700`} />
                <div className={`font-semibold text-slate-900 ${compact ? 'text-sm' : ''}`}>{t.label}</div>
            </button>
        );
    };

    const grid = `grid grid-cols-2 md:grid-cols-3 ${compact ? 'gap-3' : 'gap-4'}`;

    return (
        <div>
            <div className={grid}>{common.map(tile)}</div>
            <h3 className={`${compact ? 'mt-8 mb-3 text-base' : 'mt-10 mb-4 text-lg'} font-bold text-slate-900`}>{UNIQUE_STAYS_HEADING}</h3>
            <div className={grid}>{unique.map(tile)}</div>
        </div>
    );
}
