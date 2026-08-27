'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { supabaseEmailFlow } from '@/lib/supabaseEmailFlow';
import { toast } from 'react-toastify';
import {
    Sparkles, Wrench, Trees, Droplet, ChefHat, Cake, ShoppingBasket, PawPrint, Trash2,
    Plus, X, ChevronLeft, ChevronRight, Check, Zap, Hammer, Paintbrush, Home,
} from 'lucide-react';
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
    audienceForTrade,
    extrasFor,
    extrasProblems,
    imageryFor,
    initialsFor,
    showsTimeGuide,
    BUILDING_TYPES,
    capabilityFor,
    pricedOfferingsFor,
    showsRates,
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
    planTerms,
    pricingModelFor,
    offersHourlyChoice,
    pickerEntries,
    unclaimedTrades,
    tradesFor,
    groupByKey,
    bandsFor,
    REVIEW_WITHIN_HOURS,
} from '@/lib/serviceProviders';
import {
    stepsFor,
    stepNumber,
    stepCount,
    nextStep,
    previousStep,
    isLastStep,
    resolveStep,
    problemsOnStep,
    firstStepWithProblem,
    stepForField,
    StepKey,
} from '@/lib/joinSteps';

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
    electrician: Zap,
    joiner: Hammer,
    plumber: Droplet,
    roofer: Home,
    painter: Paintbrush,
    handyman: Wrench,
};

const GROUP_ICONS: Record<string, any> = {
    maintenance: Wrench,
};

const PICKER_STATUS_STYLE: Record<string, string> = {
    pending_review: 'bg-amber-100 text-amber-900',
    approved: 'bg-emerald-100 text-emerald-900',
    declined: 'bg-rose-100 text-rose-900',
    hidden: 'bg-slate-200 text-slate-700',
    draft: 'bg-slate-200 text-slate-700',
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

    // Which step is on screen.
    //
    // Held here rather than in the URL, unlike the trade. The trade has to
    // survive a trip out to the email confirmation and back, which is what a
    // query string is for; the step is a position in a form somebody is
    // filling in, and putting it in the URL would put every keystroke's worth
    // of navigation into their browser history.
    const [step, setStep] = useState<StepKey>('trade');

    // Which steps they have pressed Next on. Errors on a step nobody has
    // reached yet stay hidden: a form that turns red before it has been
    // touched reads as broken rather than as helpful.
    const [visited, setVisited] = useState<StepKey[]>([]);

    // The maintenance group opened on step one. Not a step of its own -- it is
    // the same question, narrowed -- so Back from here returns to the trade
    // list rather than out of the form.
    const [openGroup, setOpenGroup] = useState<string>('');

    // What they already have, for step one. One business per trade, so this is
    // a list of what they hold plus what is left.
    const [mine, setMine] = useState<any[]>([]);
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
    // Cleaning, in-house only. `kind` is loaded from the saved record and is
    // never written from here — a public applicant is always external, so
    // this stays 'bands' and the choice never renders for them.
    const [kind, setKind] = useState('external');
    const [pricingChoice, setPricingChoice] = useState<'bands' | 'hourly'>('bands');
    const [billableHourlyRate, setBillableHourlyRate] = useState('');
    const [coveredBands, setCoveredBands] = useState<string[]>([]);

    const [calloutFee, setCalloutFee] = useState('');
    const [hourlyRate, setHourlyRate] = useState('');
    const [calloutWaived, setCalloutWaived] = useState(false);

    // Skills tags. Held as labels rather than ids, because a tag they typed
    // before signing in does not have an id yet — the route settles all of
    // that when it reconciles the set.
    const [skills, setSkills] = useState<string[]>([]);
    const [skillTyped, setSkillTyped] = useState('');
    // Whether the list is showing at all. Opened by focusing the box.
    //
    // Nobody should ever face a blank box: an empty box is an invitation to
    // invent wording, which is the fragmentation this whole mechanism exists
    // to stop. But twelve chips sitting there permanently made the step long.
    // Focus is the moment somebody is about to type, so it is the moment to
    // show them they do not have to.
    //
    // It does not close on blur. Blur fires before the click on a chip lands,
    // so closing there would make the chips untappable — the classic version
    // of this bug, where the thing vanishes as you reach for it.
    const [skillsListOpen, setSkillsListOpen] = useState(false);
    // Whether the list is showing everything or the first handful.
    const [allTagsOpen, setAllTagsOpen] = useState(false);
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

    // No trade yet is not an error and no longer a redirect: it is step one,
    // which is on this screen. The trade still travels in the query string
    // once it is picked, because it has to survive the trip out to the email
    // confirmation and back.

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

                // What they already hold, for step one. One business per
                // trade, so the first step is a list of what they have plus
                // what is left, rather than a question they have answered.
                if (session) {
                    const { data: theirs } = await supabase
                        .from('service_providers')
                        .select('id, trade, business_name, status')
                        .eq('owner_id', session.user.id);

                    setMine(theirs || []);
                }

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
                    .select('id, business_name, trade, description, contact_email, contact_phone, audience, photos, logo, status, review_note, callout_fee, hourly_rate, callout_waived, does_gas, does_oil, kind, pricing_choice, billable_hourly_rate, covered_bands')
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
                    setKind(existing.kind || 'external');
                    setPricingChoice(existing.pricing_choice === 'hourly' ? 'hourly' : 'bands');
                    setBillableHourlyRate(
                        existing.billable_hourly_rate === null || existing.billable_hourly_rate === undefined
                            ? ''
                            : String(existing.billable_hourly_rate)
                    );
                    setCoveredBands(Array.isArray(existing.covered_bands) ? existing.covered_bands : []);

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

    // Where to open, when there was no draft to restore a position from.
    //
    // A trade in the URL means step one is already answered -- they came back
    // through a link, or they have a saved record -- so opening on the trade
    // picker would make them answer it twice. No trade means step one.
    useEffect(() => {
        if (!hydrated || restored) return;

        setStep(tradeFromUrl ? 'business' : 'trade');
        setVisited(tradeFromUrl ? ['trade'] : []);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrated, restored, tradeFromUrl]);

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
    // Whether step one has actually been answered. The `trade` state defaults
    // to 'sponge' so that the rest of the form has something to work from, so
    // it cannot be used to answer this — a first-time visitor would look like
    // a cleaner.
    const chosen = tradeFromUrl !== '';

    const restoreDraft = () => {
        // Nothing has been picked, so there is no draft to come back to: the
        // key would be the empty one, and the only thing ever written under it
        // is the blank form. Restoring that told a first-time visitor "we kept
        // what you filled in last time" before they had filled in anything.
        if (!chosen) return;


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
            if (d.pricingChoice === 'hourly') setPricingChoice('hourly');
            if (d.billableHourlyRate) setBillableHourlyRate(d.billableHourlyRate);
            if (Array.isArray(d.coveredBands)) setCoveredBands(d.coveredBands);
            if (d.calloutFee) setCalloutFee(d.calloutFee);
            if (d.hourlyRate) setHourlyRate(d.hourlyRate);
            if (d.areas) setAreas(d.areas);

            // Whether there is anything in here worth calling kept work.
            //
            // A draft EXISTING is not the same as somebody having filled
            // something in. The load effect re-runs when the trade changes,
            // and the trade changes the moment somebody picks one on step one
            // — so the persist effect writes a blank draft for the new trade
            // and this reads it back a beat later. Going on existence alone,
            // that told a brand-new applicant "we kept what you filled in last
            // time" and marked step two as somewhere they had already been, so
            // it arrived with every field already red.
            //
            // Asking what is in it rather than whether it is there is also the
            // honest version of the sentence it controls.
            const filledIn = Boolean(
                (d.businessName || '').trim() ||
                (d.description || '').trim() ||
                (d.contactEmail || '').trim() ||
                (d.contactPhone || '').trim() ||
                (d.calloutFee || '').trim() ||
                (d.hourlyRate || '').trim() ||
                (d.buildingType || '') ||
                (d.panes || '') ||
                d.logo ||
                d.doesGas === true ||
                d.doesOil === true ||
                (Array.isArray(d.photos) && d.photos.length) ||
                (Array.isArray(d.skills) && d.skills.length) ||
                (Array.isArray(d.areas) && d.areas.length) ||
                (d.prices && Object.keys(d.prices).length) ||
                (d.extras && Object.keys(d.extras).length) ||
                (d.registrations && Object.keys(d.registrations).length)
            );

            if (!filledIn) return;

            // Back where they left off, not back at the start.
            //
            // This is the whole point of persisting on every keystroke: a
            // tradesman filling this in on site gets a phone call, comes back
            // twenty minutes later, and finding himself on step one with the
            // fields still full would read as the form having lost the lot.
            //
            // resolveStep is what makes it safe. A step saved against another
            // trade may not exist for this one -- somebody can leave on the
            // registration step as a plumber and come back as a cleaner -- and
            // it lands them on the last step this trade does have rather than
            // on a blank panel.
            const landing = resolveStep(d.trade || tradeFromUrl, d.step);
            setStep(landing);

            // Everything up to where they were counts as seen, so the step
            // they are returning to shows its errors rather than looking
            // finished. Steps ahead of them stay quiet.
            const upTo = stepsFor(d.trade || tradeFromUrl);
            const at = upTo.findIndex((x: any) => x.key === landing);
            setVisited(upTo.slice(0, at + 1).map((x: any) => x.key));

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
        // And before a trade is picked there is nothing worth keeping. This
        // also stops an empty draft being written under the empty key on every
        // first visit, which is what the restore was then finding.
        if (!chosen) return;

        try {
            window.localStorage.setItem(
                draftKey(tradeFromUrl),
                JSON.stringify({
                    // The step and the trade, so coming back lands where they
                    // left rather than at the beginning.
                    step, trade,
                    businessName, description, contactEmail, contactPhone,
                    prices, extras, calloutFee, hourlyRate, areas,
                    pricingChoice, billableHourlyRate, coveredBands,
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
        hydrated, providerId, tradeFromUrl, chosen, step, trade,
        businessName, description, contactEmail, contactPhone,
        prices, extras, calloutFee, hourlyRate, areas,
        pricingChoice, billableHourlyRate, coveredBands,
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
        kind,
        pricing_choice: pricingChoice,
        billable_hourly_rate: billableHourlyRate,
        covered_bands: coveredBands,
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

    const model = pricingModelFor(trade);
    const tradeExtras = extrasFor(trade);
    // Split by what the entries ARE rather than by where they are stored.
    // capabilityFor and pricedOfferingsFor are in serviceProviders so that
    // lib/joinSteps decides which steps exist off exactly the same answer this
    // renders off — two copies of that rule is how a step comes to exist with
    // nothing in it, or content ends up on a step nobody looks at.
    const capability = capabilityFor(trade);
    const pricedOfferings = pricedOfferingsFor(trade);
    const extrasIn = (group: string) => tradeExtras.filter((e) => e.group === group);
    // Every group that asks a question before showing its prices. Laundry and
    // hot tubs both do; the mechanism is the group's, not either of theirs.
    const gatedGroups = EXTRA_GROUPS.filter(
        (g: any) => g.gate && !isPricingGroup(g.key) && extrasIn(g.key).length > 0
    );

    // What the "what else do you offer" section can actually draw: the
    // unlabelled `about` toggles, the gated groups, and the reimbursed ones.
    // Deliberately NOT pricedOfferings.length — see the section itself.
    const offersSomethingVisible =
        extrasIn('about').length > 0
        || gatedGroups.length > 0
        || extrasIn('reimbursed').length > 0;

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
    // From serviceProviders, not recomputed here. lib/joinSteps asks the same
    // function when deciding whether this trade has a prices step at all, and
    // the two must never be able to disagree about it.
    const isCallout = showsRates(trade);

    // Whether this provider may be asked the question at all. False for every
    // public applicant, because `kind` defaults to external and nothing in the
    // browser can change it.
    const hourlyAllowed = offersHourlyChoice({ trade, kind });
    const onHourly = hourlyAllowed && pricingChoice === 'hourly';

    const hasSkills = asksAboutSkills(trade);

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

    // The tags worth putting in front of somebody before they type.
    //
    // This is the anti-fragmentation mechanism, and until now it was invisible:
    // the copy says "pick from the list where you can" and the list only
    // appeared once they had started typing — by which point they have already
    // chosen their own wording and are typing "brick laying" past a
    // "Bricklaying" they never saw. An instruction to pick from a list that is
    // not on screen is not an instruction.
    //
    // Regulated tags are left out. A handyman cannot hold Gas Safe or Part P —
    // the sign-up does not even ask them for a number — so offering "Boiler
    // repair" as a tappable chip is offering something that comes straight back
    // with "will not show" against it. They can still be typed, and reasonFor
    // still explains itself when they are.
    const TAGS_SHOWN_CLOSED = 12;

    const heldCompact = skills.map((x) => (skillKey(x) || { compact: '' }).compact);

    const offerableTags = (allSkills || []).filter((tag: any) =>
        !tag.regulated_concept &&
        heldCompact.indexOf((skillKey(String(tag.label)) || { compact: '' }).compact) === -1
    );

    // Typing FILTERS this list rather than replacing it with a different one.
    //
    // There used to be two lists — chips before typing, a dropdown after — and
    // they behaved differently and looked different, so typing felt like
    // leaving the list rather than narrowing it. One list, one set of rules:
    // regulated tags are never in it, held tags are never in it, and what you
    // type only decides which of the rest survive.
    //
    // suggestSkills does the matching because it ranks exact, then
    // starts-with, then contains — a handyman half way through "brick" wants
    // Bricklaying at the top, not an alphabetical list of everything with
    // those letters in it. The high limit is so "Show all" still governs how
    // many appear, rather than the matcher quietly capping it at eight.
    const matchingTags = skillTyped.trim() === ''
        ? offerableTags
        : suggestSkills(allSkills, skillTyped, skills, 500)
            .filter((tag: any) => !tag.regulated_concept);

    const tagsToShow = allTagsOpen ? matchingTags : matchingTags.slice(0, TAGS_SHOWN_CLOSED);

    const typedConcept = conceptOf(skillTyped);
    const typedReason = skillTyped.trim() === '' ? null : reasonFor(skillTyped);

    const bands = bandsFor(trade);

    const setBand = (key: string, field: 'price' | 'typical_hours', value: string) =>
        setPrices((prev) => ({
            ...prev,
            [key]: Object.assign({ price: '', typical_hours: '' }, prev[key] || {}, { [field]: value }),
        }));

    // An error shows beside its field once the step it lives on has been
    // pressed Next on, or once send has been pressed at the end.
    //
    // This is the change from the long page. Before, nothing went red until
    // send, so a tradesman who had scrolled through nine sections got the lot
    // at once and had to go back up looking for them. Now a step answers for
    // itself on the way past, and by the time send is pressed there is
    // normally nothing left to say.
    const problemFor = (field: string) => {
        const where = stepForField(field);
        const shown = touchedSubmit || (where !== null && visited.indexOf(where) !== -1);
        return shown ? (problems.filter((p) => p.field === field)[0] || null) : null;
    };

    // ---- moving between steps --------------------------------------------

    const steps = stepsFor(trade);
    const stepMeta = steps.filter((x) => x.key === step)[0] || steps[0];
    const onStep = (key: StepKey) => step === key;

    // What is wrong on the step in front of them, which is all Next is
    // allowed to care about. A missing price must not stop somebody getting
    // past their business name.
    const stepProblems = problemsOnStep(problems, step);

    const markVisited = (key: StepKey) =>
        setVisited((prev) => (prev.indexOf(key) === -1 ? prev.concat([key]) : prev));

    // The top of the panel, not the top of the page. On a phone the modal is
    // the whole screen and its body is what scrolls, so scrolling the window
    // would move nothing and leave somebody halfway down the next step.
    const scrollPanelToTop = () => {
        const panel = document.getElementById('signup-panel');
        if (panel) panel.scrollTo({ top: 0, behavior: 'auto' });
    };

    // Bring the first thing that is wrong into view.
    //
    // Revealing an error is not the same as showing it. A cleaner pressing
    // Next with no prices set was refused by a message at the foot of a
    // section she could not see, so the button simply looked broken -- which
    // is the long page's problem in miniature, on one step instead of nine.
    //
    // Two frames, not one. The errors do not exist in the DOM until the render
    // that markVisited triggers has been committed and painted, and a single
    // requestAnimationFrame still runs before that -- it found nothing to
    // scroll to and the button went on looking broken.
    const showFirstProblem = () => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            const panel = document.getElementById('signup-panel');
            const first = panel && (panel.querySelector('[data-problem]') as HTMLElement | null);
            if (!panel || !first) return;

            // Worked out rather than left to scrollIntoView. The footer sits
            // over the foot of the panel, so an error resting exactly on that
            // line is one scrollIntoView calls already visible and declines to
            // move -- which was the case here: the message about pricing a
            // size was underneath the Next button that had just refused.
            //
            // A third of the way down puts it clear of both the header and the
            // buttons, whichever end of the panel it started at.
            const delta = first.getBoundingClientRect().top - panel.getBoundingClientRect().top;

            // Assigned rather than scrollTo({behavior:'smooth'}). Smooth
            // scrolling is not honoured everywhere -- where it is not, the
            // call is a silent no-op, and a scroll that quietly does nothing
            // is the same failure as not writing one. This always moves.
            panel.scrollTop = panel.scrollTop + delta - panel.clientHeight / 3;
        }));
    };

    const goNext = () => {
        markVisited(step);

        // Refused. markVisited above is what reveals the reasons beside their
        // fields; this is what makes sure one of them is actually on screen.
        // No toast -- a message at the bottom of the screen about a box
        // somewhere above it is the thing this form exists to stop.
        if (stepProblems.length > 0) {
            showFirstProblem();
            return;
        }

        const to = nextStep(trade, step);
        if (to === step) return;

        setStep(to);
        scrollPanelToTop();
    };

    const goBack = () => {
        // Inside the maintenance group, Back is the way out of the group
        // rather than out of the form. It is the same question narrowed, not
        // a step of its own.
        if (step === 'trade' && openGroup) {
            setOpenGroup('');
            return;
        }

        const to = previousStep(trade, step);
        if (to === step) return;

        // Nothing is validated and nothing is cleared on the way back. Every
        // field is component state and stays exactly as it was -- which is
        // also why Back must never be a router call: that would remount this
        // and lose the lot.
        setStep(to);
        scrollPanelToTop();
    };

    // Send pressed on the last step with something still outstanding.
    //
    // On the long page this was a toast and nothing else, which told somebody
    // that a form they were looking at the bottom of was wrong somewhere above
    // them. Stepped, there is a right answer: open the earliest step that has
    // a problem, with the errors showing, and say which one it was.
    const goToFirstProblem = () => {
        setVisited(steps.map((x) => x.key));

        const to = firstStepWithProblem(trade, problems);
        if (!to || to === step) return;

        setStep(to);
        scrollPanelToTop();
        showFirstProblem();

        const which = steps.filter((x) => x.key === to)[0];
        toast.error(
            which ? 'Something is missing under ' + which.label.toLowerCase() + '.' : 'A few things still need filling in.',
            { theme: 'colored' }
        );
    };

    // Step one, answered. The trade decides what the later steps ask, so it
    // also goes into the URL -- both because it has to survive the trip out to
    // the email confirmation, and because the draft in local storage is keyed
    // on it.
    const chooseTrade = (key: string) => {
        setTrade(key);
        setOpenGroup('');
        markVisited('trade');
        router.replace('/services/join?trade=' + encodeURIComponent(key));
        setStep('business');
        scrollPanelToTop();
    };

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
        //
        // The wording matters more than it looks. "Make an account first and
        // you can add your logo — everything else is kept" reads as though the
        // logo is the thing that is NOT kept, and somebody who has just picked
        // a file hears that as losing it. It is not lost; it was never
        // uploaded, and it can be added any time afterwards without redoing
        // anything.
        if (!session) {
            // "Once your account exists" was written when an account was a
            // separate errand. The same button makes it now, so this says when
            // rather than what has to happen first — and it says the file has
            // not gone anywhere, because somebody who has just picked one and
            // seen nothing happen assumes it has.
            toast.info('Your logo can go on as soon as this is sent — nothing has been lost, just pick it again then.', {
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
            const { data, error } = await supabaseEmailFlow().auth.signUp({
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

            // Only reachable with email confirmation switched OFF. The
            // email-flow client keeps no session of its own, so hand it to the
            // auth-helpers client, which owns the cookies the rest of the site
            // reads — including the upsert immediately below, which needs to be
            // authenticated as this user for the row policy to allow it.
            await supabase.auth.setSession(data.session);

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
                goToFirstProblem();
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
                goToFirstProblem();
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

            // Cleaning and in-house only, and cleared to the banded shape
            // otherwise. `kind` is never sent — it is not the applicant's to
            // set, and the database check would refuse an hourly row that is
            // not in-house anyway. Sending the cleared values rather than
            // omitting them is what stops a provider who was switched back to
            // external keeping a live rate nothing validates any more.
            pricing_choice: trade === 'sponge' ? (hourlyAllowed && pricingChoice === 'hourly' ? 'hourly' : 'bands') : null,
            billable_hourly_rate: hourlyAllowed && pricingChoice === 'hourly' && billableHourlyRate.trim() !== ''
                ? Number(billableHourlyRate)
                : null,
            covered_bands: hourlyAllowed && pricingChoice === 'hourly' ? coveredBands : [],
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

    const position = stepNumber(trade, step);
    const total = stepCount(trade);
    const lastStep = isLastStep(trade, step);

    return (
        /* THE MODAL.
           Full screen below md, a centred card above it.

           `inset-0` with no width cap under md is the whole of it: a tradesman
           fills this in on a phone, standing in somebody's driveway, and a
           fixed-width centred card at 375px is the clipping that cost us
           Saturdays on the booking calendar. Measured at 375 and at 1280.

           The scroll is on the panel body rather than on the page, so the
           header and the buttons stay put while the questions move — on a
           phone that means the way forward is always under your thumb and
           never below the fold. */
        <div className="fixed inset-0 z-[60] flex md:items-center md:justify-center md:p-6 bg-white md:bg-slate-900/40">
            <div className="flex flex-col w-full h-full bg-white md:h-auto md:max-h-[90vh] md:w-full md:max-w-3xl md:rounded-2xl md:shadow-xl overflow-hidden">

                {/* ---- header: where they are, and the way out ---- */}
                <div className="shrink-0 border-b border-slate-200 px-4 sm:px-6 pt-4 pb-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="text-lg sm:text-xl font-bold text-slate-900 truncate">
                                {stepMeta.title}
                            </h1>
                            {/* `chosen`, not `trade`: the trade state defaults
                                to 'sponge' so the rest of the form has
                                something to work from, and reading it here put
                                "Cleaning" under the heading of somebody who had
                                not picked anything yet. */}
                            <p className="text-xs text-slate-500 mt-0.5 truncate">
                                {chosen
                                    ? tradeLabel(trade)
                                    : 'Get work from holiday lets across Dumfries & Galloway.'}
                            </p>
                        </div>

                        <Link
                            href="/business"
                            aria-label="Close"
                            className="shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
                        >
                            <X className="w-5 h-5" />
                        </Link>
                    </div>

                    {/* THE STEP INDICATOR.
                        Built from stepsFor(trade), so it counts only the steps
                        this trade actually has. A cleaner has no registration
                        number and no skills, so she sees four dots and "Step 2
                        of 4" — not five with one that never arrives.

                        The dots carry the count on a phone and the labels
                        appear when there is room for them; a label under every
                        dot at 375px is four words fighting for sixty pixels. */}
                    <div className="mt-3.5">
                        {/* Nothing is drawn until a trade is picked, for the
                            same reason no total is announced: how many steps
                            there are depends on the answer to the step they
                            are looking at. Four segments here would be the
                            cleaner's count shown to a plumber, and it would
                            grow by one under him the moment he tapped. */}
                        {chosen && (
                        <div className="flex items-center gap-1.5" role="list" aria-label={'Step ' + position + ' of ' + total}>
                            {steps.map((s, i) => {
                                const done = i + 1 < position;
                                const here = s.key === step;

                                return (
                                    <div key={s.key} role="listitem" className="flex-1 min-w-0">
                                        <div
                                            className={`h-1.5 rounded-full transition-colors ${
                                                here ? 'bg-emerald-700' : done ? 'bg-emerald-300' : 'bg-slate-200'
                                            }`}
                                        />
                                        <span
                                            className={`hidden sm:flex items-center gap-1 text-[11px] mt-1.5 truncate ${
                                                here ? 'font-semibold text-slate-900' : 'text-slate-500'
                                            }`}
                                        >
                                            {done && <Check className="w-3 h-3 text-emerald-700 shrink-0" />}
                                            <span className="truncate">{s.label}</span>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        )}

                        {/* No total until a trade is picked. How many steps
                            there are depends on the trade — a cleaner has four
                            and a plumber five — so announcing a number here
                            would be a guess, and one that changes under them
                            the moment they tap a card. */}
                        <p className={(chosen ? 'sm:hidden ' : '') + 'text-[11px] text-slate-500' + (chosen ? ' mt-1.5' : '')}>
                            {chosen ? 'Step ' + position + ' of ' + total + ' · ' + stepMeta.label : 'Step 1 of a few — it depends what you do'}
                        </p>
                    </div>
                </div>

                {/* ---- the questions ---- */}
                <div id="signup-panel" className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">

            {/* Read before the questions rather than under them, and it says
                which step: after a restore they are not on the first one, and
                a message that ignored that would read as the form having
                jumped somewhere on its own. */}
            {restored && !providerId && (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 mb-5">
                    <p className="text-sm text-emerald-900">
                        We kept what you filled in last time. You are back on step {position} of {total}.
                    </p>
                </div>
            )}

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

            {/* ---- STEP ONE: the trade ------------------------------------
                Folded in from the page it used to be. It is first because the
                trade decides what every later step asks — which prices, which
                registration numbers, whether there are skills at all — so
                nothing after this can be drawn until it is answered.

                The maintenance group opens in place rather than as a step of
                its own: it is the same question narrowed, and counting it
                would make a plumber's flow six steps and a cleaner's four for
                no reason a person would recognise. */}
            {onStep('trade') && (() => {
                const groupMeta = openGroup ? groupByKey(openGroup) : null;

                if (groupMeta) {
                    const taken = mine.map((x: any) => String(x.trade || ''));
                    const inGroup = tradesFor('host').filter((t) => groupForTrade(t.key) === groupMeta.key);

                    return (
                        <div>
                            <p className="text-sm text-slate-600 mb-5">
                                Pick the one people would ask for by name. You can add another
                                afterwards if you do more than one.
                            </p>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {inGroup.map((t) => {
                                    const Icon = TRADE_ICONS[t.key] || Wrench;
                                    const already = taken.indexOf(t.key) !== -1;

                                    return (
                                        <button
                                            key={t.key}
                                            type="button"
                                            onClick={() => chooseTrade(t.key)}
                                            className="rounded-2xl border border-slate-300 p-4 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                                        >
                                            <Icon className="w-7 h-7 text-emerald-700 mb-3" strokeWidth={1.5} />
                                            <span className="block font-semibold text-slate-900">{t.label}</span>
                                            {already && (
                                                <span className="block text-xs text-slate-500 mt-1">You have this one</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Said once, here, rather than on every trade that
                                needs it. Somebody who reads it now is not
                                surprised by it on the registration step. */}
                            <p className="text-xs text-slate-500 mt-6">
                                Gas work needs Gas Safe registration, oil needs OFTEC, and electrical work
                                has to be notified under Part P. We ask for your number and check it
                                before you go live.
                            </p>
                        </div>
                    );
                }

                const entries = pickerEntries(mine, 'host');
                const left = unclaimedTrades(mine, 'host');

                return (
                    <div>
                        <p className="text-sm text-slate-600 mb-5">
                            {mine.length > 0
                                ? 'Open one to change it, or set up another trade as its own business.'
                                : 'Pick the one that fits best. It decides what we ask you next, and who finds you.'}
                        </p>

                        {mine.length > 0 && (
                            <div className="space-y-3 mb-8">
                                {mine.map((x: any) => {
                                    const Icon = TRADE_ICONS[x.trade] || Sparkles;
                                    const summaryFor = statusSummary(x.status);

                                    return (
                                        <button
                                            key={x.id}
                                            type="button"
                                            onClick={() => chooseTrade(x.trade)}
                                            className="w-full flex items-center gap-3 rounded-2xl border border-slate-300 p-4 text-left hover:border-emerald-700 transition"
                                        >
                                            <Icon className="w-6 h-6 text-emerald-700 shrink-0" strokeWidth={1.5} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block font-semibold text-slate-900 truncate">
                                                    {x.business_name || tradeLabel(x.trade)}
                                                </span>
                                                <span className="block text-sm text-slate-500">{tradeLabel(x.trade)}</span>
                                            </span>
                                            <span
                                                className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                                                    PICKER_STATUS_STYLE[x.status] || PICKER_STATUS_STYLE.draft
                                                }`}
                                            >
                                                {summaryFor.label}
                                            </span>
                                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {entries.length > 0 && (
                            <>
                                {mine.length > 0 && (
                                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                                        Add another trade
                                    </h2>
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {entries.map((entry) => {
                                        const Icon = entry.kind === 'group'
                                            ? (GROUP_ICONS[entry.key] || Wrench)
                                            : (TRADE_ICONS[entry.key] || Sparkles);

                                        return (
                                            <button
                                                key={entry.kind + ':' + entry.key}
                                                type="button"
                                                onClick={() =>
                                                    entry.kind === 'group' ? setOpenGroup(entry.key) : chooseTrade(entry.key)
                                                }
                                                className="rounded-2xl border border-slate-300 p-4 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                                            >
                                                <Icon className="w-7 h-7 text-emerald-700 mb-3" strokeWidth={1.5} />
                                                <span className="block font-semibold text-slate-900">{entry.label}</span>
                                                {entry.kind === 'group' && (
                                                    <span className="block text-xs text-slate-500 mt-1">{entry.hint}</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {left.length === 0 && mine.length > 0 && (
                            <p className="text-sm text-slate-500">You have signed up for every trade we cover.</p>
                        )}
                    </div>
                );
            })()}

            <fieldset disabled={locked} className={locked ? 'opacity-70' : ''}>
                {onStep('business') && (
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
                            <p data-problem className="text-sm text-rose-700 mt-1.5">{problemFor('business_name')!.message}</p>
                        )}
                    </section>
                )}

                {/* Photos and the logo moved to the last step with the account
                    tick box. They are the one part of this that is genuinely
                    optional, and they are also the slowest — uploading four
                    photos over a phone signal in somebody's driveway is not
                    what should stand between a tradesman and the rest of the
                    questions. */}
                {onStep('finish') && (imageryFor(trade) === 'logo' ? (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your logo</h2>
                        <p className="text-sm text-slate-500 mb-3">
                            Optional. If you have not got one we will show your initials.
                            {!session && ' You can add one as soon as this is sent — it does not hold up your listing, and you will not have to fill anything in again.'}
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
                ))}

                {/* The trade chip is gone: it said what they picked, and the
                    modal header now says that on every step. */}

                {onStep('business') && (
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
                        <p data-problem className="text-sm text-rose-700 mt-1.5">{problemFor('description')!.message}</p>
                    )}
                </section>
                )}

                {/* Facts about the property, not about the provider — a
                    window cleaner does not have a building type. They are here
                    so that real window cleaners can see what they will be told
                    before they quote, and they move to the owner's side once
                    that is built.

                    Deliberately not saved anywhere: there is no column for
                    them on a provider and there should not be one, so the
                    panel says so rather than quietly losing what is typed. */}
                {onStep('prices') && trade === 'droplet' && (
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
                {/* The choice, and only for a cleaner the platform bills
                    itself. A public applicant never reaches this: `kind`
                    defaults to external, the sign-up never writes it, and the
                    database refuses an hourly row that is not in-house — so
                    the question simply is not asked of them. */}
                {onStep('prices') && hourlyAllowed && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">How do you charge?</h2>
                        <p className="text-sm text-slate-500 mb-3">
                            One or the other. You can change it later.
                        </p>

                        <div className="flex flex-wrap gap-2">
                            {[
                                { key: 'bands', label: 'A price per house size' },
                                { key: 'hourly', label: 'An hourly rate' },
                            ].map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setPricingChoice(option.key as 'bands' | 'hourly')}
                                    aria-pressed={pricingChoice === option.key}
                                    className={`rounded-full border px-5 py-2.5 text-sm font-semibold transition ${
                                        pricingChoice === option.key
                                            ? 'border-emerald-700 bg-emerald-700 text-white'
                                            : 'border-slate-300 text-slate-700 hover:border-slate-500'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {/* The hourly half: what she charges, and which sizes she will
                    take. The second question is not optional dressing — a
                    blank band means "I do not cover this", so without an
                    explicit answer an hourly cleaner would drop out of every
                    band-filtered list at once and look like nobody had
                    searched for her. */}
                {onStep('prices') && onHourly && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your hourly rate</h2>
                        <p className="text-sm text-slate-500 mb-3">
                            We send the bill, so this is the rate we bill at.
                        </p>

                        <div className="flex items-center gap-2 md:max-w-xs">
                            <span className="text-slate-500">&pound;</span>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={billableHourlyRate}
                                onChange={(e) => setBillableHourlyRate(e.target.value)}
                                placeholder="18"
                                className="w-full min-w-0 rounded-xl border border-slate-300 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                            />
                            <span className="text-sm text-slate-500 whitespace-nowrap">an hour</span>
                        </div>
                        {problemFor('billable_hourly_rate') && (
                            <p data-problem className="text-sm text-rose-700 mt-1.5">
                                {problemFor('billable_hourly_rate')!.message}
                            </p>
                        )}

                        <h3 className="text-sm font-semibold text-slate-900 mt-6 mb-1.5">
                            Which sizes will you take?
                        </h3>
                        <p className="text-sm text-slate-500 mb-3">
                            Owners search by the size of the property. Leave one off and you will not be
                            shown for it.
                        </p>

                        <div className="space-y-2">
                            {bands.map((band) => {
                                const on = coveredBands.indexOf(band.key) !== -1;

                                return (
                                    <label
                                        key={band.key}
                                        className={`flex items-center gap-3 rounded-xl border p-3.5 cursor-pointer transition ${
                                            on ? 'border-emerald-700 bg-emerald-50/40' : 'border-slate-300'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            onChange={() =>
                                                setCoveredBands(on
                                                    ? coveredBands.filter((b) => b !== band.key)
                                                    : [...coveredBands, band.key])
                                            }
                                            className="w-4 h-4 rounded border-slate-300 shrink-0"
                                        />
                                        <span className="text-sm font-medium text-slate-900">{band.label}</span>
                                    </label>
                                );
                            })}
                        </div>
                        {problemFor('covered_bands') && (
                            <p data-problem className="text-sm text-rose-700 mt-2">
                                {problemFor('covered_bands')!.message}
                            </p>
                        )}
                    </section>
                )}

                {onStep('prices') && model === 'bands' && !onHourly && (
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
                                                <p data-problem className="text-xs text-rose-700 mt-1">{priceProblem.message}</p>
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
                                                        <p data-problem className="text-xs text-rose-700 mt-1">{hoursProblem.message}</p>
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
                            <p data-problem className="text-sm text-rose-700 mt-2">{problemFor('prices')!.message}</p>
                        )}

                        {/* Beside the number it governs, not a section away.
                            This is the one a provider will argue about later. */}
                        <p className="text-sm text-slate-600 mt-3">
                            <strong className="font-semibold text-slate-900">Your price is the most you can charge.</strong>
                        </p>

                    </section>
                )}

                {onStep('prices') && trade === 'droplet' && (
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
                {onStep('prices') && isCallout && (
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
                                    <p data-problem className="text-xs text-rose-700 mt-1">{problemFor('callout_fee')!.message}</p>
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
                                        <p data-problem className="text-xs text-rose-700 mt-1">{problemFor('hourly_rate')!.message}</p>
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
                {onStep('credentials') && (asksAboutFuel(trade) || trade === 'electrician') && (
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
                                    <p data-problem className="text-xs text-rose-700 mt-1.5">
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
                                            <p data-problem className="text-xs text-rose-700 mt-1">
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
                {/* CAPABILITY — on the "what you do" step, beside the
                    registration numbers and the skills.

                    This spent a fortnight under "What you charge", because the
                    code calls these extras and step four was specified as
                    "prices and extras". They are extras in the storage sense
                    and a capability list in every sense a person cares about —
                    a roofer met fifteen tick boxes about roofs under a heading
                    promising prices, and the handyman's twelve were a step
                    away from the skills box they belong beside.

                    Split per entry rather than per trade: the electrician's
                    EICR fee and the roofer's one priced entry stay with the
                    prices, because those genuinely are prices. */}
                {onStep('credentials') && capability.length > 0 && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">
                            {hasFaults ? 'What do you get called out for?' : 'What do you take on?'}
                        </h2>
                        <p className="text-sm text-slate-500 mb-4">
                            {hasFaults
                                ? 'All optional, but this is how owners find you. Somebody with a problem searches for the problem, not for a trade.'
                                : 'All optional. Owners compare on these, so it is worth saying yes to what you actually do.'}
                        </p>

                        {toggleBlock('faults', groupLabel('faults'))}
                        {toggleBlock('planned', groupLabel('planned'))}
                        {toggleBlock('availability', groupLabel('availability'))}
                    </section>
                )}

                {/* Skills sit UNDER the tick boxes above, not over them.
                    The standard set is the common case for every handyman;
                    the tags are the extra, for the jobs that do not fit a
                    box. Asking the open question first put the unusual
                    thing before the usual one. */}
                {onStep('credentials') && hasSkills && (
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

                        {/* The box first, the list underneath it once they
                            focus. Short by default, and never blank when they
                            are actually about to type into it. */}
                        <input
                            type="text"
                            value={skillTyped}
                            onFocus={() => setSkillsListOpen(true)}
                            onChange={(e) => setSkillTyped(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                // Otherwise Enter submits the form, which on a
                                // half-typed tag is the worst possible moment.
                                e.preventDefault();
                                if (tagsToShow.length > 0) addSkill(String(tagsToShow[0].label));
                                else addSkill(skillTyped);
                            }}
                            placeholder="Search, or type your own"
                            className="w-full md:max-w-sm rounded-xl border border-slate-300 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />

                        {skillsListOpen && (
                            <div className="mt-3 md:max-w-sm">
                                {tagsToShow.length > 0 && (
                                    <>
                                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                            {skillTyped.trim() === '' ? 'Tap any that fit' : 'Matching'}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {tagsToShow.map((tag: any) => (
                                                <button
                                                    key={tag.id || tag.slug || tag.label}
                                                    type="button"
                                                    onClick={() => addSkill(String(tag.label))}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                                                >
                                                    <Plus className="w-3.5 h-3.5 text-emerald-700" />
                                                    {tag.label}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}

                                {/* Once open it stays open, deliberately.
                                    Closing on blur is the obvious thing and it
                                    is wrong twice: blur fires before a chip's
                                    click lands, so the chips become untappable,
                                    and somebody adding four tags would have to
                                    re-open the list between each one.

                                    So there is a way out instead of a rule. */}
                                <div className="flex items-center gap-4 mt-3">
                                    {matchingTags.length > TAGS_SHOWN_CLOSED && (
                                        <button
                                            type="button"
                                            onClick={() => setAllTagsOpen(!allTagsOpen)}
                                            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline"
                                        >
                                            {allTagsOpen ? 'Show fewer' : 'Show all ' + matchingTags.length}
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSkillsListOpen(false);
                                            setAllTagsOpen(false);
                                        }}
                                        className="text-sm font-semibold text-slate-500 hover:text-slate-800 underline"
                                    >
                                        Hide the list
                                    </button>
                                </div>

                                {/* The fallback, for the job that genuinely is
                                    not on the list. Offered last and looking
                                    different, so taking an existing tag stays
                                    the easier of the two — that preference is
                                    the whole anti-fragmentation mechanism. */}
                                {skillIsNew && skillTyped.trim() !== '' && (
                                    <button
                                        type="button"
                                        onClick={() => addSkill(skillTyped)}
                                        className="block w-full text-left rounded-lg px-3 py-2 mt-3 text-sm text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                                    >
                                        Add &ldquo;{(skillKey(skillTyped) || { label: skillTyped }).label}&rdquo; as a new one
                                    </button>
                                )}

                                {/* Typed something that matches nothing and is
                                    not new either — it exists but is regulated
                                    or already held. The panel below says which,
                                    so this only has to stop the list looking
                                    broken. */}
                                {tagsToShow.length === 0 && !skillIsNew && skillTyped.trim() !== '' && (
                                    <p className="text-sm text-slate-500">
                                        Nothing matches that.
                                    </p>
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

                {/* What genuinely belongs beside a price: the gated groups that
                    ask before they show one, and `about` — two toggles on the
                    cleaner that read correctly next to her laundry and hot-tub
                    prices, and would be a fifth step carrying nothing else. */}
                {/* Gated on what will actually appear, not on what the trade
                    owns. `priced` entries are counted by pricedOfferingsFor
                    but nothing renders them — the electrician's EICR fee and
                    the roofer's survey have never appeared on this form, on
                    the long page either — so going by the count alone gave the
                    roofer a heading and an intro with nothing underneath.
                    Empty sections are the same fault as empty steps. */}
                {onStep('prices') && offersSomethingVisible && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">
                            What else do you offer?
                        </h2>
                        <p className="text-sm text-slate-500 mb-4">
                            All optional. Owners compare on these, so it is worth saying yes to what you
                            actually do.
                        </p>

                        {toggleBlock('about', '')}

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
                                                                <p data-problem className="text-xs text-rose-700 mt-1">{problem.message}</p>
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


                {onStep('business') && (
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
                        <p data-problem className="text-sm text-rose-700 mt-2">{problemFor('areas')!.message}</p>
                    )}
                </section>
                )}

                {onStep('business') && (
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
                            <p data-problem className="text-sm text-rose-700 mt-1.5">{problemFor('contact_email')!.message}</p>
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
                )}
            </fieldset>



            {/* The account, inline, made out of what they have already typed.
                This was a login wall: a tradesman filled in the whole form and
                then met a door. Now the last field on the form is a password
                and the button that sends it also makes the account.

                No second email box. Their contact address is the account
                address — asking again is asking a question we know the answer
                to, and two addresses that can disagree is a support problem
                waiting to happen. */}
            {onStep('finish') && !session && !checkYourEmail && (
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

                    {/* What it costs, beside the tick box that agrees to it.
                        Nothing on the site said this before — the model lived
                        in conversations — and this is the one moment somebody
                        is agreeing to something, so it is the one place it has
                        to appear. Worded by lib/serviceProviders.ts planTerms,
                        so this and the approval email cannot differ. */}
                    <p className="text-sm text-slate-600 mt-4 rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                        {planTerms(trade)}
                    </p>

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
                        <p data-problem className="text-sm text-rose-700 mt-2">{acctError}</p>
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
            {onStep('finish') && checkYourEmail && (
                <div className="rounded-2xl border-2 border-emerald-700 bg-emerald-50 p-5 mb-8">
                    <p className="font-semibold text-emerald-900">Check your email</p>
                    <p className="text-sm text-emerald-900/80 mt-1">
                        We have sent a link to <strong>{contactEmail.trim()}</strong>. Open it and you will
                        come straight back here with everything you have filled in still on the page —
                        then press send.
                    </p>
                </div>
            )}

            {onStep('finish') && !locked && (
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
                        </>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            {/* The button that sends this is in the modal
                                footer with Back, where every other step keeps
                                its forward action. What stays here is the
                                wording that only makes sense beside the form.

                                "Save and finish later" is a promise that needs
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

                </div>{/* /the questions */}

                {/* ---- footer: Back, and the way on ----
                    Fixed to the bottom of the modal rather than sitting under
                    the content, so on a phone the way forward is under your
                    thumb instead of below the fold. */}
                <div className="shrink-0 border-t border-slate-200 bg-white px-4 sm:px-6 py-3 flex items-center gap-3">
                    {/* Back keeps everything. It is a state change and never a
                        route change: routing would remount this component and
                        take every field with it, which is the bug that makes
                        people distrust a stepped form. */}
                    {(position > 1 || openGroup) ? (
                        <button
                            type="button"
                            onClick={goBack}
                            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 sm:px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500 transition"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Back
                        </button>
                    ) : (
                        <Link
                            href="/business"
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500 transition"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Back
                        </Link>
                    )}

                    <div className="flex-1" />

                    {/* Step one has no Next: choosing the trade is what moves
                        it on, and a Next beside it would be a button that
                        cannot do anything until a card is tapped.

                        The last step has no Next either -- it has send, which
                        is already in the panel above with the words about what
                        it does. Two buttons that both look like the end of the
                        form is one too many. */}
                    {step !== 'trade' && !lastStep && (
                        <button
                            type="button"
                            onClick={goNext}
                            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-2.5 text-sm font-semibold transition"
                        >
                            Next
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    )}

                    {/* The last step's forward action, in the place every other
                        step keeps one: Back on the left, the thing that moves
                        you on to the right. It used to sit in the panel body,
                        which meant the one button somebody had come five steps
                        to press was the only one they had to go looking for.

                        `min-w-0` and the truncating label are what stop it
                        colliding with Back at 375: "Create account and send" is
                        the longest label the form has, and the two buttons plus
                        their padding do not fit a phone otherwise. */}
                    {lastStep && !locked && (
                        <button
                            type="button"
                            onClick={() => save(true)}
                            disabled={saving || acctBusy}
                            className="min-w-0 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-5 sm:px-6 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                        >
                            <span className="block truncate">
                                {status === 'approved'
                                    ? (saving ? 'Saving…' : 'Save changes')
                                    : acctBusy
                                        ? 'Making your account…'
                                        : saving
                                            ? 'Sending…'
                                            : session
                                                ? 'Send for review'
                                                : 'Create account and send'}
                            </span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ProviderSignUp() {
    // useSearchParams needs a boundary, the same as the query-string reader in
    // the root layout.
    return (
        <Suspense fallback={<div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>}>
            <ApplicationForm />
        </Suspense>
    );
}
