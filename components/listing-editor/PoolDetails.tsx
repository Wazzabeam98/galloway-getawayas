'use client';

import {
    POOL_ACCESS_OPTIONS, POOL_SETTING_OPTIONS, poolLabel,
    type PoolAccess, type PoolSetting,
} from '@/lib/poolDetails';

// Once "Pool" is ticked, Airbnb asks two things about it: is it the guests' own
// or shared, and is it indoors or out. The listing page shows the answers as one
// line ("Private outdoor pool"). Shared by the add-a-property wizard and the
// listing editor; whoever renders it decides when a choice is saved.
export default function PoolDetails({ access, setting, onChange, disabled = false }: {
    access: PoolAccess | null;
    setting: PoolSetting | null;
    onChange: (access: PoolAccess | null, setting: PoolSetting | null) => void;
    disabled?: boolean;
}) {
    const pill = (on: boolean) =>
        `flex-1 rounded-xl border-2 px-4 py-3 text-left transition disabled:opacity-50 ${on ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`;

    return (
        <div className="rounded-2xl border border-slate-200 p-5" data-testid="pool-details">
            <h3 className="font-bold text-slate-900">About your pool</h3>
            <p className="text-sm text-slate-500 mt-0.5">Guests will see: {poolLabel(access, setting)}</p>

            <div className="mt-4">
                <div className="text-sm font-semibold text-slate-800 mb-2" id="pool-access-label">Is it private or shared?</div>
                <div className="flex gap-3" role="group" aria-labelledby="pool-access-label">
                    {POOL_ACCESS_OPTIONS.map((o) => (
                        <button key={o.value} type="button" disabled={disabled} aria-pressed={access === o.value}
                            onClick={() => onChange(o.value, setting)} className={pill(access === o.value)}>
                            <span className="block text-sm font-semibold text-slate-900">{o.label}</span>
                            <span className="block text-xs text-slate-500 mt-0.5">{o.hint}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-4">
                <div className="text-sm font-semibold text-slate-800 mb-2" id="pool-setting-label">Is it indoor or outdoor?</div>
                <div className="flex gap-3" role="group" aria-labelledby="pool-setting-label">
                    {POOL_SETTING_OPTIONS.map((o) => (
                        <button key={o.value} type="button" disabled={disabled} aria-pressed={setting === o.value}
                            onClick={() => onChange(access, o.value)} className={pill(setting === o.value)}>
                            <span className="block text-sm font-semibold text-slate-900">{o.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
