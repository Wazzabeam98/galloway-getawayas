'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Sparkles, Wrench, Trees, Droplet, ChefHat, Cake, ShoppingBasket, PawPrint, Trash2, Plus, X, ChevronLeft } from 'lucide-react';
import { compressImage } from '@/lib/compressImage';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import Env from '@/config/Env';
import {
    skillKey,
    suggestSkills,
    wouldCreateNew,
    regulatedConceptFor,
    schemesSatisfying,
    blockedSkillReason,
} from '@/lib/serviceSkills';
import LoginModel from '@/components/auth/LoginModel';
import {
    tradeLabel,
    HOST_TRADES,
    audienceForTrade,
    extrasFor,
    extrasProblems,
    imageryFor,
    initialsFor,
    showsTimeGuide,
    BUILDING_TYPES,
    offeringsFor,
    isPricingGroup,
    groupIsOffered,
    offerableSchemes,
    asksAboutSkills,
    calloutLine,
    groupForTrade,
    schemeLabel,
    schemeNumberLabel,
    isPartP,
    asksAboutFuel,
    PART_P_SCHEMES,
    groupGate,
    EXTRA_GROUPS,
    COVERAGE_TOWNS,
    townByKey,
    submitProblems,
    statusSummary,
    submitStatusPatch,
    pricingModelFor,
    bandsFor,
    REVIEW_WITHIN_HOURS,
} from '@/lib/serviceProviders';

const TRADE_ICONS: Record<string, any> = {
    sponge: Sparkles,
    spanner: Wrench,
    trees: Trees,
    droplet: Droplet,
    chef: ChefHat,
    cake: Cake,
    basket: ShoppingBasket,
    paw: PawPrint,
    bin: Trash2,
};

interface AreaRow {
    id?: string;
    town: string;
    radius_miles: number;
}

// Where an unfinished application lives before there is an account to hang
// it on. Per trade, because somebody can be part-way through two.
const draftKey = (trade: string) => 'gg.provider-draft.' + trade;

function ApplicationForm() {
    const router = useRouter();
    const params = useSearchParams();

    // Chosen on step one and carried in the URL, so signing in halfway does
    // not lose it. A saved record wins once it loads — except when they have
    // just come back through "change", where the new pick is the point.
    const tradeFromUrl = String(params.get('trade') || '');
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);

    const [providerId, setProviderId] = useState<string | null>(null);
    const [status, setStatus] = useState('draft');
    const [reviewNote, setReviewNote] = useState<string | null>(null);

    const [businessName, setBusinessName] = useState('');
    const [trade, setTrade] = useState(tradeFromUrl || 'sponge');
    const [description, setDescription] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [logo, setLogo] = useState<string | null>(null);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [buildingType, setBuildingType] = useState('');
    const [panes, setPanes] = useState('');
    // True once the form has either loaded a saved record or restored a local
    // draft. Nothing is written to storage before it, or the empty defaults
    // would overwrite the thing being restored.
    const [hydrated, setHydrated] = useState(false);
    const [restored, setRestored] = useState(false);
    // Set when they pressed a button that needs an account. The account panel
    // appears, and the press is replayed once they are in.
    const [wantsToSave, setWantsToSave] = useState<null | boolean>(null);

    // The account, made from what they have already typed rather than behind a
    // door. A tradesman who has just filled in a whole form and is then asked
    // to go and register somewhere else has been asked to do the work twice.
    const [acctPassword, setAcctPassword] = useState('');
    const [acctBusy, setAcctBusy] = useState(false);
    const [acctError, setAcctError] = useState('');
    const [acctConsent, setAcctConsent] = useState(false);
    const [checkYourEmail, setCheckYourEmail] = useState(false);
    // For somebody who has been here before. Not the default, because most
    // people arriving at this point have no account.
    const [showSignIn, setShowSignIn] = useState(false);
    const [areas, setAreas] = useState<AreaRow[]>([]);

    const [saving, setSaving] = useState(false);
    const [processingPhotos, setProcessingPhotos] = useState(false);
    const [touchedSubmit, setTouchedSubmit] = useState(false);

    // Keyed by band. Kept as strings so a half-typed price is not coerced to a
    // number mid-keystroke, and blank stays genuinely blank rather than 0.
    const [prices, setPrices] = useState<Record<string, { price: string; typical_hours: string }>>({});
    // Keyed by extra. Price stays a string for the same reason band prices
    // do — a half-typed number should not be coerced mid-keystroke.
    const [extras, setExtras] = useState<Record<string, { offered: boolean; price: string; notes: string }>>({});
    const [gateOpen, setGateOpen] = useState<Record<string, boolean | null>>({});
    // Which bands have the optional time guide showing. Open where one is
    // already set, so a returning provider sees what they typed.
    const [hoursOpen, setHoursOpen] = useState<Record<string, boolean>>({});
    const [calloutFee, setCalloutFee] = useState('');
    const [hourlyRate, setHourlyRate] = useState('');
    const [calloutWaived, setCalloutWaived] = useState(false);

    // Skills tags. Held as labels rather than ids, because a tag they typed
    // before signing in does not have an id yet — the route settles all of
    // that when it reconciles the set.
    const [skills, setSkills] = useState<string[]>([]);
    const [skillTyped, setSkillTyped] = useState('');
    // Every existing tag, for the type-ahead. That list IS the mechanism:
    // somebody offered "bricklaying" takes it, and somebody offered nothing
    // types "brick laying".
    const [allSkills, setAllSkills] = useState<any[]>([]);

    // Gas and oil are questions inside the plumber's application rather than
    // trades of their own, because most plumbers do one and plenty do both.
    // They are also the two answers an owner with a dead boiler needs before
    // they ring, so they go on the listing rather than into the extras.
    const [doesGas, setDoesGas] = useState(false);
    const [doesOil, setDoesOil] = useState(false);
    // Keyed by scheme. Strings, because a registration number is not a number
    // — Gas Safe numbers have leading zeros that Number() would eat.
    const [registrations, setRegistrations] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!tradeFromUrl && !HOST_TRADES.includes(tradeFromUrl as any)) {
            // No trade in the URL means they have not been through step one.
            router.replace('/services/join');
        }
    }, [tradeFromUrl, router]);

    useEffect(() => {
        const load = async () => {
            // Anything in here that throws used to leave the page on
            // "Loading…" for good, because setLoading(false) only ran on the
            // way out of the happy path. A truncated auth cookie is enough to
            // do it — the Supabase client throws while it is being built, so
            // not one request is even attempted and the screen never changes.
            try {
                // Read whether or not they are signed in — the type-ahead has
                // to work before there is an account, which is when somebody
                // is most likely to invent a new spelling.
                const { data: skillRows } = await supabase
                    .from('service_skills')
                    .select('id, label, slug, regulated_concept, merged_into')
                    .is('merged_into', null)
                    .order('label');

                setAllSkills(skillRows || []);

                const { data: { session } } = await supabase.auth.getSession();
                setSession(session);

                // Signed out is a normal state here now: somebody should be
                // able to see what they are signing up for, and fill it in,
                // before being asked for anything.
                if (!session) {
                    restoreDraft();
                    return;
                }

                // Keyed on the trade as well as the owner. One person can run
                // a cleaning round and a window round, or plumb and joiner —
                // and each is its own business with its own name, so this is
                // the application for the trade they picked and nothing about
                // it is inherited from another one they hold.
                const { data: existing } = await supabase
                    .from('service_providers')
                    .select('id, business_name, trade, description, contact_email, contact_phone, audience, photos, logo, status, review_note, callout_fee, hourly_rate, callout_waived, does_gas, does_oil')
                    .eq('owner_id', session.user.id)
                    .eq('trade', tradeFromUrl)
                    .maybeSingle();

                if (existing) {
                    setProviderId(existing.id);
                    setBusinessName(existing.business_name || '');
                    setTrade(existing.trade || tradeFromUrl);
                    setDescription(existing.description || '');
                    setContactEmail(existing.contact_email || session.user.email || '');
                    setContactPhone(existing.contact_phone || '');
                    setPhotos(existing.photos || []);
                    setLogo(existing.logo || null);
                    setStatus(existing.status || 'draft');
                    setDoesGas(existing.does_gas === true);
                    setDoesOil(existing.does_oil === true);
                    setReviewNote(existing.review_note || null);
                    setCalloutFee(existing.callout_fee === null || existing.callout_fee === undefined ? '' : String(existing.callout_fee));
                    setHourlyRate(existing.hourly_rate === null || existing.hourly_rate === undefined ? '' : String(existing.hourly_rate));
                    setCalloutWaived(existing.callout_waived === true);

                    // The numbers only. Whether one has been checked is not
                    // read here and not shown here — it is not theirs to see
                    // or to change, and a form that displayed it would invite
                    // somebody to try.
                    const { data: regRows } = await supabase
                        .from('service_provider_registrations')
                        .select('scheme, number')
                        .eq('provider_id', existing.id);

                    const loadedRegs: Record<string, string> = {};
                    for (const row of regRows || []) loadedRegs[row.scheme] = row.number || '';
                    setRegistrations(loadedRegs);

                    const { data: mySkills } = await supabase
                        .from('service_provider_skills')
                        .select('service_skills ( label )')
                        .eq('provider_id', existing.id);

                    setSkills(
                        (mySkills || [])
                            .map((r: any) => (r.service_skills && r.service_skills.label) || '')
                            .filter(Boolean)
                    );

                    const { data: priceRows } = await supabase
                        .from('service_provider_prices')
                        .select('band_key, price, typical_hours')
                        .eq('provider_id', existing.id);

                    const { data: extraRows } = await supabase
                        .from('service_provider_extras')
                        .select('extra_key, offered, price, notes')
                        .eq('provider_id', existing.id);

                    const loadedExtras: Record<string, { offered: boolean; price: string; notes: string }> = {};
                    for (const row of extraRows || []) {
                        loadedExtras[row.extra_key] = {
                            offered: row.offered === true,
                            price: row.price === null || row.price === undefined ? '' : String(row.price),
                            notes: row.notes || '',
                        };
                    }
                    setExtras(loadedExtras);
                    const t = existing.trade || 'sponge';
                    setGateOpen({
                        laundry: groupIsOffered('laundry', t, loadedExtras),
                        hot_tub: groupIsOffered('hot_tub', t, loadedExtras),
                    });

                    const loaded: Record<string, { price: string; typical_hours: string }> = {};
                    for (const row of priceRows || []) {
                        loaded[row.band_key] = {
                            price: String(row.price),
                            typical_hours: row.typical_hours === null || row.typical_hours === undefined
                                ? ''
                                : String(row.typical_hours),
                        };
                    }
                    setPrices(loaded);

                    const openHours: Record<string, boolean> = {};
                    for (const key of Object.keys(loaded)) {
                        if (loaded[key].typical_hours) openHours[key] = true;
                    }
                    setHoursOpen(openHours);

                    const { data: areaRows } = await supabase
                        .from('service_areas')
                        .select('id, label, radius_miles')
                        .eq('provider_id', existing.id);

                    setAreas((areaRows || []).map((a: any) => ({
                        id: a.id,
                        town: a.label,
                        radius_miles: Number(a.radius_miles),
                    })));
                } else {
                    // Signed in, nothing saved for this trade — so anything
                    // they typed before signing in is still the newest thing.
                    restoreDraft();
                    setContactEmail((prev) => prev || session.user.email || '');
                }

            } catch (err) {
                // Nothing to show them but the empty form; a stuck spinner is
                // worse than a form that starts blank.
                toast.error('We could not load your details. Try refreshing.', { theme: 'colored' });
            } finally {
                setLoading(false);
                setHydrated(true);
            }
        };
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase, tradeFromUrl]);

    // Signing in is the only thing that changes who this belongs to, and with
    // Google it happens by leaving the site and coming back — so the draft has
    // to be somewhere that survives a round trip, and the press that asked for
    // an account has to be replayed when they return.
    useEffect(() => {
        const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next);
        });
        return () => sub.subscription.unsubscribe();
    }, [supabase]);

    // Kept in the browser rather than on a server: there is no owner yet, so
    // there is no row to put it in, and a table of anonymous half-applications
    // would be a new thing to secure, expire and clean up for a case that
    // lasts about four minutes.
    //
    // It survives closing the tab, a refresh, and the trip out to Google and
    // back. It does not survive clearing browser data, a private window, or
    // moving to another device.
    const restoreDraft = () => {
        try {
            const raw = window.localStorage.getItem(draftKey(tradeFromUrl));
            if (!raw) return;

            const d = JSON.parse(raw);
            if (d.businessName) setBusinessName(d.businessName);
            if (d.description) setDescription(d.description);
            if (d.contactEmail) setContactEmail(d.contactEmail);
            if (d.contactPhone) setContactPhone(d.contactPhone);
            if (d.doesGas !== undefined) setDoesGas(d.doesGas === true);
            if (d.doesOil !== undefined) setDoesOil(d.doesOil === true);
            if (d.registrations) setRegistrations(d.registrations);
            if (d.calloutWaived !== undefined) setCalloutWaived(d.calloutWaived === true);
            if (Array.isArray(d.skills)) setSkills(d.skills);
            if (Array.isArray(d.photos)) setPhotos(d.photos);
            if (d.logo) setLogo(d.logo);
            if (d.buildingType) setBuildingType(d.buildingType);
            if (d.panes) setPanes(d.panes);
            if (d.prices) setPrices(d.prices);
            if (d.extras) setExtras(d.extras);
            if (d.calloutFee) setCalloutFee(d.calloutFee);
            if (d.hourlyRate) setHourlyRate(d.hourlyRate);
            if (d.areas) setAreas(d.areas);
            setRestored(true);
        } catch (err) {
            // A draft we cannot read is a draft they start again, which is
            // better than a page that will not open.
        }
    };

    const forgetDraft = () => {
        try {
            window.localStorage.removeItem(draftKey(tradeFromUrl));
        } catch (err) {
            /* nothing to do */
        }
    };

    useEffect(() => {
        if (!hydrated) return;
        // Once it is in the database, the database is the copy that counts.
        if (providerId) return;

        try {
            window.localStorage.setItem(
                draftKey(tradeFromUrl),
                JSON.stringify({
                    businessName, description, contactEmail, contactPhone,
                    prices, extras, calloutFee, hourlyRate, areas,
                    doesGas, doesOil, registrations, calloutWaived, skills,
                    // Photos and the logo are storage paths, not files — they
                    // are already uploaded by this point, so the path is the
                    // whole of what there is to keep. Leaving them out meant
                    // somebody who uploaded four photos and then went to sign
                    // in came back to none of them, with the files sitting in
                    // the bucket.
                    photos, logo, buildingType, panes,
                })
            );
        } catch (err) {
            /* storage full or blocked — the form still works */
        }
    }, [
        hydrated, providerId, tradeFromUrl,
        businessName, description, contactEmail, contactPhone,
        prices, extras, calloutFee, hourlyRate, areas,
        doesGas, doesOil, registrations, calloutWaived, skills,
        photos, logo, buildingType, panes,
    ]);

    // Which registration boxes this application shows at all. An electrician
    // always sees the Part P schemes; a plumber sees Gas Safe or OFTEC only
    // once they have said they do that work; nobody else sees any of it.
    const showableSchemes = offerableSchemes({ trade, does_gas: doesGas, does_oil: doesOil });

    const registrationRows = showableSchemes.map((scheme) => ({
        scheme,
        number: registrations[scheme] || '',
    }));

    const problems = submitProblems({
        business_name: businessName,
        trade,
        description,
        contact_email: contactEmail,
        audience: audienceForTrade(trade),
        areaCount: areas.length,
        prices,
        callout_fee: calloutFee,
        hourly_rate: hourlyRate,
        callout_waived: calloutWaived,
        extras,
        does_gas: doesGas,
        does_oil: doesOil,
        registrations: registrationRows,
    });

    // One block of £ boxes for a pricing structure. Nothing computes from
    // these yet — they are on the page so real window cleaners can say which
    // shape they actually use before one is picked for them.
    const priceRows = (group: string) =>
        extrasIn(group).map((extra) => {
            const entry = extraOf(extra.key);
            return (
                <div key={extra.key} className="flex items-center gap-3">
                    <label
                        htmlFor={'rate-' + extra.key}
                        className="w-40 md:w-28 shrink-0 text-sm font-medium text-slate-900"
                    >
                        {extra.label}
                    </label>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-slate-500">&pound;</span>
                        <input
                            id={'rate-' + extra.key}
                            type="text"
                            inputMode="decimal"
                            value={entry.price}
                            onChange={(e) => setExtra(extra.key, 'price', e.target.value)}
                            placeholder="Leave blank"
                            className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                        {extra.unit === 'each' && (
                            <span className="text-sm text-slate-500 whitespace-nowrap">per pane</span>
                        )}
                    </div>
                </div>
            );
        });

    const TradeIcon = TRADE_ICONS[trade] || Sparkles;
    const model = pricingModelFor(trade);
    const tradeExtras = extrasFor(trade);
    const offerings = offeringsFor(trade);
    const extrasIn = (group: string) => tradeExtras.filter((e) => e.group === group);
    // Every group that asks a question before showing its prices. Laundry and
    // hot tubs both do; the mechanism is the group's, not either of theirs.
    const gatedGroups = EXTRA_GROUPS.filter(
        (g: any) => g.gate && !isPricingGroup(g.key) && extrasIn(g.key).length > 0
    );

    const extraOf = (key: string) => extras[key] || { offered: false, price: '', notes: '' };
    const setExtra = (key: string, field: 'offered' | 'price' | 'notes', value: any) =>
        setExtras((prev) => ({
            ...prev,
            [key]: Object.assign({ offered: false, price: '', notes: '' }, prev[key] || {}, { [field]: value }),
        }));

    // One headed block of tick boxes.
    //
    // The maintenance trades answer three questions rather than one — what has
    // gone wrong, what you can do, and how fast you turn out — and each gets
    // its own heading so the urgent list is a list rather than a subtitle
    // under something else. The older trades have a single unheaded block and
    // pass '' as the heading.
    const toggleBlock = (group: string, heading: string) => {
        const items = extrasIn(group);
        if (items.length === 0) return null;

        // Availability is three questions and will stay three — same day, out
        // of hours, and winter for empty properties is the whole of it. In two
        // columns that leaves a hole, and the only way to fill it would be to
        // invent a fourth. One column instead: the block is short, and the
        // gap was the only thing wrong with it.
        const oneColumn = group === 'availability';

        return (
            <div className="mb-6">
                {heading && (
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5">
                        {heading}
                    </h3>
                )}
                <div className={oneColumn
                    ? 'space-y-2'
                    : 'space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-3'}>
                    {items.map((extra) => (
                        <label
                            key={extra.key}
                            className="flex items-start gap-3 rounded-xl border border-slate-300 p-3.5 cursor-pointer hover:border-slate-400 transition"
                        >
                            <input
                                type="checkbox"
                                checked={extraOf(extra.key).offered}
                                onChange={(e) => setExtra(extra.key, 'offered', e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                            />
                            <span>
                                <span className="block text-sm font-medium text-slate-900">{extra.label}</span>
                                {extra.hint && (
                                    <span className="block text-sm text-slate-500 mt-0.5">{extra.hint}</span>
                                )}
                            </span>
                        </label>
                    ))}
                </div>
            </div>
        );
    };

    const groupLabel = (key: string) => {
        const found = EXTRA_GROUPS.filter((g: any) => g.key === key)[0] as any;
        return (found && found.label) || '';
    };

    // Whether this trade uses the three-way split. Drives the wording at the
    // top of the section, which is about comparison for a cleaner and about
    // being found for a plumber.
    const hasFaults = extrasIn('faults').length > 0;

    // The maintenance trades, however they charge. A guest-side quoted trade —
    // a chef, a cake — has no call-out fee and no rates section at all.
    const isCallout = model === 'callout_hourly' || (model === 'quoted' && groupForTrade(trade) !== null);

    const hasSkills = asksAboutSkills(trade);

    const skillSuggestions = suggestSkills(allSkills, skillTyped, skills);
    const skillIsNew = wouldCreateNew(allSkills, skillTyped);

    const addSkill = (label: string) => {
        const key = skillKey(label);
        if (!key) return;

        // Compared on the normalised form, so somebody cannot add
        // "Bricklaying" to a list that already has "bricklaying".
        const held = skills.map((x) => (skillKey(x) || { compact: '' }).compact);
        if (held.indexOf(key.compact) === -1) setSkills([...skills, key.label]);

        setSkillTyped('');
    };

    // What a tag needs, whether it came off the list or was typed. An existing
    // tag carries its concept; a brand new one is matched on the words.
    const conceptOf = (label: string): string | null => {
        const key = skillKey(label);
        if (!key) return null;

        const known = allSkills.filter((x: any) => String(x.slug || '') === key.slug)[0];
        if (known) return known.regulated_concept || null;

        return regulatedConceptFor(key.slug);
    };

    // Whether THIS trade is ever asked for that registration. A handyman is
    // asked for none of them, which is exactly why the message has to route
    // rather than say "add your number" — there is no field here to add it to.
    const asksForConcept = (concept: string | null): boolean => {
        if (concept === 'electrical') return trade === 'electrician';
        if (concept === 'gas' || concept === 'oil') return asksAboutFuel(trade);
        return false;
    };

    const reasonFor = (label: string): string | null => {
        const concept = conceptOf(label);
        if (!concept) return null;
        if (asksForConcept(concept) && registrations[schemesSatisfying(concept as any)[0]]) return null;

        return blockedSkillReason(
            { label: (skillKey(label) || { label }).label, regulated_concept: concept },
            tradeLabel(trade).toLowerCase(),
            asksForConcept(concept)
        );
    };

    // Tags they are holding that will not appear. Not a scolding — mostly it
    // is somebody who does the work and cannot prove it here.
    const blockedHeld = skills
        .map((label) => ({ label, reason: reasonFor(label) }))
        .filter((x) => x.reason);

    const typedConcept = conceptOf(skillTyped);
    const typedReason = skillTyped.trim() === '' ? null : reasonFor(skillTyped);

    const bands = bandsFor(trade);

    const setBand = (key: string, field: 'price' | 'typical_hours', value: string) =>
        setPrices((prev) => ({
            ...prev,
            [key]: Object.assign({ price: '', typical_hours: '' }, prev[key] || {}, { [field]: value }),
        }));

    const problemFor = (field: string) =>
        touchedSubmit ? (problems.filter((p) => p.field === field)[0] || null) : null;

    const addPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (!files.length || !session) return;

        setProcessingPhotos(true);

        for (const file of files) {
            try {
                const ready = await compressImage(file);
                const path = 'providers/' + session.user.id + '-' + Date.now() + '_' + generateRandomNumber() + '.jpg';

                const { error } = await supabase.storage
                    .from(Env.S3_BUCKET)
                    .upload(path, ready, { contentType: 'image/jpeg' });

                if (error) {
                    toast.error(error.message, { theme: 'colored' });
                } else {
                    setPhotos((prev) => [...prev, path]);
                }
            } catch (err) {
                toast.error('That photo could not be read. Try a different one.', { theme: 'colored' });
            }
        }

        setProcessingPhotos(false);
    };

    // One row per circle. The town carries the coordinates, so a tradesperson
    // picks a place and a distance rather than a latitude.
    const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        if (!file) return;

        // The bucket will not take a file from somebody with no account, and
        // a silent nothing looks like a broken button.
        if (!session) {
            toast.info('Make an account first and you can add your logo — everything else is kept.', {
                theme: 'colored',
            });
            e.target.value = '';
            return;
        }

        setUploadingLogo(true);

        try {
            const ready = await compressImage(file);
            const path = 'providers/logo-' + session.user.id + '-' + Date.now() + '.jpg';

            const { error } = await supabase.storage
                .from(Env.S3_BUCKET)
                .upload(path, ready, { contentType: 'image/jpeg' });

            if (error) {
                toast.error(error.message, { theme: 'colored' });
            } else {
                setLogo(path);
            }
        } catch (err) {
            toast.error('That image could not be read. Try a different one.', { theme: 'colored' });
        }

        setUploadingLogo(false);
        // So the same file can be chosen again after a failure.
        e.target.value = '';
    };

    // Removing a draft. Drafts only: an application we are looking at, or a
    // business already on the site, is not something to throw away with a
    // button — those come off through us.
    //
    // This is also the answer to picking the wrong trade. One business per
    // trade means the "change" link makes a second application rather than
    // converting the first, so the way to undo a wrong pick is to remove the
    // draft it left behind.
    const removeDraft = async () => {
        if (!providerId || status !== 'draft') return;

        setRemoving(true);

        // The status is matched at the write as well as checked here, so a
        // stale screen cannot delete something that has since been sent.
        const { error } = await supabase
            .from('service_providers')
            .delete()
            .eq('id', providerId)
            .eq('status', 'draft');

        setRemoving(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        toast.success('Removed.', { theme: 'colored' });
        router.push('/services/join');
    };

    const addArea = () => {
        const used = areas.map((a) => a.town);
        const next = COVERAGE_TOWNS.filter((t) => used.indexOf(t.label) === -1)[0];
        if (!next) return;
        setAreas((prev) => [...prev, { town: next.label, radius_miles: 10 }]);
    };

    // Making the account out of what they have already typed.
    //
    // Their contact email is the account email: asking for a second address at
    // the end of a form that already has one is asking a question we know the
    // answer to. The password is the only new thing, and the tick box is the
    // consent — an account should not appear because somebody pressed Save.
    const createAccount = async (): Promise<any> => {
        const email = contactEmail.trim();

        if (!email || email.indexOf('@') === -1) {
            setAcctError('Add an email address above — that is the one your account will use.');
            return null;
        }

        if (acctPassword.length < 8) {
            setAcctError('Pick a password of at least 8 characters.');
            return null;
        }

        if (!acctConsent) {
            setAcctError('Tick the box and we will make your account.');
            return null;
        }

        setAcctBusy(true);
        setAcctError('');

        try {
            // signUp returns Supabase's own errors but THROWS anything else —
            // a dropped connection, a 5xx, a CORS refusal. Without this catch
            // the throw escapes and the button sits there having said nothing.
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: acctPassword,
                options: {
                    data: { name: businessName.trim() },
                    // Straight back to this form, with the trade, so a
                    // confirmed address lands on the thing they were doing
                    // rather than on the home page.
                    emailRedirectTo: window.location.origin
                        + '/auth/callback?next='
                        + encodeURIComponent('/services/join/apply?trade=' + tradeFromUrl),
                },
            });

            setAcctBusy(false);

            if (error) {
                const message = String(error.message || '');
                setAcctError(
                    /already/i.test(message)
                        ? 'There is already an account on that address. Sign in below and we will save this to it.'
                        : message || 'That did not work.'
                );
                if (/already/i.test(message)) setShowSignIn(true);
                return null;
            }

            // With email confirmation switched on, signUp returns a user and
            // NO session — so nothing can be written yet. The form is already
            // in local storage and the link comes back here, so this is a
            // pause rather than a loss, but it has to be SAID: silently doing
            // nothing looks exactly like a broken button.
            if (!data.session) {
                setCheckYourEmail(true);
                return null;
            }

            await supabase.from('profiles').upsert(
                {
                    id: data.session.user.id,
                    email: email,
                    full_name: businessName.trim(),
                    is_host: false,
                },
                { onConflict: 'id' }
            );

            setSession(data.session);
            return data.session;
        } catch (err: any) {
            setAcctBusy(false);
            setAcctError('Something went wrong making your account. Try again.');
            return null;
        }
    };

    const save = async (submit: boolean) => {
        let active: any = session;

        // No detour. The details they have entered make the account, and the
        // same press that makes it saves the form — rather than sending
        // somebody who has just filled in twenty fields off to register
        // elsewhere and hope their work is still here when they get back.
        //
        // What they typed is in local storage on every keystroke regardless,
        // so any route out of this page is survivable.
        if (!session) {
            setWantsToSave(submit);
            if (submit) setTouchedSubmit(true);

            // Still gate on the form being right. Making an account for
            // somebody whose application cannot be sent is the worst order to
            // do these two things in.
            if (submit && problems.length) {
                toast.error('A few things still need filling in.', { theme: 'colored' });
                return;
            }

            const made = await createAccount();
            if (!made) return;

            // Carried in a local rather than read back off state: setSession
            // does not take effect until the next render, and everything below
            // needs the id NOW. Reading `session` here would be null and the
            // save would fall over on the press that was supposed to work.
            active = made;
        }

        if (submit) {
            setTouchedSubmit(true);
            if (problems.length) {
                toast.error('A few things still need filling in.', { theme: 'colored' });
                return;
            }
        }

        setSaving(true);

        const now = new Date();

        const payload: any = {
            owner_id: active.user.id,
            business_name: businessName.trim(),
            trade,
            description: description.trim(),
            contact_email: contactEmail.trim(),
            contact_phone: contactPhone.trim() || null,
            audience: audienceForTrade(trade),
            photos,
            logo,
            does_gas: asksAboutFuel(trade) ? doesGas : false,
            does_oil: asksAboutFuel(trade) ? doesOil : false,
            // A call-out fee is optional on both models — a roofer who turns
            // out for a leak charges one even though the re-slate is quoted.
            // The hourly rate belongs only to the trades that actually bill by
            // the hour, and is cleared otherwise so a provider who switches
            // trade does not carry a stale rate.
            callout_fee: calloutFee.trim() !== '' ? Number(calloutFee) : null,
            hourly_rate: model === 'callout_hourly' && hourlyRate.trim() !== '' ? Number(hourlyRate) : null,
            callout_waived: calloutFee.trim() !== '' ? calloutWaived : false,
            updated_at: now.toISOString(),
        };

        // What this does to the status fields is decided in lib, not here, so
        // that the rule can be tested: an approved provider is never knocked
        // back into the queue by their own edit.
        if (submit) {
            Object.assign(payload, submitStatusPatch(status, now));
        }

        let id = providerId;

        // They may already have a business in this trade — a second tab, or an
        // application started months ago. One per trade is a constraint, so
        // find it rather than collide.
        if (!id) {
            const { data: already } = await supabase
                .from('service_providers')
                .select('id')
                .eq('owner_id', active.user.id)
                .eq('trade', trade)
                .maybeSingle();
            if (already) {
                id = already.id;
                setProviderId(already.id);
            }
        }

        if (id) {
            const { error } = await supabase.from('service_providers').update(payload).eq('id', id);
            if (error) {
                setSaving(false);
                toast.error(error.message, { theme: 'colored' });
                return;
            }
        } else {
            const { data, error } = await supabase
                .from('service_providers')
                .insert(payload)
                .select('id')
                .single();

            if (error || !data) {
                setSaving(false);
                toast.error((error && error.message) || 'Could not save that.', { theme: 'colored' });
                return;
            }
            id = data.id;
            setProviderId(id);
        }

        // Registrations are NOT replaced wholesale, unlike everything below.
        //
        // Deleting and re-inserting would throw away `verified_at` on every
        // save — a Gas Safe number checked in March would go back to unchecked
        // because they fixed a typo in their description in June. So each row
        // is written only when its number has actually changed, which is also
        // exactly when the check should be thrown away.
        //
        // The verified columns are not sent at all. They cannot be: they are
        // revoked from `authenticated` in 20260826_trade_registration.sql, so
        // a payload mentioning one would be refused rather than trusted.
        {
            const { data: haveRegs } = await supabase
                .from('service_provider_registrations')
                .select('scheme, number')
                .eq('provider_id', id);

            const wanted = showableSchemes
                .map((scheme) => ({ scheme, number: String(registrations[scheme] || '').trim() }))
                .filter((r) => r.number !== '');

            const wantedSchemes = wanted.map((r) => r.scheme);

            // A plumber who has stopped doing oil takes the OFTEC row off, and
            // with it the record that it was ever checked. That is right: they
            // are no longer claiming it.
            const goners = (haveRegs || [])
                .filter((r: any) => wantedSchemes.indexOf(String(r.scheme)) === -1)
                .map((r: any) => String(r.scheme));

            if (goners.length) {
                await supabase
                    .from('service_provider_registrations')
                    .delete()
                    .eq('provider_id', id)
                    .in('scheme', goners);
            }

            for (const row of wanted) {
                const before = (haveRegs || []).filter((r: any) => String(r.scheme) === row.scheme)[0];

                if (!before) {
                    await supabase.from('service_provider_registrations').insert({
                        provider_id: id,
                        scheme: row.scheme,
                        number: row.number,
                        updated_at: now.toISOString(),
                    });
                } else if (String(before.number || '').trim() !== row.number) {
                    await supabase
                        .from('service_provider_registrations')
                        .update({ number: row.number, updated_at: now.toISOString() })
                        .eq('provider_id', id)
                        .eq('scheme', row.scheme);
                }
            }
        }

        // Extras are replaced wholesale, like the prices and the areas. Only
        // what is offered is written — a row that is not there is a no.
        await supabase.from('service_provider_extras').delete().eq('provider_id', id);

        const extraRows = tradeExtras
            .filter((extra) => {
                const entry = extraOf(extra.key);
                // A priced extra says yes by having a price. Nothing else to
                // agree or disagree with, and a blank is a no.
                if (extra.type === 'priced') {
                    return String(entry.price).trim() !== '' && Number(entry.price) > 0;
                }
                return entry.offered;
            })
            .map((extra) => {
                const entry = extraOf(extra.key);
                const priced = extra.type === 'priced' && String(entry.price).trim() !== '' && Number(entry.price) > 0;
                return {
                    provider_id: id,
                    extra_key: extra.key,
                    offered: true,
                    // Null for a toggle, and null for a reimbursed one: the
                    // amount is whatever the receipt says, weeks later. It is
                    // paid host to provider directly and never through us.
                    price: priced ? Number(entry.price) : null,
                    notes: String(entry.notes || '').trim() || null,
                    updated_at: now.toISOString(),
                };
            });

        if (extraRows.length) {
            await supabase.from('service_provider_extras').insert(extraRows);
        }

        // Prices are replaced wholesale, like the areas. A row that is not
        // there is the blank band, and a blank band is a real answer — it means
        // "I do not cover that size" and keeps them out of results for it.
        await supabase.from('service_provider_prices').delete().eq('provider_id', id);

        if (model === 'bands') {
            const priceRows = bandsFor(trade)
                .filter((band) => {
                    const entry = prices[band.key];
                    return entry && String(entry.price).trim() !== '' && Number(entry.price) > 0;
                })
                .map((band) => {
                    const entry = prices[band.key];
                    const hours = String(entry.typical_hours || '').trim();
                    return {
                        provider_id: id,
                        band_key: band.key,
                        price: Number(entry.price),
                        // Stored as hours, never a rate, and never multiplied
                        // by anything. See tests/service-pricing.test.ts.
                        typical_hours: hours === '' || !(Number(hours) > 0) ? null : Number(hours),
                        updated_at: now.toISOString(),
                    };
                });

            if (priceRows.length) {
                await supabase.from('service_provider_prices').insert(priceRows);
            }
        }

        // Areas are replaced wholesale — there are only ever a handful, and
        // diffing them would be more code than it saves.
        await supabase.from('service_areas').delete().eq('provider_id', id);

        if (areas.length) {
            const rows = areas.map((a) => {
                const town = COVERAGE_TOWNS.filter((t) => t.label === a.town)[0];
                return {
                    provider_id: id,
                    label: a.town,
                    centre_lat: town ? town.lat : 0,
                    centre_lng: town ? town.lng : 0,
                    radius_miles: a.radius_miles,
                };
            });
            await supabase.from('service_areas').insert(rows);
        }

        // Skills go through a route rather than being written from here.
        //
        // Not for convenience: `regulated_concept` is what stops a handyman
        // tagging "boiler repair" and reading to a host as somebody who can
        // touch a boiler, and a provider able to write their own skill row
        // could set it to null. Neither skills table is writable by
        // `authenticated` at all.
        //
        // Failures are surfaced, unlike the alert below — a tag that silently
        // did not save is one they think is on their profile.
        if (hasSkills) {
            try {
                const skillRes = await fetch('/api/services/skills', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ providerId: id, labels: skills }),
                });

                if (!skillRes.ok) {
                    toast.warning('Your details saved, but the skills did not. Try that part again.',
                        { theme: 'colored' });
                }
            } catch (err) {
                toast.warning('Your details saved, but the skills did not. Try that part again.',
                    { theme: 'colored' });
            }
        }

        // Told last, once the row and its areas are both written, so the
        // email describes what was actually saved rather than what was about
        // to be. It cannot email us itself — lib/email holds the API key and
        // must never reach the browser — so a route does it.
        //
        // Nothing here is shown to them if it fails. They have done their
        // part; a problem reaching us is ours, and the route logs it.
        if (submit || status === 'approved') {
            try {
                await fetch('/api/services/submitted', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id }),
                });
            } catch (err) {
                // Deliberately swallowed — see above.
            }
        }

        forgetDraft();
        setRestored(false);

        setSaving(false);

        if (submit && status === 'approved') {
            toast.success('Saved. You are still live.', { theme: 'colored' });
        } else if (submit) {
            setStatus('pending_review');
            toast.success('Sent to us for review.', { theme: 'colored' });
        } else {
            toast.success('Saved.', { theme: 'colored' });
        }
    };

    // Signed in after pressing a button that needed it: carry on where they
    // left off rather than making them find the button again.
    useEffect(() => {
        if (session && wantsToSave !== null && !saving) {
            const submit = wantsToSave;
            setWantsToSave(null);
            save(submit);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, wantsToSave]);

    if (loading) {
        return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>;
    }

    const summary = statusSummary(status);
    const locked = status === 'pending_review';

    return (
        <div className="max-w-3xl md:max-w-4xl mx-auto px-4 sm:px-6 py-10 pb-24">
            {/* The "Change" link beside the trade is easy to miss; somebody who
                picked wrong should not have to hunt for the way out. */}
            <Link
                href="/services/join?change=1"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 mb-6"
            >
                <ChevronLeft className="w-4 h-4" />
                Back
            </Link>

            {/* Read by a tradesperson deciding whether to sign up, not by a
                host looking for one — so it says what they get, not what we
                sell. "List your business" also stays true once they are live
                and have come back to change something, which "Apply to be
                listed" would not.

                The old line listed the trades, which meant it had to be edited
                every time the list moved and was wrong the moment it was not.
                The trade they picked is on the card below anyway. */}
            <h1 className="text-3xl font-bold text-slate-900">List your business</h1>
            <p className="text-slate-600 mt-2 mb-8">
                Get work from holiday lets across Dumfries &amp; Galloway.
            </p>

            {/* Sent, and waiting on us. */}
            {status === 'pending_review' && (
                <div className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-5">
                    <p className="font-semibold text-amber-900">{summary.label}</p>
                    <p className="text-sm text-amber-900/80 mt-1">
                        Thanks — we check every business before it appears, usually within {REVIEW_WITHIN_HOURS} hours.
                        We will email you either way. You can still read what you sent below.
                    </p>
                </div>
            )}

            {status === 'declined' && (
                <div className="mb-8 rounded-2xl border border-rose-300 bg-rose-50 p-5">
                    <p className="font-semibold text-rose-900">{summary.label}</p>

                    {/* What we said is quoted, on its own, so it cannot run
                        into our own sentence and read as one broken line. A
                        reason can be a single word, and "no" followed by
                        "Change what you need to" looked like a mistake. */}
                    {reviewNote ? (
                        <blockquote className="mt-3 rounded-r-lg border-l-4 border-rose-400 bg-white/70 px-4 py-3">
                            <p className="text-sm text-rose-900 whitespace-pre-line">{reviewNote}</p>
                        </blockquote>
                    ) : (
                        <p className="text-sm text-rose-900/80 mt-3">
                            We could not approve this as it stands.
                        </p>
                    )}

                    <p className="text-sm text-rose-900/80 mt-3">
                        Change what you need to and send it again.
                    </p>
                </div>
            )}

            {status === 'approved' && (
                <div className="mb-8 rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
                    <p className="font-semibold text-emerald-900">{summary.label}</p>
                    <p className="text-sm text-emerald-900/80 mt-1">{summary.detail}</p>
                </div>
            )}

            <fieldset disabled={locked} className={locked ? 'opacity-70' : ''}>
                <div className="md:grid md:grid-cols-2 md:gap-8 md:items-start">
                    <section className="mb-8">
                        <label className="block text-sm font-semibold text-slate-900 mb-1.5">Business name</label>
                        <input
                            type="text"
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            placeholder="Solway Sparkle"
                            className="w-full md:max-w-sm rounded-xl border border-slate-300 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                        {problemFor('business_name') && (
                            <p className="text-sm text-rose-700 mt-1.5">{problemFor('business_name')!.message}</p>
                        )}
                    </section>

                {imageryFor(trade) === 'logo' ? (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your logo</h2>
                        <p className="text-sm text-slate-500 mb-3">
                            Optional. If you have not got one we will show your initials.
                            {!session && ' You can add one once you have an account.'}
                        </p>

                        <div className="flex items-center gap-4">
                            <div className="w-20 h-20 shrink-0 rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center text-xl font-semibold">
                                {logo ? (
                                    <img src={getImageUrl(logo)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    initialsFor(businessName) || <Sparkles className="w-6 h-6" strokeWidth={1.5} />
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <label className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-2.5 cursor-pointer text-sm text-slate-600 hover:border-slate-400">
                                    <Plus className="w-4 h-4" />
                                    {uploadingLogo ? 'Uploading…' : logo ? 'Replace' : 'Add a logo'}
                                    <input
                                        type="file"
                                        accept="image/png, image/jpeg"
                                        onChange={uploadLogo}
                                        className="hidden"
                                        disabled={uploadingLogo}
                                    />
                                </label>

                                {logo && (
                                    <button
                                        type="button"
                                        onClick={() => setLogo(null)}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-600 hover:border-slate-500"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                        Remove
                                    </button>
                                )}
                            </div>
                        </div>
                    </section>
                ) : (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-3">Photos of your work</h2>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            {photos.map((p) => (
                                <div key={p} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100">
                                    <img src={getImageUrl(p)} alt="" className="w-full h-full object-cover" />
                                    <button
                                        type="button"
                                        onClick={() => setPhotos((prev) => prev.filter((x) => x !== p))}
                                        aria-label="Remove photo"
                                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <label className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 cursor-pointer text-sm text-slate-600 hover:border-slate-400">
                            <Plus className="w-4 h-4" />
                            {processingPhotos ? 'Preparing your photos…' : 'Add photos'}
                            <input type="file" accept="image/png, image/jpeg" multiple onChange={addPhotos} className="hidden" disabled={processingPhotos} />
                        </label>
                    </section>
                )}
                </div>

                {/* What they picked on the way in. A label, not a control:
                    the Back button at the top of the page returns to the
                    picker, and two ways to do the same thing is one too many —
                    the second one only makes somebody wonder what the
                    difference is. */}
                <section className="mb-8">
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <TradeIcon className="w-5 h-5 text-emerald-700 shrink-0" strokeWidth={1.5} />
                        <span className="text-sm font-semibold text-slate-900 truncate">{tradeLabel(trade)}</span>
                    </div>
                </section>

                <section className="mb-8">
                    <label className="block text-sm font-semibold text-slate-900 mb-1.5">About your business</label>
                    {/* Capped to a measure rather than the window: past about
                        70 characters a line is harder to read, not easier. */}
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={5}
                        placeholder="What do you offer? Describe your business."
                        className="w-full md:max-w-xl rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    {problemFor('description') && (
                        <p className="text-sm text-rose-700 mt-1.5">{problemFor('description')!.message}</p>
                    )}
                </section>

                {/* Facts about the property, not about the provider — a
                    window cleaner does not have a building type. They are here
                    so that real window cleaners can see what they will be told
                    before they quote, and they move to the owner's side once
                    that is built.

                    Deliberately not saved anywhere: there is no column for
                    them on a provider and there should not be one, so the
                    panel says so rather than quietly losing what is typed. */}
                {trade === 'droplet' && (
                    <section className="mb-8">
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                            <div className="flex items-start justify-between gap-3 mb-1">
                                <h2 className="text-sm font-semibold text-slate-900">About the property</h2>
                                <span className="shrink-0 text-xs font-semibold text-slate-500 bg-slate-200 rounded-full px-2.5 py-1">
                                    Preview
                                </span>
                            </div>
                            <p className="text-sm text-slate-500 mb-5">
                                The owner will answer these, not you. Shown here so you can see what you
                                will be given before you price a job. Nothing here is saved yet.
                            </p>

                            {/* Not two equal halves: the pane count is a ten-rem box and the
                                building types are four short words that want one line.
                                An even split gave the buttons 416px when they need 463,
                                so the last one wrapped with space beside it. */}
                            <div className="md:grid md:grid-cols-[1fr_auto] md:gap-6 md:items-start">
                            <div className="mb-5 md:mb-0">
                                <div className="text-sm font-semibold text-slate-900 mb-2">What kind of building</div>
                                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                                    {BUILDING_TYPES.map((b) => {
                                        const on = buildingType === b.key;
                                        return (
                                            <button
                                                key={b.key}
                                                type="button"
                                                onClick={() => setBuildingType(on ? '' : b.key)}
                                                aria-pressed={on}
                                                className={`rounded-xl border px-3 py-2.5 text-sm text-left transition ${
                                                    on
                                                        ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50 text-slate-900'
                                                        : 'border-slate-300 text-slate-700 hover:border-slate-400 bg-white'
                                                }`}
                                            >
                                                {b.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label htmlFor="panes" className="block text-sm font-semibold text-slate-900 mb-2">
                                    Number of panes
                                </label>
                                <input
                                    id="panes"
                                    type="text"
                                    inputMode="numeric"
                                    value={panes}
                                    onChange={(e) => setPanes(e.target.value)}
                                    placeholder="24"
                                    className="w-full sm:max-w-[10rem] rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                />
                            </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* What they charge. Driven by the trade rather than by a
                    choice, so two cleaners are always comparable and a host is
                    never asked to weigh a price against a rate. */}
                {model === 'bands' && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your prices</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            Leave blank any size you do not cover.
                        </p>

                        <div className="space-y-3 md:space-y-0 md:grid md:grid-cols-3 md:gap-4">
                            {bands.map((band) => {
                                const entry = prices[band.key] || { price: '', typical_hours: '' };
                                const priceProblem = problemFor('price_' + band.key);
                                const hoursProblem = problemFor('hours_' + band.key);

                                return (
                                    <div key={band.key} className="rounded-xl border border-slate-300 p-3.5">
                                        <div className="text-sm font-medium text-slate-900 mb-2.5">{band.label}</div>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Price per visit</label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-slate-500">&pound;</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={entry.price}
                                                    onChange={(e) => setBand(band.key, 'price', e.target.value)}
                                                    placeholder="Leave blank if you do not cover this"
                                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                />
                                            </div>
                                            {priceProblem && (
                                                <p className="text-xs text-rose-700 mt-1">{priceProblem.message}</p>
                                            )}

                                            {/* Optional, and the single biggest
                                                thing on the page for the least
                                                it does — so it is a link until
                                                somebody wants it. */}
                                            {!showsTimeGuide(trade) ? null : hoursOpen[band.key] ? (
                                                <div className="mt-2.5">
                                                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                                                        Usually takes
                                                    </label>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={entry.typical_hours}
                                                            onChange={(e) => setBand(band.key, 'typical_hours', e.target.value)}
                                                            placeholder="2"
                                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                        />
                                                        <span className="text-sm text-slate-500 whitespace-nowrap">hours</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setBand(band.key, 'typical_hours', '');
                                                                setHoursOpen((prev) => ({ ...prev, [band.key]: false }));
                                                            }}
                                                            aria-label="Remove the time guide"
                                                            className="shrink-0 w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-500"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    {hoursProblem && (
                                                        <p className="text-xs text-rose-700 mt-1">{hoursProblem.message}</p>
                                                    )}
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setHoursOpen((prev) => ({ ...prev, [band.key]: true }))}
                                                    className="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline"
                                                >
                                                    Add a time guide
                                                </button>
                                            )}
                                        </div>

                                        {entry.price && Number(entry.price) > 0 && (
                                            <p className="text-xs text-slate-500 mt-2.5">
                                                Shows as &ldquo;&pound;{entry.price} per visit
                                                {entry.typical_hours && Number(entry.typical_hours) > 0
                                                    ? ', usually about ' + entry.typical_hours + ' hours'
                                                    : ''}
                                                &rdquo;
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {problemFor('prices') && (
                            <p className="text-sm text-rose-700 mt-2">{problemFor('prices')!.message}</p>
                        )}

                        {/* Beside the number it governs, not a section away.
                            This is the one a provider will argue about later. */}
                        <p className="text-sm text-slate-600 mt-3">
                            <strong className="font-semibold text-slate-900">Your price is the most you can charge.</strong>
                        </p>

                    </section>
                )}

                {trade === 'droplet' && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Other ways to price</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            Fill in whichever you actually use and leave the rest blank. We are asking
                            window cleaners which of these fits before we settle on one.
                        </p>

                        <div className="space-y-4 md:space-y-0 md:grid md:grid-cols-2 md:gap-4 md:items-start">
                            <div className="rounded-xl border border-slate-300 p-4">
                                <h3 className="text-sm font-semibold text-slate-900 mb-3">
                                    Call-out plus a rate per pane
                                </h3>
                                <div className="space-y-2.5">{priceRows('pane_flat')}</div>
                            </div>

                            <div className="rounded-xl border border-slate-300 p-4">
                                <h3 className="text-sm font-semibold text-slate-900 mb-1">
                                    A rate per pane, by storey
                                </h3>
                                <p className="text-sm text-slate-500 mb-3">
                                    For where the ladder work is what costs.
                                </p>
                                <div className="space-y-2.5">{priceRows('pane_storey')}</div>
                            </div>

                        </div>
                    </section>
                )}

                {/* Rates, for the trades that cannot be sized in advance.
                    Two shapes behind one section:

                      callout_hourly  turn up, diagnose, charge for the time.
                      quoted          look at it, then say what it costs.

                    The quoted trades used to be asked for an hourly rate as
                    well, which no roofer has for a re-slate — so the number
                    would have been invented to get past the form, and an
                    invented number is one a host can hold them to. */}
                {isCallout && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your rates</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            {model === 'callout_hourly'
                                ? 'A repair cannot be sized in advance, so this is an hourly rate — with a call-out fee on top if you charge one — rather than a price per property size.'
                                : 'This work is quoted once you have seen it, so there is nothing to set here beyond a call-out fee if you charge one.'}
                        </p>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div>
                                {/* Optional on both models, so the label says
                                    so on both. It read as required for the
                                    hourly trades while behaving optional,
                                    which is the worst of the three. */}
                                <label className="block text-xs font-semibold text-slate-500 mb-1">
                                    Call-out fee
                                    <span className="font-normal text-slate-400"> (optional)</span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">&pound;</span>
                                    {/* No placeholder and no suggested amount.
                                        If every roofer showed the same figure
                                        it would read as a platform charge
                                        rather than as their own price. */}
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={calloutFee}
                                        onChange={(e) => setCalloutFee(e.target.value)}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                    />
                                </div>
                                {problemFor('callout_fee') && (
                                    <p className="text-xs text-rose-700 mt-1">{problemFor('callout_fee')!.message}</p>
                                )}

                                {/* Their offer, not our rule. Only worth asking
                                    once there is a fee for it to apply to. */}
                                {calloutFee.trim() !== '' && (
                                    <label className="flex items-start gap-2.5 mt-2.5 text-sm text-slate-800">
                                        <input
                                            type="checkbox"
                                            checked={calloutWaived}
                                            onChange={(e) => setCalloutWaived(e.target.checked)}
                                            className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                                        />
                                        <span>
                                            Waived if the job goes ahead
                                            {calloutLine(calloutFee, calloutWaived) && (
                                                <span className="block text-slate-500">
                                                    Owners will see &ldquo;{calloutLine(calloutFee, calloutWaived)}&rdquo;.
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                )}
                            </div>

                            {model === 'callout_hourly' && (
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Hourly rate</label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-slate-500">&pound;</span>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={hourlyRate}
                                            onChange={(e) => setHourlyRate(e.target.value)}
                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                        />
                                    </div>
                                    {problemFor('hourly_rate') && (
                                        <p className="text-xs text-rose-700 mt-1">{problemFor('hourly_rate')!.message}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>
                )}

                {/* Registration. Above the extras rather than among them,
                    because it is not something they offer — it is what decides
                    whether the listing may go up at all.

                    An owner sees the answer on the listing, not after asking:
                    somebody with a dead boiler needs to know which plumbers
                    can legally touch it before they pick up the phone. */}
                {(asksAboutFuel(trade) || trade === 'electrician') && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">
                            Registration
                        </h2>
                        <p className="text-sm text-slate-500 mb-4">
                            We check this before you go live, and owners can see it on your listing.
                        </p>

                        {asksAboutFuel(trade) && (
                            <div className="space-y-2 mb-4">
                                <label className="flex items-start gap-2.5 text-sm text-slate-800">
                                    <input
                                        type="checkbox"
                                        checked={doesGas}
                                        onChange={(e) => setDoesGas(e.target.checked)}
                                        className="mt-0.5 w-4 h-4 rounded border-slate-300"
                                    />
                                    <span>
                                        Gas Safe registered
                                        <span className="block text-slate-500">
                                            Boilers, hobs and fires on mains gas or LPG.
                                        </span>
                                    </span>
                                </label>

                                <label className="flex items-start gap-2.5 text-sm text-slate-800">
                                    <input
                                        type="checkbox"
                                        checked={doesOil}
                                        onChange={(e) => setDoesOil(e.target.checked)}
                                        className="mt-0.5 w-4 h-4 rounded border-slate-300"
                                    />
                                    <span>
                                        OFTEC registered
                                        <span className="block text-slate-500">
                                            Oil boilers, burners and tanks.
                                        </span>
                                    </span>
                                </label>
                            </div>
                        )}

                        {/* An electrician chooses their scheme; there is no
                            such thing as a Part P number, only membership of
                            one of these. A plumber gets no choice — the work
                            they ticked decides which body it has to be. */}
                        {trade === 'electrician' && (
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-900 mb-1.5">
                                    Which competent person scheme are you with?
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {PART_P_SCHEMES.map((scheme) => {
                                        const chosen = String(registrations[scheme] || '') !== ''
                                            || (registrations[scheme] === '' && scheme in registrations);
                                        return (
                                            <button
                                                key={scheme}
                                                type="button"
                                                onClick={() => {
                                                    // One scheme at a time: the
                                                    // others are cleared, so a
                                                    // number left behind from a
                                                    // change of mind is never
                                                    // sent for checking.
                                                    const next: Record<string, string> = {};
                                                    for (const key of Object.keys(registrations)) {
                                                        if (!isPartP(key)) next[key] = registrations[key];
                                                    }
                                                    next[scheme] = registrations[scheme] || '';
                                                    setRegistrations(next);
                                                }}
                                                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                                                    chosen
                                                        ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                                                        : 'border-slate-300 text-slate-700 hover:border-slate-500'
                                                }`}
                                            >
                                                {schemeLabel(scheme)}
                                            </button>
                                        );
                                    })}
                                </div>
                                {problemFor('registration_part_p') && (
                                    <p className="text-xs text-rose-700 mt-1.5">
                                        {problemFor('registration_part_p')!.message}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="space-y-3">
                            {showableSchemes
                                .filter((scheme) => !isPartP(scheme) || scheme in registrations)
                                .map((scheme) => (
                                    <div key={scheme}>
                                        <label
                                            htmlFor={'reg-' + scheme}
                                            className="block text-sm font-medium text-slate-900 mb-1.5"
                                        >
                                            {schemeNumberLabel(scheme)}
                                        </label>
                                        <input
                                            id={'reg-' + scheme}
                                            type="text"
                                            inputMode="numeric"
                                            value={registrations[scheme] || ''}
                                            onChange={(e) =>
                                                setRegistrations({ ...registrations, [scheme]: e.target.value })
                                            }
                                            className="w-full sm:w-64 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                        />
                                        {problemFor('registration_' + scheme) && (
                                            <p className="text-xs text-rose-700 mt-1">
                                                {problemFor('registration_' + scheme)!.message}
                                            </p>
                                        )}
                                    </div>
                                ))}
                        </div>

                        {showableSchemes.length > 0 && (
                            <p className="text-xs text-slate-500 mt-3">
                                Your number appears on your listing. These registers are public, so an owner
                                can look you up themselves — which is rather the point of it.
                            </p>
                        )}
                    </section>
                )}

                {/* Skills. Free text on purpose: a handyman is defined by
                    what he has picked up rather than by a category anybody
                    could write in advance.

                    The type-ahead is the anti-fragmentation mechanism, not a
                    convenience. Pure free text turns one job into
                    "bricklaying", "brick laying", "brickwork" and "bricks",
                    and a host searching one of them misses three tradesmen who
                    do exactly that work — so existing tags are offered first
                    and a new one is only made when nothing matches. */}
                {hasSkills && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">
                            What else can you turn your hand to?
                        </h2>
                        <p className="text-sm text-slate-500 mb-1.5">
                            The things that do not fit a tick box &mdash; bricklaying, fencing, laying slabs,
                            dyking.
                        </p>
                        {/* Not small print. "Pick from the list" is the whole
                            anti-fragmentation mechanism: somebody offered
                            "bricklaying" takes it, and somebody who reads past
                            this types "brick laying" and splits the tag. It is
                            an instruction, so it is weighted like one. */}
                        <p className="text-sm font-medium text-slate-800 mb-4">
                            Pick from the list where you can &mdash; it is how owners looking for that job
                            find you.
                        </p>

                        {skills.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-3">
                                {skills.map((label) => (
                                    <span
                                        key={label}
                                        className={`inline-flex items-center gap-1.5 rounded-full pl-3 pr-1.5 py-1 text-sm ${
                                            reasonFor(label)
                                                ? 'border border-amber-300 bg-amber-50 text-amber-900'
                                                : 'border border-slate-300 bg-slate-50 text-slate-900'
                                        }`}
                                    >
                                        {label}
                                        {reasonFor(label) && (
                                            <span className="text-xs font-semibold">will not show</span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setSkills(skills.filter((x) => x !== label))}
                                            className="rounded-full p-0.5 text-slate-400 hover:text-slate-700"
                                            aria-label={'Remove ' + label}
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        <input
                            type="text"
                            value={skillTyped}
                            onChange={(e) => setSkillTyped(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                // Otherwise Enter submits the form, which on a
                                // half-typed tag is the worst possible moment.
                                e.preventDefault();
                                if (skillSuggestions.length > 0) addSkill(String(skillSuggestions[0].label));
                                else addSkill(skillTyped);
                            }}
                            placeholder="Start typing"
                            className="w-full md:max-w-sm rounded-xl border border-slate-300 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />

                        {skillTyped.trim() !== '' && (
                            <div className="mt-2 md:max-w-sm">
                                {skillSuggestions.map((suggestion: any) => (
                                    <button
                                        key={suggestion.id || suggestion.slug}
                                        type="button"
                                        onClick={() => addSkill(String(suggestion.label))}
                                        className="block w-full text-left rounded-lg px-3 py-2 text-sm text-slate-900 hover:bg-slate-100"
                                    >
                                        {suggestion.label}
                                        {/* Which registration, not "needs
                                            proof" — a handyman reading that
                                            learns nothing about what proof, or
                                            why, or what to do instead. */}
                                        {suggestion.regulated_concept && (
                                            <span className="text-slate-500">
                                                {' · '}
                                                {suggestion.regulated_concept === 'gas' ? 'Gas Safe work'
                                                    : suggestion.regulated_concept === 'oil' ? 'OFTEC work'
                                                    : 'Part P work'}
                                            </span>
                                        )}
                                    </button>
                                ))}

                                {/* Offered last and looking different, so
                                    taking the existing tag is the easier of
                                    the two. */}
                                {skillIsNew && (
                                    <button
                                        type="button"
                                        onClick={() => addSkill(skillTyped)}
                                        className="block w-full text-left rounded-lg px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50"
                                    >
                                        Add &ldquo;{(skillKey(skillTyped) || { label: skillTyped }).label}&rdquo; as a new one
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Said while they type, and again for anything they
                            are already holding — because "boiler repair" is a
                            reasonable thing for a handyman to think he can
                            list, and finding out afterwards that it never
                            appeared is the bad version of this.

                            The valuable part is the routing, not the refusal.
                            "Needs proof" tells somebody nothing: not what
                            proof, not why, and not what to do instead. So it
                            says which registration, that we do not ask this
                            trade for it, and where the tag would show. */}
                        {(typedReason || blockedHeld.length > 0) && (
                            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 md:max-w-lg">
                                {typedReason && (
                                    <p className="text-sm text-amber-900">{typedReason}</p>
                                )}

                                {blockedHeld.map((x) => (
                                    <p key={x.label} className="text-sm text-amber-900 mt-1 first:mt-0">
                                        {x.reason}
                                    </p>
                                ))}

                                <p className="text-xs text-amber-900/70 mt-2">
                                    You can leave it on if you like &mdash; everything else you have added still
                                    shows.
                                </p>
                            </div>
                        )}
                    </section>
                )}

                {/* Extras. Three types, and they behave differently
                    where it matters: a toggle is comparison, a priced one is
                    part of the ceiling, and a reimbursed one is money that
                    never comes near us. */}
                {offerings.length > 0 && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">
                            {hasFaults ? 'What do you get called out for?' : 'What else do you offer?'}
                        </h2>
                        <p className="text-sm text-slate-500 mb-4">
                            {hasFaults
                                ? 'All optional, but this is how owners find you. Somebody with a problem searches for the problem, not for a trade.'
                                : 'All optional. Owners compare on these, so it is worth saying yes to what you actually do.'}
                        </p>

                        {toggleBlock('about', '')}
                        {toggleBlock('faults', groupLabel('faults'))}
                        {toggleBlock('planned', groupLabel('planned'))}
                        {toggleBlock('availability', groupLabel('availability'))}

                        <div className="md:grid md:grid-cols-2 md:gap-4 md:items-start">
                        {gatedGroups.map((group: any) => {
                            const open = gateOpen[group.key];
                            const rows = extrasIn(group.key);

                            return (
                                <div key={group.key} className="mb-6">
                                    <div className="rounded-xl border border-slate-300 p-3.5">
                                        <p className="text-sm font-medium text-slate-900 mb-2.5">{group.gate}</p>

                                        <div className="flex gap-2">
                                            {[true, false].map((yes) => (
                                                <button
                                                    key={String(yes)}
                                                    type="button"
                                                    onClick={() => {
                                                        setGateOpen((prev) => ({ ...prev, [group.key]: yes }));
                                                        // Saying no clears the prices, so the
                                                        // answer and the boxes cannot disagree.
                                                        if (!yes) {
                                                            for (const e of rows) setExtra(e.key, 'price', '');
                                                        }
                                                    }}
                                                    aria-pressed={open === yes}
                                                    className={`rounded-full border px-5 py-2 text-sm font-semibold transition ${
                                                        open === yes
                                                            ? 'border-emerald-700 bg-emerald-700 text-white'
                                                            : 'border-slate-300 text-slate-700 hover:border-slate-500'
                                                    }`}
                                                >
                                                    {yes ? 'Yes' : 'No'}
                                                </button>
                                            ))}
                                        </div>

                                        {open === true && (
                                            <div className="mt-4 space-y-2.5">
                                                {rows.map((extra) => {
                                                    const entry = extraOf(extra.key);
                                                    const problem = problemFor('extra_price_' + extra.key);
                                                    const perUnit = extra.unit === 'each';

                                                    return (
                                                        <div key={extra.key}>
                                                            <div className="flex items-center gap-3">
                                                                <label
                                                                    htmlFor={'rate-' + extra.key}
                                                                    className={`shrink-0 text-sm font-medium text-slate-900 ${perUnit ? 'w-16' : ''}`}
                                                                >
                                                                    {extra.label}
                                                                </label>
                                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                                    <span className="text-slate-500">&pound;</span>
                                                                    <input
                                                                        id={'rate-' + extra.key}
                                                                        type="text"
                                                                        inputMode="decimal"
                                                                        value={entry.price}
                                                                        onChange={(e) => setExtra(extra.key, 'price', e.target.value)}
                                                                        placeholder={perUnit ? '8' : '25'}
                                                                        className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                                    />
                                                                    {perUnit && (
                                                                        <span className="text-sm text-slate-500 whitespace-nowrap">per bed</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {problem && (
                                                                <p className="text-xs text-rose-700 mt-1">{problem.message}</p>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        </div>

                        {extrasIn('reimbursed').length > 0 && (
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Bought for the owner and paid back
                                </h3>

                                <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-3 md:gap-3">
                                    {extrasIn('reimbursed').map((extra) => {
                                        const entry = extraOf(extra.key);

                                        return (
                                            <div key={extra.key} className="rounded-xl border border-slate-300 p-3.5">
                                                <label className="flex items-start gap-3 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={entry.offered}
                                                        onChange={(e) => setExtra(extra.key, 'offered', e.target.checked)}
                                                        className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                                                    />
                                                    <span>
                                                        <span className="block text-sm font-medium text-slate-900">{extra.label}</span>
                                                        {extra.hint && (
                                                            <span className="block text-sm text-slate-500 mt-0.5">{extra.hint}</span>
                                                        )}
                                                    </span>
                                                </label>

                                                {entry.offered && extra.type === 'reimbursed' && (
                                                    <div className="mt-3 pl-7">
                                                        <input
                                                            type="text"
                                                            value={entry.notes}
                                                            onChange={(e) => setExtra(extra.key, 'notes', e.target.value)}
                                                            placeholder="Anything the owner should know — where you shop, what you usually get."
                                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <p className="text-sm text-slate-500 mt-2.5">
                                    Paid back by the owner against a receipt. Not through us, and no commission.
                                </p>
                            </div>
                        )}
                    </section>
                )}


                <section className="mb-8">
                    <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Where do you cover?</h2>
                    <p className="text-sm text-slate-500 mb-3">
                        A town and how far you will travel from it. Add more than one if you cover separate areas.
                    </p>

                    <div className="space-y-2 md:max-w-xl">
                        {areas.map((a, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <select
                                    value={a.town}
                                    aria-label="Town"
                                    onChange={(e) => setAreas((prev) => prev.map((x, j) => (j === i ? { ...x, town: e.target.value } : x)))}
                                    className="flex-1 min-w-0 rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                >
                                    {COVERAGE_TOWNS.map((t) => (
                                        <option key={t.key} value={t.label}>{t.label}</option>
                                    ))}
                                </select>
                                <select
                                    value={a.radius_miles}
                                    aria-label="Distance covered"
                                    onChange={(e) => setAreas((prev) => prev.map((x, j) => (j === i ? { ...x, radius_miles: Number(e.target.value) } : x)))}
                                    className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                >
                                    {[5, 10, 15, 20, 30, 50].map((m) => (
                                        <option key={m} value={m}>within {m} miles</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => setAreas((prev) => prev.filter((_, j) => j !== i))}
                                    aria-label={'Remove ' + a.town}
                                    className="shrink-0 w-10 h-10 rounded-full border border-slate-300 flex items-center justify-center text-slate-500 hover:border-slate-500"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>

                    {areas.length < COVERAGE_TOWNS.length && (
                        <button
                            type="button"
                            onClick={addArea}
                            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                            <Plus className="w-4 h-4" /> Add an area
                        </button>
                    )}

                    {problemFor('areas') && (
                        <p className="text-sm text-rose-700 mt-2">{problemFor('areas')!.message}</p>
                    )}
                </section>

                <section className="mb-8 grid sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                            Email for us to reach you on
                        </label>
                        <input
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                        {problemFor('contact_email') && (
                            <p className="text-sm text-rose-700 mt-1.5">{problemFor('contact_email')!.message}</p>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                            Phone <span className="font-normal text-slate-500">(optional)</span>
                        </label>
                        <input
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                    </div>

                    {/* Said once, plainly, and true today: nothing renders
                        these publicly. It is here because the labels used to
                        say "for job requests", which promised an owner would
                        write to them directly — and the direction is the
                        opposite of that. */}
                    <p className="sm:col-span-2 text-sm text-slate-500">
                        Neither of these goes on your listing. We use them to tell you about
                        your application and about work coming in.
                    </p>
                </section>
            </fieldset>

            {restored && !providerId && (
                <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 mb-8">
                    <p className="text-sm text-emerald-900">
                        We kept what you filled in last time. Carry on where you left off.
                    </p>
                </div>
            )}

            {/* The account, inline, made out of what they have already typed.
                This was a login wall: a tradesman filled in the whole form and
                then met a door. Now the last field on the form is a password
                and the button that sends it also makes the account.

                No second email box. Their contact address is the account
                address — asking again is asking a question we know the answer
                to, and two addresses that can disagree is a support problem
                waiting to happen. */}
            {!session && !checkYourEmail && (
                <div className="rounded-2xl border border-slate-300 p-5 mb-8">
                    <h2 className="text-sm font-semibold text-slate-900 mb-1.5">
                        Set a password
                    </h2>
                    <p className="text-sm text-slate-500 mb-4">
                        So you can come back and change any of this. We will use{' '}
                        <strong className="text-slate-900">{contactEmail.trim() || 'the email address above'}</strong>.
                    </p>

                    <input
                        type="password"
                        value={acctPassword}
                        onChange={(e) => { setAcctPassword(e.target.value); setAcctError(''); }}
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                        className="w-full md:max-w-sm rounded-xl border border-slate-300 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />

                    <label className="flex items-start gap-2.5 mt-3 text-sm text-slate-800">
                        <input
                            type="checkbox"
                            checked={acctConsent}
                            onChange={(e) => { setAcctConsent(e.target.checked); setAcctError(''); }}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                        />
                        <span>I am happy to create an account</span>
                    </label>

                    {acctError && (
                        <p className="text-sm text-rose-700 mt-2">{acctError}</p>
                    )}

                    {/* Offered, not imposed. Somebody who has been here before
                        should not be made to invent a second account, but most
                        people at this point have none — so it is a link rather
                        than half the panel. */}
                    {!showSignIn ? (
                        <button
                            type="button"
                            onClick={() => setShowSignIn(true)}
                            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline mt-4"
                        >
                            I already have an account
                        </button>
                    ) : (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <p className="text-sm text-slate-600 mb-3">
                                Sign in and we will save this straight to your account. Nothing you have
                                typed is lost.
                            </p>
                            <LoginModel />
                        </div>
                    )}
                </div>
            )}

            {/* Email confirmation is on, so signUp gave us a user and no
                session and nothing can be written yet. Saying so matters: a
                button that silently does nothing looks broken, and the form is
                safe in local storage whether or not they believe us. */}
            {checkYourEmail && (
                <div className="rounded-2xl border-2 border-emerald-700 bg-emerald-50 p-5 mb-8">
                    <p className="font-semibold text-emerald-900">Check your email</p>
                    <p className="text-sm text-emerald-900/80 mt-1">
                        We have sent a link to <strong>{contactEmail.trim()}</strong>. Open it and you will
                        come straight back here with everything you have filled in still on the page —
                        then press send.
                    </p>
                </div>
            )}

            {!locked && (
                <div className="border-t border-slate-200 pt-6">
                    {/* A live business is not re-applying. One button, and it
                        says what it does — and the consequence is stated
                        before they press it rather than discovered after. */}
                    {status === 'approved' ? (
                        <>
                            <p className="text-sm text-slate-600 mb-4">
                                You will stay live while we look. Changing your{' '}
                                <strong className="font-semibold text-slate-800">
                                    business name, category, description, logo, or who you sell to
                                </strong>{' '}
                                means we check it again and email you — your listing stays up the whole
                                time. Contact details and the areas you cover change straight away, with
                                nothing to wait for.
                            </p>
                            <button
                                type="button"
                                onClick={() => save(true)}
                                disabled={saving}
                                className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-7 py-3 font-semibold transition disabled:opacity-60"
                            >
                                {saving ? 'Saving…' : 'Save changes'}
                            </button>
                        </>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            {/* One press does both when they are signed out:
                                the account is made from what they typed and
                                the application goes in. The label says so,
                                because "Send for review" while a password box
                                sits above it leaves somebody wondering whether
                                they have to do something else first. */}
                            <button
                                type="button"
                                onClick={() => save(true)}
                                disabled={saving || acctBusy}
                                className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-7 py-3 font-semibold transition disabled:opacity-60"
                            >
                                {acctBusy
                                    ? 'Making your account…'
                                    : saving
                                        ? 'Sending…'
                                        : session
                                            ? 'Send for review'
                                            : 'Create account and send'}
                            </button>

                            {/* "Save and finish later" is a promise that needs
                                somewhere to save TO. Signed out there is no
                                such place, and it used to open the login wall
                                — so it says what actually happens instead: the
                                form is in this browser and will be here when
                                they come back. */}
                            {session ? (
                                <button
                                    type="button"
                                    onClick={() => save(false)}
                                    disabled={saving}
                                    className="rounded-full border border-slate-300 px-6 py-3 font-semibold text-slate-700 hover:border-slate-500 transition disabled:opacity-60"
                                >
                                    Save and finish later
                                </button>
                            ) : (
                                <p className="text-sm text-slate-500">
                                    Everything you have typed stays on this device, so you can close
                                    this and come back to it.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Only a draft, and only one they have actually started.
                        Nothing is recoverable afterwards, so it asks first. */}
                    {status === 'draft' && providerId && (
                        <div className="mt-8 pt-6 border-t border-slate-200">
                            {!confirmRemove ? (
                                <button
                                    type="button"
                                    onClick={() => setConfirmRemove(true)}
                                    className="text-sm font-semibold text-rose-700 hover:text-rose-800 underline"
                                >
                                    Remove this
                                </button>
                            ) : (
                                <div>
                                    <p className="text-sm text-slate-700 mb-3">
                                        Remove this {tradeLabel(trade).toLowerCase()} application? Everything you have
                                        filled in goes with it, and it cannot be got back.
                                    </p>
                                    <div className="flex flex-wrap gap-3">
                                        <button
                                            type="button"
                                            onClick={removeDraft}
                                            disabled={removing}
                                            className="rounded-full bg-rose-700 hover:bg-rose-800 text-white px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                                        >
                                            {removing ? 'Removing…' : 'Remove for good'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmRemove(false)}
                                            className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
                                        >
                                            Keep it
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function JoinApplyPage() {
    // useSearchParams needs a boundary, the same as the query-string reader in
    // the root layout.
    return (
        <Suspense fallback={<div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>}>
            <ApplicationForm />
        </Suspense>
    );
}
