'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import {
    Sparkles, Wrench, Trees, Droplet, ChefHat, Cake, ShoppingBasket, Trash2,
    Plus, Minus, X, ChevronLeft, ChevronRight, ChevronDown, Check, Zap, Hammer, Paintbrush, Home,
    ImagePlus, User, Pencil,
    MapPin, Tag, ListChecks, Flag, Image as ImageIcon,
} from 'lucide-react';
import { TradeTile, TradeTileGrid, TRADE_ICONS, GROUP_ICONS } from '@/components/services/TradeTiles';
import { compressImage } from '@/lib/compressImage';
import { getImageUrl, generateRandomNumber, firstName } from '@/lib/utils';
import { buildStreetAddress } from '@/lib/address';
import { ORDER_UNITS } from '@/lib/serviceOrders';
import { slotOfferingFromUnits, offeringHasShared, type SlotOffering } from '@/lib/serviceSlots';
import Env from '@/config/Env';
import {
    skillKey,
    suggestSkills,
    wouldCreateNew,
} from '@/lib/serviceSkills';
import EmailFirstStep from '@/components/auth/EmailFirstStep';
import ProviderExperienceDashboard from '@/components/services/ProviderExperienceDashboard';
import {
    tradeLabel,
    audienceForTrade,
    extrasFor,
    extrasProblems,
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
    pricingModelFor,
    offersHourlyChoice,
    pickerEntries,
    unclaimedTrades,
    isTradeComingSoon,
    tradesFor,
    groupByKey,
    bandsFor,
    REVIEW_WITHIN_HOURS,
    GUEST_CATEGORIES,
    GUEST_GROUPS,
    categoriesForGroup,
    guestCategoryByKey,
    guestCategoryIsFood,
    guestAsksExpertise,
    guestAsksQualifications,
    slotAsksWhereFork,
    slotIsMeetingPoint,
    slotDurationPerItem,
    slotMixedDuration,
    defaultSlotFulfilment,
    collectionFieldsForWrite,
    DIETARY_OPTIONS,
    DEFAULT_SERVICE_COMMISSION,
} from '@/lib/serviceProviders';
import { serviceCommission } from '@/lib/pricing';
import { PROVIDER_TERMS, PROVIDER_TERMS_VERSION } from '@/lib/providerTerms';
import { GUEST_SCREEN_COPY, GUEST_REGIONS, GUEST_COVERAGE_ALL_KEY, HOST_LOCATION_COPY } from '@/lib/strings';
import { PhotoEditorGrid } from './PhotoEditorGrid';
import {
    stepsFor,
    stepNumber,
    stepCount,
    nextStep,
    previousStep,
    isLastStep,
    resolveStep,
    openingStep,
    openingVisited,
    problemsOnStep,
    firstStepWithProblem,
    stepForField,
    sectionsFor,
    sectionForStep,
    StepKey,
    StepContext,
} from '@/lib/joinSteps';

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

// The number the years opener shows from load. It is the accepted answer, not a
// placeholder: someone whose real answer is this presses Next straight through
// and it is stored (see the years case in the footer's onNext). Shown solid
// black; the host nudges or types to change it.
const YEARS_DEFAULT = 5;
// The max-guests default follows the shape, the way the wording does. For a
// SLOT the number becomes sellable seats (via sessionCapacity), so it starts
// low — a shared slot holds at least two, so 2 is at or below any real capacity
// and tapping straight through can never oversell. For COMES-TO-YOU it is purely
// descriptive (no seat consequence), so a chef who taps through should say a
// realistic group size rather than two and filter herself out of every group
// booking; 6 is a sensible dinner party.
const CAPACITY_DEFAULT_SLOT = 2;
const CAPACITY_DEFAULT_TRAVEL = 6;

// A −/+ stepper with a big display number, in the register Airbnb use for every
// count in their host flow (a guest picks a number by nudging it, not by typing
// into a small box). Used for the counts on the where-and-when step — session
// length, group size, days of notice.
//
// NOTHING PERSISTS UNTIL THE HOST TOUCHES IT. `value` empty is "not set yet":
// the stepper shows `suggestion` greyed as a hint, but the stored value stays
// empty — so the draft and the record carry nothing the host didn't choose. The
// first nudge adopts the suggestion (a real value now), and typing sets any
// number directly; either way the value becomes the host's. The step that holds
// one of these can't be passed until it is non-empty (gated in the footer). The
// value stays a string to match the fields it replaced.
function NumberStepper({
    value, onChange, min = 0, max = 999, step = 1, suffix, suggestion, size = 'md', solid = false,
}: {
    value: string;
    onChange: (v: string) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    suggestion?: number;
    // 'lg' is the whole-screen years opener: a huge display numeral and larger
    // buttons. 'md' is the inline count on the where-and-when step.
    size?: 'md' | 'lg';
    // solid: show the number in solid black from load — the suggestion is a
    // starting position, not a greyed placeholder, and there is no visual
    // difference between touched and untouched. It STILL stores nothing until
    // touched: the parent value stays empty until a nudge or a type commits, so
    // an untouched starting number never reaches the draft or the record.
    //
    // Use solid ONLY where the step is NOT gated — the screens whose Next is
    // enabled from load and whose onNext stores the shown default (years,
    // capacity, notice, session length). There a plus/minus genuinely MOVES the
    // number, because the shown value is already the accepted answer.
    //
    // A GATED stepper (Next/Save disabled until touched) must NOT be solid: the
    // greyed path below adopts the suggestion on the first press of either
    // button — so accepting the suggestion is one press, not a press up and back
    // down — and turns solid once touched, which is the signal that the required
    // input has been given. The per-treatment duration is the gated one.
    solid?: boolean;
}) {
    const has = String(value).trim() !== '' && Number.isFinite(Number(value));
    const shown = has ? Number(value) : (suggestion ?? min);
    const commit = (n: number) => onChange(String(Math.max(min, Math.min(max, Math.round(n)))));
    // solid: a nudge always MOVES from the shown starting position and commits
    // (tap + goes up, tap − goes down), because the number is already visible.
    // greyed: the first nudge ADOPTS the suggestion, then moves.
    const nudge = (dir: number) => ((solid || has) ? commit(shown + dir * step) : commit(suggestion ?? min));

    const lg = size === 'lg';
    // lg is the whole-screen stepper (years, guests, notice). It is sized DOWN on
    // a phone — at full desktop size the number field plus the two circles and the
    // suffix are wider than a 375px screen and clip at both edges. Desktop keeps
    // the big size via the sm: breakpoints.
    const circle =
        (lg ? 'h-14 w-14 sm:h-16 sm:w-16 ' : 'h-11 w-11 ')
        + 'flex flex-none items-center justify-center rounded-full border border-slate-300 '
        + 'text-slate-600 transition hover:border-slate-500 focus:outline-none focus-visible:ring-2 '
        + 'focus-visible:ring-emerald-600 disabled:opacity-40 disabled:hover:border-slate-300';
    const glyph = lg ? 'h-5 w-5 sm:h-6 sm:w-6' : 'h-4 w-4';
    const numberField = lg
        ? 'w-28 sm:w-44 bg-transparent text-center text-7xl sm:text-9xl font-extrabold tabular-nums text-slate-900 placeholder:font-extrabold placeholder:text-slate-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
        : 'w-16 bg-transparent text-center text-4xl font-extrabold tabular-nums text-slate-900 placeholder:font-extrabold placeholder:text-slate-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

    return (
        <div className={'flex items-center ' + (lg ? 'gap-4 sm:gap-10' : 'gap-4')}>
            <button type="button" onClick={() => nudge(-1)} disabled={has && shown <= min}
                aria-label="Decrease" className={circle}>
                <Minus className={glyph} strokeWidth={2} />
            </button>
            <input
                type="number" inputMode="numeric" aria-label="Amount"
                value={solid ? String(shown) : (has ? String(shown) : '')}
                placeholder={solid ? undefined : (suggestion !== undefined ? String(suggestion) : '')}
                onChange={(e) => onChange(e.target.value)}
                className={numberField}
            />
            <button type="button" onClick={() => nudge(1)} disabled={has && shown >= max}
                aria-label="Increase" className={circle}>
                <Plus className={glyph} strokeWidth={2} />
            </button>
            {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
        </div>
    );
}

// A collapsed hub row, Airbnb-style: a square button on the left (a plus when
// empty, a check once filled), a bold label with a grey one-line description
// beside it, and a chevron on the right. Tapping it opens that thing's sub-flow.
// Reusable — the same pattern is wanted on later screens.
function HubRow({ filled, label, suffix, prompt, summary, onOpen, thumb }: {
    filled: boolean;
    label: string;
    // An "(optional)" style suffix rendered after the label in lighter grey.
    suffix?: string;
    prompt: string;
    summary?: string | null;
    onOpen: () => void;
    // A resolved image URL. When set, the leading square shows the photo instead
    // of the plus/check glyph — a menu item sells on its picture, so the row
    // carries a thumbnail the way Airbnb's itinerary rows do.
    thumb?: string | null;
}) {
    return (
        <button type="button" onClick={onOpen}
            className="flex w-full items-center gap-4 rounded-2xl px-2 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            {thumb ? (
                <span className="h-11 w-11 flex-none overflow-hidden rounded-xl bg-slate-100">
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                </span>
            ) : (
            <span aria-hidden className={'flex h-11 w-11 flex-none items-center justify-center rounded-xl border transition '
                + (filled ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-slate-50 text-slate-500')}>
                {filled ? <Check className="h-5 w-5" strokeWidth={2.5} /> : <Plus className="h-5 w-5" />}
            </span>
            )}
            <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">
                    {label}{suffix && <span className="font-normal text-slate-400"> {suffix}</span>}
                </span>
                <span className="block truncate text-sm text-slate-500">{filled && summary ? summary : prompt}</span>
            </span>
            <ChevronRight className="h-5 w-5 flex-none text-slate-400" />
        </button>
    );
}

// The one large, centred choice card every either/or fork in the guest wizard
// uses — the fulfilment fork (delivery / collection / both), the slot
// private/shared answer, and the slot come-to-me / travel fork. Tall so a
// screenful of two or three options fills the space, with the label above and
// the hint below, both centred. There is deliberately no second, smaller set
// of card styles: a fork that wants cards uses this. `radio` gives the button
// radiogroup semantics (role="radio" + aria-checked); without it the card is an
// aria-pressed toggle, which is what the slot forks use.
function ChoiceCard({ selected, onSelect, title, hint, radio }: {
    selected: boolean;
    onSelect: () => void;
    title: string;
    hint: string;
    radio?: boolean;
}) {
    return (
        // Content is top-aligned, not centred: these cards sit in a stretched
        // grid row (all as tall as the wordiest one), and a centred body would
        // float each title to a different height — a staircase, when they are
        // one row of choices. Anchored to the top, every title lines up and the
        // hint hangs beneath it, however many lines each runs to. The title
        // reserves two lines so a one-line title (Both) starts its hint at the
        // same place as a two-line one.
        <button type="button" onClick={onSelect}
            {...(radio ? { role: 'radio', 'aria-checked': selected } : { 'aria-pressed': selected })}
            className={'flex min-h-[9rem] flex-col items-center justify-start gap-1.5 rounded-2xl border-2 bg-white px-5 py-7 text-center transition hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 sm:min-h-[13rem] sm:py-9 '
                + (selected ? 'border-emerald-600 shadow-sm' : 'border-slate-200 hover:border-slate-300')}>
            <span className="flex items-center text-lg font-semibold text-slate-900 sm:min-h-[3.5rem]">{title}</span>
            <span className="text-sm text-slate-500">{hint}</span>
        </button>
    );
}

// The sub-flow modal a hub row opens, styled to match Airbnb's: a large centred
// card, a big heading, then a single borderless field floating in a lot of white
// space (the field is passed in as children — no box, no fill, just placeholder
// and cursor). An optional helper `note` sits at the bottom of the body, just
// above the Save row rather than under the field. Save bottom right, disabled
// until something is typed; the X closes without saving.
//
// One field per modal is what keeps it this clean. Fields edit live component
// state, so Save and the X both just close; the draft saves as they type.
function SubFlowModal({ open, title, onClose, saveLabel, saveDisabled, note, children, onSave, onBack, onRemove }: {
    open: boolean;
    title: string;
    onClose: () => void;
    saveLabel: string;
    saveDisabled?: boolean;
    note?: React.ReactNode;
    children: React.ReactNode;
    // The primary button's action. Defaults to onClose (the single-field case,
    // where the field edits live state and there is nothing to do but close).
    // A stepped sub-flow passes onSave to advance to the next step instead.
    onSave?: () => void;
    // When set, a back chevron shows top-left — a stepped sub-flow uses it to
    // go to the previous step. The single-field modals leave it unset.
    onBack?: () => void;
    // When set, a quiet Remove link shows bottom-left — for a row that can be
    // deleted (a menu item), matching Airbnb's Edit/Remove on an itinerary row.
    onRemove?: () => void;
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6"
            onClick={onClose}>
            <div className="flex max-h-[92vh] min-h-[62vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-h-[88vh] sm:min-h-[34rem] sm:max-w-2xl sm:rounded-3xl"
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-8">
                    {onBack ? (
                        <button type="button" onClick={onBack} aria-label="Back"
                            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                    ) : <span className="h-9 w-9" />}
                    <button type="button" onClick={onClose} aria-label="Close"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-3 sm:px-14">
                    <h2 className="text-center text-2xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance] sm:text-3xl">{title}</h2>
                    {/* The field floats in the middle white space; the note (if
                        any) is pushed to the bottom, just above the Save row. */}
                    <div className="flex flex-1 flex-col justify-center py-10">{children}</div>
                    {note && <p className="text-center text-sm text-slate-500 [text-wrap:balance]">{note}</p>}
                </div>
                <div className="flex items-center border-t border-slate-100 px-6 py-4 sm:px-8">
                    {onRemove && (
                        <button type="button" onClick={onRemove}
                            className="text-sm font-semibold text-rose-600 hover:text-rose-700">
                            Remove
                        </button>
                    )}
                    <div className="flex-1" />
                    <button type="button" onClick={onSave || onClose} disabled={saveDisabled}
                        className={'rounded-full px-7 py-2.5 text-sm font-semibold transition '
                            + (saveDisabled
                                ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                                : 'bg-emerald-700 text-white hover:bg-emerald-800')}>
                        {saveLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

// The rail's per-section icon. The circle carries state by colour (done fills
// emerald, active rings emerald, upcoming is grey); the glyph inside says which
// section it is, so a collapsed strip is legible and no circle is ever bare.
// A done section swaps its icon for a check — completion reads at a glance, and
// the section is identifiable by position and hover label. Numbers were the
// obvious alternative and are wrong here: the flow is not a fixed sequence (a
// sauna skips About you), so a numbered rail would read 1, 3, 4.
// The two photographs on the empty Photos screen, shown as an overlapping,
// opposing-tilt pair (Airbnb's composition). Licensed iStock stock (see
// public/images/experience-photos/README.md for asset ids and credits),
// web-sized to 800x1000 4:5 to match the frames. Swap the files or repoint here.
const EXPERIENCE_PHOTOS = [
    { src: '/images/experience-photos/sauna.jpg', alt: 'A wood-fired sauna bucket in warm light' },
    { src: '/images/experience-photos/loaf.jpg', alt: 'A rustic sourdough loaf on a wooden table' },
];

// The empty-Photos composition card size — the AGREED value. Do not change the
// composition (this size, the tilt, overlap, stagger or button) again unless
// asked. This is the commit-90a3c20 size (w-40 sm:w-60) reduced ~10–15%.
const PHOTO_CARD_SIZE = 'w-36 sm:w-52';

const SECTION_ICONS: Record<string, React.ComponentType<any>> = {
    about: User,
    location: MapPin,
    photos: ImageIcon,
    pricing: Tag,
    details: ListChecks,
    experience: Sparkles,
    finish: Flag,
    // Host-trade sections (TRADE_SECTIONS) reuse the same icon set.
    business: User,
    credentials: ListChecks,
    prices: Tag,
};

function ApplicationForm() {
    const router = useRouter();
    const params = useSearchParams();

    // Chosen on step one and carried in the URL, so signing in halfway does
    // not lose it. A saved record wins once it loads — except when they have
    // just come back through "change", where the new pick is the point.
    const tradeFromUrl = String(params.get('trade') || '');
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    // The provider load failed (not "no application yet"). A failed select used
    // to fall through to a BLANK new-application form — a returning provider
    // could then create a second row over their real one. So a failure is held
    // and shown, never rendered as new.
    const [loadFailed, setLoadFailed] = useState(false);
    const [session, setSession] = useState<any>(null);

    const [providerId, setProviderId] = useState<string | null>(null);
    const [status, setStatus] = useState('draft');
    const [reviewNote, setReviewNote] = useState<string | null>(null);

    const [businessName, setBusinessName] = useState('');
    const [trade, setTrade] = useState(tradeFromUrl || 'sponge');
    const [description, setDescription] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [smsOptOut, setSmsOptOut] = useState(false);
    const [photos, setPhotos] = useState<string[]>([]);
    // The logo column is no longer collected at sign-up (a trade's headshot from
    // the About-you hub is its listing image now), but it is still LOADED and
    // re-saved so a provider who set one under the old flow keeps it.
    const [logo, setLogo] = useState<string | null>(null);
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

    // The "Other" trade: a name they type when their trade isn't listed. Stored
    // as trade='other' with the typed name in custom_label, so the rest of the
    // wizard treats it as an ordinary host trade.
    const [otherOpen, setOtherOpen] = useState<boolean>(false);
    const [otherText, setOtherText] = useState<string>('');

    // What they already have, for step one. One business per trade, so this is
    // a list of what they hold plus what is left.
    const [mine, setMine] = useState<any[]>([]);
    // The provider terms agreement on the finish screen (it replaced the single
    // responsibility tickbox, which replaced the per-category checks). `termsAgreed`
    // is the agree box; on submit it is recorded in the `declarations` jsonb as
    // { terms_version, terms_agreed_at } — the version they agreed to and when, so
    // a bare boolean can't hide that the text has moved on since. Required to send:
    // see the save() guard and the gated button. `termsError` is the gate message.
    const [termsAgreed, setTermsAgreed] = useState(false);
    const [termsError, setTermsError] = useState('');
    // The terms open in a modal from the agree line, so the finish screen itself
    // stays a preview of what they're submitting rather than a wall of terms.
    const [termsModalOpen, setTermsModalOpen] = useState(false);
    // The finish-screen byline: the provider's first name, shown beneath their
    // photo. Derived from the account (resolveGuestBylineNow is async), so it is
    // loaded into state when the finish screen is reached. The title itself is
    // now the Title field (professionalTitle), computed inline.
    const [summaryByline, setSummaryByline] = useState('');
    const [areas, setAreas] = useState<AreaRow[]>([]);

    const [saving, setSaving] = useState(false);
    const [touchedSubmit, setTouchedSubmit] = useState(false);

    // Keyed by band. Kept as strings so a half-typed price is not coerced to a
    // number mid-keystroke, and blank stays genuinely blank rather than 0.
    const [prices, setPrices] = useState<Record<string, { price: string; typical_hours: string }>>({});

    // The menu — what a guest trade sells, and for how much. A chef has a list
    // of one (their experience, one price); a baker has many. Prices stay
    // strings so a half-typed number is not coerced mid-keystroke.
    const [items, setItems] = useState<Array<{
        // id is present for a row loaded from the database, absent for one added
        // in this session — which is how the save upserts the first and inserts
        // the second, rather than deleting and re-inserting (and orphaning the
        // photos attached to them).
        id?: string;
        name: string;
        description: string;
        price: string;
        // 'flat' | 'person' | 'night' | 'hour' | 'ticket' | 'item'.
        unit: string;
        // The item's own photo, a storage path. The gallery is per item now.
        image: string | null;
        // The one-at-a-time shape (massage) only: this treatment's length in
        // minutes, as a string like the price. Empty/absent for every other
        // category, where the session length is the provider's single number.
        duration?: string;
        // Per-item location, only for a provider who answered 'both' to "where
        // does it happen?": 'collection' (at my place) | 'delivery' (I travel).
        // Absent for every single-place provider (the item inherits theirs).
        fulfilment?: string;
    }>>([]);
    // Which item row is uploading a photo, by index, so only that row shows a
    // spinner rather than all of them.
    const [uploadingItem, setUploadingItem] = useState<number | null>(null);

    // The price screen's per-item sub-flow (g_menu), rebuilt as a hub. `menuIndex`
    // is which item's sub-flow is open (null = the hub list); `menuStep` walks the
    // one-thing-a-screen sub-flow (0 name, 1 price+type, 2 description, 3 photo);
    // `payoutOpen` toggles the quiet "You keep £X" line into its maths card.
    const [menuIndex, setMenuIndex] = useState<number | null>(null);
    const [menuStep, setMenuStep] = useState(0);
    // True while authoring an item whose unit is already decided — a slot shape the
    // host opened from its named guidance row (a per-person seat, or the whole
    // session). Such an item skips the 'both' unit step: tapping the shape WAS the
    // unit choice. An "Add another option" item leaves this false and is asked.
    const [unitLocked, setUnitLocked] = useState(false);
    const [payoutOpen, setPayoutOpen] = useState(false);
    // The pricing-basis picker (the "How this is priced" sub-flow), opened from a
    // row on the price step — the last native <select> on this flow, replaced with
    // the coverage-picker pattern so it reads like the rest of the screen.
    const [unitPickerOpen, setUnitPickerOpen] = useState(false);

    // The section rail collapses to an icon-only strip, Airbnb-style. Kept in
    // state so it stays as you move between screens (steps are the same mounted
    // component), and mirrored to localStorage so it survives a reload too.
    const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
        try { return localStorage.getItem('gg.rail-collapsed') === '1'; } catch { return false; }
    });
    const toggleRail = () => setRailCollapsed((v) => {
        const next = !v;
        try { localStorage.setItem('gg.rail-collapsed', next ? '1' : '0'); } catch { /* private mode */ }
        return next;
    });

    // Who they are, for a guest trade only. A guest is choosing someone to come
    // into the cottage they are staying in, so the listing carries a bit of the
    // person and not only the price. A name and a line is what a real chef will
    // actually write — plus a photo of them, and their gallery, which is the
    // listing. All optional.
    const [providerName, setProviderName] = useState('');
    const [dietaryNote, setDietaryNote] = useState('');
    // What a food provider can cater for, as ticks (keys from DIETARY_OPTIONS).
    // Rides in guest_details.dietary_options (jsonb, no column); the note above
    // carries the caveats the ticks can't. Food categories only.
    const [dietaryOptions, setDietaryOptions] = useState<string[]>([]);
    const [headshot, setHeadshot] = useState<string | null>(null);
    const [uploadingHeadshot, setUploadingHeadshot] = useState(false);

    // --- Guest experience: the Airbnb-shaped content screens -----------------
    //
    // The questions that make a guest experience sell and that we need to take a
    // booking, added when the flow was rebuilt against Airbnb's (Sep 2026):
    //   - yearsDoing        how long they've done it (the momentum-first opener)
    //   - professionalTitle a short professional title ("Private chef")
    //   - qualifications    training and credentials — REQUIRED, the whole pitch
    //   - whatToExpect      what actually happens, so a guest knows what they get
    // "What's included" and "What a guest brings" used to live here too; they
    // were cut — dark data the listing never showed, and the item description and
    // price already cover them. `whatToExpect` is now DISPLAYED on the experience
    // page (guest_details.what_to_expect → experiencesData), so it earns its keep.
    const [yearsDoing, setYearsDoing] = useState('');
    const [professionalTitle, setProfessionalTitle] = useState('');
    // The listing's own name (g_title) — what the experience is CALLED, distinct
    // from professionalTitle above (what the PERSON is). It is written to
    // business_name at submit; professionalTitle rides in guest_details and shows
    // in the About block. On edit it loads from business_name, so an existing
    // provider — whose business_name is today their professional title — sees that
    // as the starting name and can refine it.
    const [listingTitle, setListingTitle] = useState('');
    const [qualifications, setQualifications] = useState('');
    const [recognition, setRecognition] = useState('');
    const [whatToExpect, setWhatToExpect] = useState('');
    // Which Details (g_expect) sub-flow is open — one field at a time, borderless,
    // like the rest of the flow: 'expect' for What happens, 'dietary' (food only).
    const [detailModal, setDetailModal] = useState<'expect' | 'dietary' | null>(null);
    const [uploadingPhotos, setUploadingPhotos] = useState(false);
    // Which expertise-hub sub-flow modal is open, if any.
    const [expertiseModal, setExpertiseModal] = useState<'title' | 'quals' | 'endorsements' | null>(null);
    // The photo circle at the top of the hub opens the file picker directly (via
    // this ref), and once a photo is set it offers replace/remove through a small
    // menu rather than reopening the Intro form.
    const headshotInputRef = useRef<HTMLInputElement>(null);
    const [photoMenuOpen, setPhotoMenuOpen] = useState(false);

    // --- Guest experience: category, shape, and the shape's own fields -------
    //
    // A guest is still the one trade 'guest'; these describe WHAT kind of thing
    // they offer and HOW a guest gets it. All are a starting point the owner
    // confirms at review — nothing here goes live on its own. The words "shape",
    // "unit" and "capacity kind" never reach the applicant; they answer plain
    // questions and these are inferred. See GUEST-EXPERIENCES-MARKETPLACE.md §10.
    //
    // `guestCategory` is the picked category key (lib/serviceProviders
    // GUEST_CATEGORIES); it pre-fills custom_label and gates the food question.
    // The top-level group picked first (GUEST_GROUPS); it decides which sub-type
    // screen shows. 'other' has no sub-type and goes straight to the business step.
    const [guestGroup, setGuestGroup] = useState('');
    const [guestCategory, setGuestCategory] = useState('');
    // 'comes_to_you' | 'made_to_order' | 'slot'. Pre-selected from the category,
    // confirmed by the plain "how do guests get it?" question, final say at review.
    const [shape, setShape] = useState('');
    // Made-to-order only: notice needed, in days ("how much notice do you need?").
    const [leadTimeDays, setLeadTimeDays] = useState('');
    // Made-to-order fulfilment: '' | 'delivery' | 'collection' | 'both' — the fork
    // between "you take it to the guest" (delivery regions) and "the guest comes to
    // you" (a private collection address). Separate from `shape` on purpose.
    const [fulfilment, setFulfilment] = useState('');
    // The collection address as three fields — a single blob can't be split back
    // into its town, and the town is what a guest reads (the public based_line).
    // Street and postcode stay private; the town's public copy is based_line.
    const [collectionStreet, setCollectionStreet] = useState('');
    const [collectionTown, setCollectionTown] = useState('');
    const [collectionPostcode, setCollectionPostcode] = useState('');
    // Whether the collection address is safe to write. TRUE for a fresh flow
    // (nothing to lose) and once a returning provider's address has actually been
    // read back from provider_private; FALSE for a returning provider until that
    // read succeeds. The write omits the collection fields while this is false AND
    // they are empty, so a not-loaded value can never blank a real one on save —
    // the same class of bug as the slot-capacity default. See guestProviderFields.
    const [collectionAddressLoaded, setCollectionAddressLoaded] = useState(true);
    // The optional address lookup (Ideal Postcodes) — suggestions for a typed
    // postcode. Manual entry is the primary path; this fills the fields when the
    // lookup is available and degrades to the manual message when it isn't.
    const [collectionLookupQuery, setCollectionLookupQuery] = useState('');
    const [collectionLookupResults, setCollectionLookupResults] = useState<Array<{ id: string; label: string }>>([]);
    const [collectionLookupBusy, setCollectionLookupBusy] = useState(false);
    const [collectionLookupError, setCollectionLookupError] = useState('');
    // Guards against an earlier search resolving after a later one when typing fast.
    const collectionLookupSeq = useRef(0);
    // A bottom fade on the suggestions list — a scroll signal that shows whether
    // or not the browser draws the scrollbar (macOS overlay bars fade out). True
    // while there is more of the list below the visible area.
    const collectionListRef = useRef<HTMLUListElement>(null);
    const [collectionMoreBelow, setCollectionMoreBelow] = useState(false);
    // The list's max height, measured to fit the space above the pinned footer so
    // the LIST scrolls itself rather than pushing the page. Null on mobile (and
    // before first measure), where the CSS max-height and native scroll stand.
    const [collectionListMaxH, setCollectionListMaxH] = useState<number | null>(null);
    // The three manual boxes stay hidden behind the lookup until they're needed —
    // the screen is just the postcode lookup by default. They open when the
    // provider chooses to type it by hand, when a lookup fills or fails, or when a
    // returning provider already has an address loaded (see showCollectionFields).
    const [collectionManual, setCollectionManual] = useState(false);
    // Slot only. `slotOffer` is what the provider sells: 'private' (the whole
    // session for one group — a flat price, one booking fills it), 'shared'
    // (several people join — a per-person price, seats = capacity), or 'both'
    // (offer either; each TIME is then sold as whichever a guest books first).
    // Null until asked. Inferred on load from the session items' UNITS, not the
    // capacity number — a private slot can hold many yet still sell whole — so a
    // returning host who set up under the old single-item model sees exactly what
    // they had (one flat item → 'private', one per-person item → 'shared'), never
    // silently upgraded to 'both'.
    const [slotOffer, setSlotOffer] = useState<SlotOffering | null>(null);
    // Maximum guests — the group size. Asked on its own screen in the Pricing
    // section (g_capacity). For a slot it is written to the slot_capacity column
    // (a shared slot sells that many seats via sessionCapacity; a private slot
    // records it but still sells whole); for a comes-to-you chef it rides in the
    // guest_details jsonb. Blank until set; the stepper shows a low default and
    // stores the shown value on an untouched pass, like the years screen.
    const [maxGuests, setMaxGuests] = useState('');
    const [slotLength, setSlotLength] = useState('');
    // Per-person slots only: the smallest group a single booking may be
    // (slot_min_people). Airbnb-style — the guest books and pays for at least
    // this many. Blank/1 means no minimum. Its own stepper screen (g_slot_min),
    // shown only for a shared slot; the booking route is the real gate, this is
    // the convenience floor. Loaded from slot_min_people on return.
    const [slotMinPeople, setSlotMinPeople] = useState('');
    // Choosing the offering (re)shapes the slot's item list to match: a private
    // hire is one flat item, a shared table one per-person item, 'both' is one of
    // each. Existing rows are kept BY UNIT, so a price already entered survives a
    // change of mind and a returning host's single item is preserved when they
    // add the second product; a fresh product gets a default name (so the row is
    // not nameless and dropped) and an empty price to set on the menu step.
    const applyOffer = (offer: SlotOffering) => {
        setSlotOffer(offer);
        // Keep the host's REAL items for the shapes this offer includes, and nothing
        // else — no blank starters. The pricing screen shows an unfilled shape as
        // named guidance that writes nothing to the draft or the record until the
        // host opens it and enters a price (the same rule as the years and capacity
        // steppers). A narrowed offer trims items to the shapes it still sells.
        setItems((prev) => {
            if (offer === 'private') return prev.filter((r) => String(r.unit) === 'flat');
            if (offer === 'shared') return prev.filter((r) => String(r.unit) === 'person');
            return prev;
        });
    };
    // The declarations jsonb, loaded from a returning provider's row. It now holds
    // the terms acceptance ({ terms_version, terms_agreed_at }), so values are not
    // all booleans — kept only to derive whether they've agreed to the CURRENT
    // terms version on return (see the load below).
    const [declarations, setDeclarations] = useState<Record<string, any>>({});
    // The weekly opening hours — one row per open period. day is 0..6 (0=Sunday).
    // Vestigial draft state only: weekly hours moved to the listing editor, so the
    // wizard neither shows nor writes them. The hours control and its
    // shared-hours/'simple'-vs-'perday' mode state were removed with that cut.
    const [schedule, setSchedule] = useState<Array<{ day: number; open: string; close: string }>>([]);
    // Keyed by extra. Price stays a string for the same reason band prices
    // do — a half-typed number should not be coerced mid-keystroke.
    const [extras, setExtras] = useState<Record<string, { offered: boolean; price: string; notes: string; quote?: boolean }>>({});
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
    // The unified pricing for every trade: a quote tick, an optional flat fee,
    // and the hourly/call-out fees above. Valid when quote OR hourly OR flat.
    const [provideQuote, setProvideQuote] = useState(false);
    const [flatFee, setFlatFee] = useState('');

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
    // The coverage-region picker modal on the guest location screen.
    const [areaPickerOpen, setAreaPickerOpen] = useState(false);
    // The town+radius sub-flow on the tradesman location screen. editIndex null
    // means adding a new area; otherwise it edits areas[editIndex]. The draft
    // holds the modal's working values so Save commits and the X discards.
    const [areaModalOpen, setAreaModalOpen] = useState(false);
    const [areaEditIndex, setAreaEditIndex] = useState<number | null>(null);
    const [areaDraftTown, setAreaDraftTown] = useState('');
    const [areaDraftRadius, setAreaDraftRadius] = useState<number>(10);
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
    // The single free-text registration number for gas & electrical trades,
    // replacing the pre-filled scheme checklist. A string for the same reason.
    const [registrationNumber, setRegistrationNumber] = useState('');

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
                const { data: existing, error: existingError } = await supabase
                    .from('service_providers')
                    // based_line and provider_name are deliberately absent: the
                    // wizard doesn't use them (based_line is derived server-side;
                    // provider_name was retired with the "Your name" field), and
                    // selecting a column the authenticated role can't read 403s
                    // the whole load. They stay revoked.
                    .select('id, business_name, trade, description, sms_opt_out, audience, photos, logo, status, review_note, callout_fee, hourly_rate, callout_waived, provides_quote, flat_fee, registration_number, does_gas, does_oil, kind, pricing_choice, billable_hourly_rate, covered_bands, headshot, dietary_note, custom_label, shape, lead_time_days, slot_length_minutes, slot_capacity, slot_min_people, declarations, guest_details, fulfilment')
                    .eq('owner_id', session.user.id)
                    .eq('trade', tradeFromUrl)
                    .maybeSingle();

                // A failed read is NOT "no application yet". `existing` would be
                // null either way, and the old code carried on into the blank
                // new-application form — so a returning provider whose read
                // errored (a revoked grant, a missing column mid-migration, a
                // network blip) could file a second row over their real one.
                // Stop and say so instead.
                if (existingError) throw existingError;

                if (existing) {
                    setProviderId(existing.id);
                    setBusinessName(existing.business_name || '');
                    // A guest's business_name IS the listing name, so seed the
                    // listing-title field from it. (A host reads business_name in
                    // its own field; this is guest-only and harmless otherwise.)
                    setListingTitle(existing.business_name || '');
                    setTrade(existing.trade || tradeFromUrl);
                    setDescription(existing.description || '');
                    // His own, through the view. The columns are revoked from
                    // every browser role — a column grant cannot say "his own
                    // row" — so service_provider_own_contacts is the one way
                    // in, and it can only ever return rows where
                    // owner_id = auth.uid(). See
                    // 20260828202340_contact_details_are_not_public.sql.
                    const { data: own } = await supabase
                        .from('service_provider_own_contacts')
                        .select('contact_email, contact_phone')
                        .eq('id', existing.id)
                        .maybeSingle();

                    setContactEmail((own && own.contact_email) || session.user.email || '');
                    setContactPhone((own && own.contact_phone) || '');
                    setSmsOptOut(!!existing.sms_opt_out);
                    setPhotos(existing.photos || []);
                    setLogo(existing.logo || null);
                    setStatus(existing.status || 'draft');
                    setDoesGas(existing.does_gas === true);
                    setDoesOil(existing.does_oil === true);
                    setReviewNote(existing.review_note || null);
                    setCalloutFee(existing.callout_fee === null || existing.callout_fee === undefined ? '' : String(existing.callout_fee));
                    setHourlyRate(existing.hourly_rate === null || existing.hourly_rate === undefined ? '' : String(existing.hourly_rate));
                    setCalloutWaived(existing.callout_waived === true);
                    setProvideQuote(existing.provides_quote === true);
                    setFlatFee(existing.flat_fee === null || existing.flat_fee === undefined ? '' : String(existing.flat_fee));
                    setRegistrationNumber(existing.registration_number || '');
                    setKind(existing.kind || 'external');
                    setPricingChoice(existing.pricing_choice === 'hourly' ? 'hourly' : 'bands');
                    setBillableHourlyRate(
                        existing.billable_hourly_rate === null || existing.billable_hourly_rate === undefined
                            ? ''
                            : String(existing.billable_hourly_rate)
                    );
                    setCoveredBands(Array.isArray(existing.covered_bands) ? existing.covered_bands : []);

                    // The menu, if they have one. Loaded in the order they set.
                    const { data: itemRows } = await supabase
                        .from('service_provider_items')
                        .select('id, name, description, price, unit, image, sort_order, created_at, duration_minutes, fulfilment')
                        .eq('provider_id', existing.id)
                        .order('sort_order', { ascending: true })
                        .order('created_at', { ascending: true });
                    if (itemRows && itemRows.length) {
                        setItems(itemRows.map((r: any) => ({
                            id: r.id,
                            name: r.name || '',
                            description: r.description || '',
                            price: r.price === null || r.price === undefined ? '' : String(r.price),
                            unit: r.unit || 'flat',
                            image: r.image || null,
                            duration: r.duration_minutes === null || r.duration_minutes === undefined ? '' : String(r.duration_minutes),
                            fulfilment: r.fulfilment || undefined,
                        })));
                    }

                    setDietaryNote((existing as any).dietary_note || '');
                    setHeadshot((existing as any).headshot || null);

                    // The guest shape and its own fields, so a returning provider
                    // edits what they set rather than a blank form. The category
                    // key is not stored (the owner-facing custom_label is the
                    // word); reverse-map it best-effort so the food question and
                    // the picker skip behave, and fall back to a non-empty marker
                    // so the picker is not shown again to somebody who has a row.
                    const ex = existing as any;
                    if (ex.shape) setShape(ex.shape);
                    if (ex.lead_time_days) setLeadTimeDays(String(ex.lead_time_days));
                    if (ex.fulfilment) setFulfilment(String(ex.fulfilment));
                    // The collection address is revoked on the table, so it can't
                    // ride the select above — the owner reads their own back through
                    // provider_private. Mark it NOT loaded until that read succeeds,
                    // so a failed read can't let a blank overwrite a real address on
                    // save (guestProviderFields omits it while unloaded + empty).
                    setCollectionAddressLoaded(false);
                    const { data: priv, error: privErr } = await supabase
                        .from('provider_private')
                        .select('collection_street, collection_town, collection_postcode')
                        .eq('id', existing.id).maybeSingle();
                    if (!privErr) {
                        setCollectionStreet((priv?.collection_street as string) || '');
                        setCollectionTown((priv?.collection_town as string) || '');
                        setCollectionPostcode((priv?.collection_postcode as string) || '');
                        setCollectionAddressLoaded(true);
                    }
                    if (ex.slot_length_minutes) setSlotLength(String(ex.slot_length_minutes));
                    // Capacity loads into the max-guests screen from the stored
                    // column (authoritative for existing slot listings, so an
                    // edit shows what they set rather than the stepper default).
                    if (ex.slot_capacity !== null && ex.slot_capacity !== undefined) {
                        setMaxGuests(String(ex.slot_capacity));
                    }
                    // The offering comes from the session items' UNITS, not the
                    // capacity number — a private slot can hold six yet sell whole.
                    // A flat item is a private hire, a per-person item a shared
                    // table; both present is 'both'. This is the returning-host
                    // path: someone who set up under the old single-item model has
                    // one item and no stored offering, and loads as exactly what
                    // that item is — 'private' or 'shared' — never flipped.
                    if (ex.shape === 'slot') {
                        setSlotOffer(slotOfferingFromUnits((itemRows || []).map((r: any) => r.unit)));
                        // The per-person minimum, only meaningful for a shared
                        // slot. Load it back so a returning host edits what they
                        // set; 1 (or unset) reads as no minimum.
                        if (ex.slot_min_people !== null && ex.slot_min_people !== undefined && Number(ex.slot_min_people) > 1) {
                            setSlotMinPeople(String(ex.slot_min_people));
                        }
                    }
                    if (audienceForTrade(existing.trade || tradeFromUrl) === 'guest') {
                        // The category key is persisted now (guest_details.category),
                        // so read it straight back. The label match is kept only as a
                        // fallback for rows saved before the key existed; 'other' is
                        // the last resort — "already past the picker" without claiming
                        // a food category it isn't.
                        const storedKey = ex.guest_details && typeof ex.guest_details === 'object'
                            ? String((ex.guest_details as any).category || '').trim()
                            : '';
                        const byLabel = GUEST_CATEGORIES.filter((c) => c.label && c.label === ex.custom_label)[0];
                        setGuestCategory(storedKey || (byLabel ? byLabel.key : 'other'));
                        // Their declarations, which now hold the terms acceptance.
                        // Pre-tick the agree box only if they already agreed to the
                        // CURRENT terms version — if the terms have moved on since,
                        // the box starts unticked so they agree to the new text.
                        if (ex.declarations && typeof ex.declarations === 'object') {
                            setDeclarations(ex.declarations as Record<string, any>);
                            setTermsAgreed((ex.declarations as any).terms_version === PROVIDER_TERMS_VERSION);
                        }
                        // Their content answers in their own words — the seven
                        // fields that now live in the guest_details jsonb column
                        // (20260906143712). A returning provider edits what they
                        // wrote rather than a blank form.
                        const gd = (ex.guest_details && typeof ex.guest_details === 'object') ? ex.guest_details : {};
                        if (gd.years_experience) setYearsDoing(String(gd.years_experience));
                        if (gd.professional_title) setProfessionalTitle(String(gd.professional_title));
                        if (gd.qualifications) setQualifications(String(gd.qualifications));
                        if (gd.recognition) setRecognition(String(gd.recognition));
                        if (gd.what_to_expect) setWhatToExpect(String(gd.what_to_expect));
                        if (Array.isArray(gd.dietary_options)) setDietaryOptions(gd.dietary_options as string[]);
                        // Max guests for a comes-to-you chef rides here (a slot's
                        // is loaded from slot_capacity above). Only set it when the
                        // column didn't already provide it, so a slot keeps its
                        // authoritative value.
                        if (ex.shape !== 'slot' && gd.max_guests) setMaxGuests(String(gd.max_guests));
                    }

                    // A slot's weekly hours and days off.
                    const { data: avail } = await supabase
                        .from('slot_availability')
                        .select('day_of_week, open_time, close_time')
                        .eq('provider_id', existing.id)
                        .order('day_of_week', { ascending: true });
                    if (avail && avail.length) {
                        const rows = avail.map((r: any) => ({
                            day: r.day_of_week,
                            open: String(r.open_time || '').slice(0, 5),
                            close: String(r.close_time || '').slice(0, 5),
                        }));
                        setSchedule(rows);
                    }
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
                        .select('extra_key, offered, price, notes, quote')
                        .eq('provider_id', existing.id);

                    const loadedExtras: Record<string, { offered: boolean; price: string; notes: string; quote?: boolean }> = {};
                    for (const row of extraRows || []) {
                        loadedExtras[row.extra_key] = {
                            offered: row.offered === true,
                            price: row.price === null || row.price === undefined ? '' : String(row.price),
                            notes: row.notes || '',
                            quote: row.quote === true,
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

                // The person's name is no longer asked in the flow — it is the
                // listing title now, derived from the account at submit (see
                // resolveGuestTitleNow). So there is nothing to prefill here.

            } catch (err) {
                // A blank form is worse than a stuck spinner here: it looks like a
                // fresh application over a record we failed to read. Hold the
                // failure and show a retry rather than rendering the form.
                setLoadFailed(true);
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
        // The rule itself is in lib/joinSteps.ts, where it can be tested. It
        // lived here as a dependency array, and a dependency array is a bad
        // place to keep a rule that decides whether somebody can tell their
        // application was sent. `null` means leave them where they are.
        // A guest with no category yet has not answered step one (the category
        // grid is their picker), even though ?trade=guest is already set. By the
        // time this runs on hydrate, restoreDraft has already put back any saved
        // category, so this reads the real answer.
        const guestNeedsCategory = audienceForTrade(tradeFromUrl) === 'guest' && !guestCategory && !providerId;
        const openState = { hydrated, restored, trade: tradeFromUrl, guestNeedsCategory, category: guestCategory };
        const opening = openingStep(openState);
        if (opening === null) return;

        setStep(opening);
        setVisited(openingVisited(openState) || []);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrated, restored, tradeFromUrl]);

    // ONE SOURCE OF TRUTH FOR THE TRADE.
    //
    // The URL is it. `trade` state mirrors it and never leads it.
    //
    // They used to be two answers to the same question: the draft was keyed on
    // the URL, the form was driven by the state, and the confirmation email was
    // built from the URL. Anything that moved one without the other wrote the
    // draft under one key and sent the applicant back to another — where the
    // key missed, no draft was found, and the form opened on step two of a
    // trade they had not picked, with everything they had typed apparently
    // gone. It was not gone; it was filed under a name nothing was looking for.
    useEffect(() => {
        if (tradeFromUrl && tradeFromUrl !== trade) setTrade(tradeFromUrl);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tradeFromUrl]);

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
            if (d.smsOptOut) setSmsOptOut(!!d.smsOptOut);
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
            if (Array.isArray(d.items) && d.items.length) setItems(d.items);
            if (d.providerName) setProviderName(d.providerName);
            if (d.dietaryNote) setDietaryNote(d.dietaryNote);
            if (Array.isArray(d.dietaryOptions)) setDietaryOptions(d.dietaryOptions);
            if (d.headshot) setHeadshot(d.headshot);
            if (d.yearsDoing) setYearsDoing(d.yearsDoing);
            if (d.listingTitle) setListingTitle(d.listingTitle);
            if (d.professionalTitle) setProfessionalTitle(d.professionalTitle);
            if (d.qualifications) setQualifications(d.qualifications);
            if (d.recognition) setRecognition(d.recognition);
            if (d.whatToExpect) setWhatToExpect(d.whatToExpect);
            // The category, shape and its fields. Set before the filledIn check
            // so a guest who picked a category but typed nothing still lands past
            // the picker rather than being asked to choose it again.
            if (d.guestGroup) setGuestGroup(d.guestGroup);
            if (d.guestCategory) setGuestCategory(d.guestCategory);
            if (d.declarations && typeof d.declarations === 'object') setDeclarations(d.declarations);
            if (d.shape) setShape(d.shape);
            if (d.leadTimeDays) setLeadTimeDays(d.leadTimeDays);
            if (d.fulfilment) setFulfilment(d.fulfilment);
            // The draft is this browser's own, and it's the source of truth here
            // (no DB row yet), so a restored address is authoritative — leave
            // collectionAddressLoaded true (its default). Never persisted from a
            // DB read; only the provider's own in-progress typing.
            if (d.collectionStreet) setCollectionStreet(d.collectionStreet);
            if (d.collectionTown) setCollectionTown(d.collectionTown);
            if (d.collectionPostcode) setCollectionPostcode(d.collectionPostcode);
            if (d.slotOffer) setSlotOffer(d.slotOffer);
            else if (d.slotPrivate !== undefined && d.slotPrivate !== null) setSlotOffer(d.slotPrivate === true ? 'private' : 'shared');
            if (d.maxGuests) setMaxGuests(d.maxGuests);
            if (d.slotLength) setSlotLength(d.slotLength);
            if (d.slotMinPeople) setSlotMinPeople(d.slotMinPeople);
            if (Array.isArray(d.schedule)) setSchedule(d.schedule);

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
                (d.registrations && Object.keys(d.registrations).length) ||
                // A guest who has picked a category or set up a schedule has made
                // real progress, even with the text fields still blank.
                (d.guestCategory || '') ||
                (Array.isArray(d.items) && d.items.length) ||
                (Array.isArray(d.schedule) && d.schedule.length) ||
                (d.providerName || '').trim()
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
            // A guest's steps depend on the category and shape from the draft,
            // so resolve and count them with that context.
            const restoreTrade = d.trade || tradeFromUrl;
            const restoreCtx: StepContext | undefined =
                audienceForTrade(restoreTrade) === 'guest'
                    ? { category: d.guestCategory, shape: d.shape, slotOffer: d.slotOffer ?? (d.slotPrivate === true ? 'private' : d.slotPrivate === false ? 'shared' : null), fulfilment: d.fulfilment }
                    : undefined;
            const landing = resolveStep(restoreTrade, d.step, restoreCtx);
            setStep(landing);

            // Everything up to where they were counts as seen, so the step
            // they are returning to shows its errors rather than looking
            // finished. Steps ahead of them stay quiet.
            const upTo = stepsFor(restoreTrade, restoreCtx);
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
                    businessName, description, contactEmail, contactPhone, smsOptOut,
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
                    // The guest-trade fields: the price, and who they are. The
                    // headshot is a storage path like the photos. A SLOT item with
                    // no price is not persisted — a guidance shape the host has
                    // opened but not priced writes nothing to the draft, so an
                    // abandoned one is never restored (the stepper rule).
                    items: shape === 'slot' ? items.filter((r) => Number(r.price) > 0) : items,
                    providerName, headshot, dietaryNote, dietaryOptions,
                    // The Airbnb-shaped content answers.
                    yearsDoing, listingTitle, professionalTitle, qualifications, recognition,
                    whatToExpect,
                    // The category (and the group above it, so the sub-type screen
                    // still has its cards after a reload), the inferred shape and
                    // its own fields.
                    guestGroup, guestCategory, shape, leadTimeDays,
                    // Made-to-order fulfilment fork + its collection address. The
                    // address is the provider's own, in their own browser's draft
                    // — never shared, and it's a private column server-side.
                    fulfilment, collectionStreet, collectionTown, collectionPostcode,
                    slotOffer, maxGuests, slotLength, slotMinPeople, schedule,
                    // The checks they've ticked so far.
                    declarations,
                })
            );
        } catch (err) {
            /* storage full or blocked — the form still works */
        }
    }, [
        hydrated, providerId, tradeFromUrl, chosen, step, trade,
        businessName, description, contactEmail, contactPhone, smsOptOut,
        prices, extras, calloutFee, hourlyRate, areas,
        pricingChoice, billableHourlyRate, coveredBands,
        doesGas, doesOil, registrations, calloutWaived, skills,
        photos, logo, buildingType, panes,
        items, providerName, headshot, dietaryNote, dietaryOptions,
        yearsDoing, listingTitle, professionalTitle, qualifications, recognition,
        whatToExpect,
        guestGroup, guestCategory, shape, leadTimeDays,
        fulfilment, collectionStreet, collectionTown, collectionPostcode,
        slotOffer, maxGuests, slotLength, slotMinPeople, schedule,
        declarations,
    ]);

    // Which registration boxes this application shows at all. An electrician
    // always sees the Part P schemes; a plumber sees Gas Safe or OFTEC only
    // once they have said they do that work; nobody else sees any of it.
    const showableSchemes = offerableSchemes({ trade, does_gas: doesGas, does_oil: doesOil });

    const registrationRows = showableSchemes.map((scheme) => ({
        scheme,
        number: registrations[scheme] || '',
    }));

    // The effective slot offering. A fixed-basis slot answers private/shared/both
    // once, up front (slotOffer). A MIXED provider answers it per item, so
    // slotOffer stays null — the truth is in the item units, so derive it from
    // them. This is what decides whether the per-person minimum is stored and
    // whether the min ≤ capacity rule is checked; both must see a mixed provider's
    // shared class, which only the item units reveal.
    const slotOfferEffective = shape === 'slot' && slotMixedDuration(guestCategory)
        ? slotOfferingFromUnits((items || []).map((i) => String(i.unit)))
        : slotOffer;

    // A come-to-me mixed provider may run a shared class, so it is asked the
    // minimum (its capacity's twin). Its screen is offered before any item
    // exists, so the gate is the category + direction, not the item units.
    const slotMixedComeToMe = shape === 'slot' && slotMixedDuration(guestCategory) && fulfilment !== 'delivery';

    const problems = submitProblems({
        business_name: businessName,
        trade,
        description,
        // The host expertise hub's required field — its Next gate and the submit
        // gate both read the professional title now, in place of a description.
        professional_title: professionalTitle,
        contact_email: contactEmail,
        audience: audienceForTrade(trade),
        areaCount: areas.length,
        prices,
        callout_fee: calloutFee,
        hourly_rate: hourlyRate,
        callout_waived: calloutWaived,
        provides_quote: provideQuote,
        flat_fee: flatFee,
        extras,
        does_gas: doesGas,
        does_oil: doesOil,
        registrations: registrationRows,
        kind,
        pricing_choice: pricingChoice,
        billable_hourly_rate: billableHourlyRate,
        covered_bands: coveredBands,
        shape,
        scheduleCount: schedule.length,
        // The slot pricing basis and its two group numbers, so the min ≤ capacity
        // rule can be checked. slotMinPeople blank reads as no minimum. The
        // effective offering (derived from item units for a mixed provider) so a
        // mixed shared class is covered by the rule, not just a fixed-basis one.
        slotOffer: slotOfferEffective,
        slotCapacity: maxGuests,
        slotMinPeople,
        // Items priced above zero — the marketplace lists only priced providers,
        // so a guest listing needs at least one to be bookable.
        pricedItemCount: (items || []).filter((i) => Number(String(i.price ?? '').trim()) > 0).length,
        fulfilment,
        // A usable collection address needs all three: the street and postcode a
        // guest actually finds, and the town that becomes the public based_line.
        hasCollectionAddress: collectionStreet.trim() !== ''
            && collectionTown.trim() !== ''
            && collectionPostcode.trim() !== '',
    });

    // The optional address lookup (Ideal Postcodes) for the collection address,
    // reusing the shared /api/address routes and helpers. Manual entry is the
    // primary path (the three fields below always work); this fills them when the
    // lookup is available and shows a plain "enter it by hand" line when it isn't
    // (an absent key returns 503, a rejected one 502). The region gate lives in
    // /api/address/get, which refuses an address outside Dumfries & Galloway.
    // Search-as-you-type. Called by the debounce effect once the query settles,
    // never per keystroke. `seq` guards against an earlier request resolving after
    // a later one (typing fast) and overwriting fresher results. A failure just
    // shows the "enter it by hand" line and leaves the lookup open — the manual
    // link is the escape; we don't yank the box away mid-type.
    const runCollectionLookup = async (query: string) => {
        const q = query.trim();
        if (q.length < 3) { setCollectionLookupResults([]); return; }
        const seq = ++collectionLookupSeq.current;
        setCollectionLookupBusy(true);
        setCollectionLookupError('');
        try {
            const res = await fetch('/api/address/autocomplete?q=' + encodeURIComponent(q));
            const body = await res.json();
            if (seq !== collectionLookupSeq.current) return;   // a newer keystroke won
            if (!res.ok || !body.ok) {
                setCollectionLookupError(GUEST_SCREEN_COPY.collectionLookupManual);
                setCollectionLookupResults([]);
                return;
            }
            const suggestions = (body.suggestions || []).map((s: any) => ({ id: String(s.id), label: String(s.address || '') }));
            setCollectionLookupError(suggestions.length ? '' : GUEST_SCREEN_COPY.collectionLookupManual);
            setCollectionLookupResults(suggestions);
        } catch {
            if (seq !== collectionLookupSeq.current) return;
            setCollectionLookupError(GUEST_SCREEN_COPY.collectionLookupManual);
            setCollectionLookupResults([]);
        } finally {
            if (seq === collectionLookupSeq.current) setCollectionLookupBusy(false);
        }
    };

    const pickCollectionSuggestion = async (id: string) => {
        setCollectionLookupBusy(true);
        setCollectionLookupError('');
        try {
            const res = await fetch('/api/address/get?id=' + encodeURIComponent(id));
            const body = await res.json();
            // The address is real but outside Dumfries & Galloway — say so
            // plainly, naming where it is, and DON'T fill the fields. The lookup
            // stays open so they can pick another; the manual link is still there.
            if (body && body.outOfRegion) {
                const where = body.district
                    ? 'That address is in ' + body.district + ', outside Dumfries & Galloway.'
                    : 'That address is outside Dumfries & Galloway.';
                setCollectionLookupError(where + ' ' + GUEST_SCREEN_COPY.collectionOutOfRegionSuffix);
                setCollectionLookupResults([]);
                return;
            }
            if (!res.ok || !body.ok || !body.address) {
                setCollectionLookupError(GUEST_SCREEN_COPY.collectionLookupManual);
                return;
            }
            const a = body.address;
            // buildStreetAddress folds a flat/sub-building into the one private
            // street line — the same assembly add-a-property uses.
            setCollectionStreet(buildStreetAddress(a.flat || '', '', a.street || ''));
            setCollectionTown(a.town || '');
            setCollectionPostcode(a.postcode || '');
            setCollectionLookupResults([]);
            setCollectionLookupError('');
            // Collapse the lookup: clear its query (so the postcode doesn't show
            // twice) and switch to the filled three fields.
            setCollectionLookupQuery('');
            setCollectionManual(true);
        } catch {
            setCollectionLookupError(GUEST_SCREEN_COPY.collectionLookupManual);
        } finally {
            setCollectionLookupBusy(false);
        }
    };

    // "Search again" from the filled fields: clear them and drop back to the
    // lookup with an empty box. Manual off + empty fields = lookup mode.
    const searchCollectionAgain = () => {
        setCollectionStreet('');
        setCollectionTown('');
        setCollectionPostcode('');
        setCollectionManual(false);
        setCollectionLookupQuery('');
        setCollectionLookupResults([]);
        setCollectionLookupError('');
    };

    // Search as they type: debounce the query and fire once it settles (≥3 chars),
    // the way the old lookup did — no button to press. Only while in lookup mode
    // (no address chosen and not typing by hand); a picked/manual address is a
    // settled answer, not a search term.
    const collectionInLookupMode = !collectionManual
        && !collectionStreet.trim() && !collectionTown.trim() && !collectionPostcode.trim();
    useEffect(() => {
        if (!collectionInLookupMode) return;
        const q = collectionLookupQuery.trim();
        if (q.length < 3) { setCollectionLookupResults([]); return; }
        const timer = setTimeout(() => { runCollectionLookup(q); }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionLookupQuery, collectionInLookupMode]);

    // Is there more of the suggestions list below the fold? Drives the bottom
    // fade. Reads the list's CURRENT height, so it's correct once the cap below
    // has been applied. Recomputed on scroll, on resize, and when results change.
    const updateCollectionMoreBelow = () => {
        const el = collectionListRef.current;
        setCollectionMoreBelow(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    };

    // Cap the list to the space between its top and the panel's bottom edge (the
    // pinned footer sits just below the panel), so the list fits above the footer
    // and scrolls itself instead of pushing the page. Desktop only — on mobile
    // the list keeps its CSS max-height and the page scrolls by thumb.
    const measureCollectionListMax = () => {
        const el = collectionListRef.current;
        if (!el) return;
        const desktop = typeof window !== 'undefined'
            && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        if (!desktop) { setCollectionListMaxH((prev) => (prev === null ? prev : null)); return; }
        const panel = document.getElementById('signup-panel');
        const boundary = panel ? panel.getBoundingClientRect().bottom : window.innerHeight;
        const top = el.getBoundingClientRect().top;
        // Leave room above the footer and for the "Enter it by hand" link beneath.
        const avail = Math.floor(boundary - top - 52);
        const capped = Math.max(160, avail);
        setCollectionListMaxH((prev) => (prev === capped ? prev : capped));
    };

    // Measure the cap when the list appears or its results change (after paint —
    // a bare rAF can fire before the list's position is final).
    useEffect(() => {
        const id = setTimeout(measureCollectionListMax, 60);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionLookupResults, collectionInLookupMode]);

    // Once the cap (or results) has applied, measure whether more is below.
    useEffect(() => {
        const id = setTimeout(updateCollectionMoreBelow, 70);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionListMaxH, collectionLookupResults]);

    // Re-measure on window resize while the list is showing.
    useEffect(() => {
        const onResize = () => { measureCollectionListMax(); updateCollectionMoreBelow(); };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    const extraOf = (key: string) => extras[key] || { offered: false, price: '', notes: '', quote: false };
    const setExtra = (key: string, field: 'offered' | 'price' | 'notes' | 'quote', value: any) =>
        setExtras((prev) => ({
            ...prev,
            [key]: Object.assign({ offered: false, price: '', notes: '', quote: false }, prev[key] || {}, { [field]: value }),
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

    // The type-ahead over the existing services. One list, search-only: nothing
    // shows until something is typed, and what shows is the existing services
    // that match — ranked exact, then starts-with, then contains (suggestSkills),
    // so somebody half way through "electr" gets "Electrical testing" at the top.
    //
    // We DON'T police what a trade lists any more: a regulated service (electrical,
    // gas, oil) is offered like any other. The old filter that hid them was what
    // made "electr" suggest nothing on the electrician, so a real service got
    // typed in as somebody's own ("Eicr") past a list that would have had it.
    // A word that matches nothing — and only then — offers "add your own".
    const TAGS_SHOWN_CLOSED = 12;

    const matchingTags = skillTyped.trim() === ''
        ? []
        : suggestSkills(allSkills, skillTyped, skills, 500);

    const tagsToShow = matchingTags.slice(0, TAGS_SHOWN_CLOSED);

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
    // The guest split is driven by a context — the category and the booking
    // shape — passed to every joinSteps call. It is UNDEFINED for a host trade,
    // which is what keeps a host's steps and validation byte-for-byte unchanged:
    // the guest steps stay off and stepForField uses the host map.
    const isGuest = audienceForTrade(trade) === 'guest';
    // The made-to-order Location screen is the three-card fulfilment fork, so it
    // centres vertically like the stepper screens (g_you/g_capacity/g_notice) —
    // desktop only; the stacked mobile layout is left exactly as it is.
    const guestMtoArea = isGuest && step === 'g_area' && shape === 'made_to_order';
    // The two slot choice-card forks — private/shared (g_slot_basis) and the
    // come-to-me / travel fork (g_slot_where) — are the same shape as the
    // made-to-order fork: a screenful of large ChoiceCards and nothing else, so
    // they centre vertically on desktop the same way, and by the same three
    // coordinated pieces (panel, fieldset, section). Mobile keeps its stack.
    const guestSlotChoice = isGuest && shape === 'slot' && (step === 'g_slot_basis' || step === 'g_slot_where');
    // group falls back to the category's own group, so a restored draft (which
    // saves the category, not the group) still resolves its steps correctly.
    const stepCtx: StepContext | undefined =
        isGuest
            ? { group: guestGroup || (guestCategoryByKey(guestCategory)?.group || ''), category: guestCategory, shape, slotOffer, fulfilment }
            : undefined;

    const problemFor = (field: string) => {
        const where = stepForField(field, stepCtx);
        const shown = touchedSubmit || (where !== null && visited.indexOf(where) !== -1);
        return shown ? (problems.filter((p) => p.field === field)[0] || null) : null;
    };

    // ---- moving between steps --------------------------------------------

    const steps = stepsFor(trade, stepCtx);
    const stepMeta = steps.filter((x) => x.key === step)[0] || steps[0];
    const onStep = (key: StepKey) => step === key;

    // ---- the named sections (the guest progress rail) --------------------
    //
    // Airbnb groups the flow into a handful of named sections rather than a
    // "Step 5 of 12" count. sectionsFor gives the ones this guest walks, in
    // order; the eyebrow at the top of each screen and the desktop rail read
    // from the same source, so they can't disagree about the flow.
    const flowSections = sectionsFor(trade, stepCtx);
    const currentSection = sectionForStep(step);
    const stepIndexInFlow = steps.findIndex((x) => x.key === step);
    // A section is done when its last live step sits before the current one;
    // active when the current step is one of its own; ahead otherwise.
    const sectionStatus = (sec: { steps: StepKey[] }): 'done' | 'active' | 'ahead' => {
        if (sec.steps.indexOf(step) !== -1) return 'active';
        const lastIdx = Math.max(...sec.steps.map((k) => steps.findIndex((x) => x.key === k)));
        return lastIdx > -1 && lastIdx < stepIndexInFlow ? 'done' : 'ahead';
    };

    // A one-line summary of what a completed section holds, for the rail — the
    // way Airbnb shows "12 years", "4 photos" under each done section. All
    // read-only from state; empty ones just show nothing.
    const sectionSummary = (key: string): string => {
        switch (key) {
            case 'about': {
                const y = yearsDoing.trim();
                return y ? `${y} ${y === '1' ? 'year' : 'years'}` : '';
            }
            case 'location': {
                if (areas.length === 1) return String(areas[0].town || '').trim() || '1 area';
                if (areas.length > 1) return `${areas.length} areas`;
                if (shape === 'made_to_order' && leadTimeDays.trim()) {
                    const d = leadTimeDays.trim();
                    return `${d} ${d === '1' ? 'day' : 'days'}’ notice`;
                }
                return '';
            }
            case 'photos':
                return photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}` : '';
            case 'pricing': {
                const priced = items
                    .map((it) => Number(String(it.price || '').replace(/[^0-9.]/g, '')))
                    .filter((n) => n > 0);
                if (!priced.length) return '';
                return `From £${Math.min(...priced)}`;
            }
            case 'details':
                return (whatToExpect.trim() || dietaryNote.trim()) ? 'Added' : '';
            case 'finish':
                return contactEmail.trim();
            default:
                return '';
        }
    };

    // What is wrong on the step in front of them, which is all Next is
    // allowed to care about. A missing price must not stop somebody getting
    // past their business name.
    const stepProblems = problemsOnStep(problems, step, stepCtx);

    // Which guest content steps a person can skip. Everything else with a
    // question on it is required — and the footer says which is which, so a
    // greyed Next is never a silent dead end and a skippable screen never
    // looks like one she has to fill. Pickers (trade, g_subtype) and the
    // finish step carry their own affordances and are left out here.
    // Whether the qualifications row is prompted at all for this category — the
    // physical-safety categories only. It is always optional (never gates Next);
    // on every other category the row is not shown.
    const catAsksQuals = isGuest && guestAsksQualifications(guestCategory);

    // g_menu and g_expect are always skippable. g_you is NEVER skippable: the
    // years screen shows a starting number (5), so a host could otherwise walk
    // past it thinking that number is their answer when nothing was stored — it
    // must be touched. g_creds gates on the professional title only —
    // qualifications are optional everywhere now. (The old g_checks is gone — its
    // one confirmation moved to the finish screen and is required there.)
    // g_menu is required now: a listing needs at least one priced item to be
    // bookable, so its Next gates on the 'menu' problem (GUEST_STEP_FIELDS).
    // g_expect stays optional.
    const OPTIONAL_GUEST_STEPS: StepKey[] = ['g_expect'];
    const stepIsPicker = step === 'trade' || step === 'g_subtype';
    // g_creds is no longer skippable for anyone: the professional title is now
    // required for every category. Qualifications are optional everywhere.
    const stepIsOptional = isGuest && !stepIsPicker && (
        OPTIONAL_GUEST_STEPS.indexOf(step) !== -1
    );

    // Three guest steps can be required without a submitProblems field of their
    // own — years (only for the categories that need it), the professional title,
    // and at least one photo (always). They gate Next on the spot, the same way
    // the pickers do, with a plain line saying what to add.
    // The counts on the where-and-when step only display a suggestion until the
    // host touches them, so the step can't be passed until each one that applies
    // has a real value. (The area and weekly-hours requirements come through
    // stepProblems, below.)
    // g_area's own required-fields (the address or a region) come through
    // stepProblems now, the same as made-to-order — nothing extra to gate here.
    // Session length moved to g_slot_length (stores its shown default on Next,
    // like the years/guests steppers) and the weekly hours to g_slot_hours (its
    // requirement is the 'availability' problem, which maps to that step).
    const whereMissing: string | null = null;

    // g_photos deliberately shows no footer message: the on-screen line asks for
    // three, the Next gate quietly holds at one, and we don't restate either in
    // the footer. The gate itself lives in the Next-disabled computation.
    const guestExtraMissing: string | null = isGuest
        ? (step === 'g_creds' && !professionalTitle.trim()
            ? GUEST_SCREEN_COPY.titleGate
            // The listing must be named before Next — it is the h1 a guest reads.
            : step === 'g_title' && !listingTitle.trim()
            ? GUEST_SCREEN_COPY.experienceTitleGate
            // The booking-shape fork gates Next until answered.
            : step === 'g_shape' && !shape
            ? GUEST_SCREEN_COPY.shapeGate
            // The pricing basis gates Next until it's answered — say so rather
            // than leaving a greyed button with no reason.
            : step === 'g_slot_basis' && slotOffer === null
            ? GUEST_SCREEN_COPY.slotBasisGate
            // The come-to-me / travel fork, same rule.
            : step === 'g_slot_where' && !fulfilment
            ? GUEST_SCREEN_COPY.slotWhereGate
            // A 'both' slot needs a priced private hire AND a priced shared table,
            // or it quietly ships only one. Next is greyed until both — say which
            // is missing rather than leaving it unexplained. (No price at all falls
            // to the menu's own required-item gate.)
            : step === 'g_menu' && shape === 'slot' && slotOffer === 'both'
                && !(items.some((r) => String(r.unit) === 'flat' && Number(r.price) > 0)
                    && items.some((r) => String(r.unit) === 'person' && Number(r.price) > 0))
            ? (!items.some((r) => Number(r.price) > 0)
                ? GUEST_SCREEN_COPY.menuRequiredGate
                : items.some((r) => String(r.unit) === 'flat' && Number(r.price) > 0)
                    ? GUEST_SCREEN_COPY.menuSlotBothGateShared
                    : GUEST_SCREEN_COPY.menuSlotBothGatePrivate)
            // The 'both' place screen carries two answers. When BOTH are still
            // empty the footer named only the areas (the first problem), so the
            // address looked optional — name both. If just one is missing this
            // falls through to that field's own problem via stepProblems below.
            : step === 'g_area' && shape === 'slot' && fulfilment === 'both'
                && areas.length === 0
                && !(collectionStreet.trim() && collectionTown.trim() && collectionPostcode.trim())
            ? GUEST_SCREEN_COPY.slotBothPlaceGate
            : whereMissing)
        : null;

    // What a host trade needs before Next un-greys, phrased for a person. Every
    // host step reads its first outstanding problem off stepProblems — the
    // professional title on g_creds (a host-worded message), the name/coverage on
    // the business step, a price on the prices step. Shown beside the greyed Next
    // so a trade is never left at a dead button with no reason.
    const hostStepMissing: string | null = !isGuest && !stepIsPicker && stepProblems.length > 0
        ? stepProblems[0].message
        : null;

    // The one thing missing on a required step, phrased for a person. Shown in
    // the footer beside the greyed Next so she knows exactly what to add.
    const stepMissing = guestExtraMissing
        ? guestExtraMissing
        : isGuest && !stepIsPicker && !stepIsOptional && stepProblems.length > 0
            ? stepProblems[0].message
            : hostStepMissing;

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

        const to = nextStep(trade, step, stepCtx);
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

        const to = previousStep(trade, step, stepCtx);
        if (to === step) return;

        // Nothing is validated and nothing is cleared on the way back. Every
        // field is component state and stays exactly as it was -- which is
        // also why Back must never be a router call: that would remount this
        // and lose the lot.
        setStep(to);
        scrollPanelToTop();
    };

    // Jump straight to a step from the rail — the named sections behind you are
    // clickable navigation back to what you already did. Like Back, it validates
    // nothing and clears nothing (every field is component state and stays as it
    // was); the rail only ever offers a completed section as a target, so there
    // is nothing ahead to leap over.
    const goToStep = (key: StepKey) => {
        if (key === step) return;
        setStep(key);
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

        const to = firstStepWithProblem(trade, problems, stepCtx);
        if (!to || to === step) return;

        setStep(to);
        // If the outstanding thing is the weekly hours, open that block so the
        // provider actually sees it — it's a collapsed section otherwise.
        if (problems.some((p) => p.field === 'availability')) setOpenGroup('availability');
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
        // The first screen after the picker is the shared About-you opener (the
        // years counter), the same as the guest flow — NOT the business step. The
        // opening-step effect (keyed on the URL trade) resolves to g_you too; we
        // set it here as well so there is no one-frame flash of the business step
        // between the click and that effect landing.
        setStep('g_you');
        scrollPanelToTop();
    };

    // A guest's version of step one. The trade is already 'guest'; this records
    // the category (a starting point, confirmed at review) and pre-selects the
    // booking shape it usually is, so the next step opens on the right question
    // rather than asking it cold. The provider still confirms the shape, and the
    // owner has the final say on both — nothing here is binding.
    // SELECT vs ADVANCE. Both picker screens now behave the same as the fork:
    // tapping a card selects it (an emerald outline), and the footer Next is
    // what carries them on — never an auto-advance jump-cut.

    // Switching category — or the group above it — makes the OLD listing's
    // answers wrong: they describe the tasting, not the cooking class now being
    // set up. So clear everything specific to the old experience — its title, its
    // items and prices, what-to-expect and dietary, the credentials that answer
    // "what qualifies you for THIS" (a wine cert does not belong on a cooking
    // class), where and how it runs (address, coverage, notice, and the whole
    // slot set-up: private/shared, capacity, minimum, session length, weekly
    // hours). What STAYS is only what is the PERSON and can't be wrong for a new
    // experience: their years, their photos and their headshot. shape and the
    // fulfilment default are then reset to the new category's by
    // selectGuestCategory.
    // The offering answers that depend on the SHAPE — the items, the slot counts
    // and schedule, the notice, the areas and collection address. Cleared when the
    // shape itself changes (the 'something else' shape screen) so a switch from,
    // say, a slot to comes-to-you can't leave a stale slot capacity or a stale
    // studio address behind to be saved. About-you (title, expertise) and the
    // photos are NOT shape-specific, so they survive a shape change.
    const clearShapeDependentAnswers = () => {
        setItems([]);
        setMenuIndex(null);
        setSlotOffer(null);
        setMaxGuests('');
        setSlotMinPeople('');
        setSlotLength('');
        setSchedule([]);
        setLeadTimeDays('');
        setCollectionStreet('');
        setCollectionTown('');
        setCollectionPostcode('');
        // Collection UI that belongs to the offering: drop the manual-entry toggle
        // so the address screen returns to its lookup default rather than showing
        // the previous offering's opened (now empty) manual boxes.
        setCollectionManual(false);
        setAreas([]);
    };

    const clearOfferingAnswers = () => {
        setListingTitle('');
        setProfessionalTitle('');
        setDescription('');
        setQualifications('');
        setRecognition('');
        setWhatToExpect('');
        setDietaryNote('');
        setDietaryOptions([]);
        clearShapeDependentAnswers();
        // The STRUCTURAL answers, not just the offering's contents. shape and
        // fulfilment decide which screens render and how the location screen reads,
        // so a category change must clear them too — otherwise a switch FROM a slot
        // TO a null-shape category ('something else') left shape='slot' behind and
        // the whole flow ran as a slot (an empty "What's the address" screen). Reset
        // to empty here; selectGuestCategory sets the real values for the new
        // category right after (it is the only caller that knows them).
        setShape('');
        setFulfilment('');
    };

    // 'Something else' answering its booking shape (the g_shape screen). Setting the
    // shape here is the equivalent of a real category's DECLARED shape: it drives
    // which screens follow and how the location screen reads. A slot defaults to
    // come-to-me ('collection'), like a fixed slot category (a sauna), so g_area
    // shows the address; made-to-order leaves fulfilment blank so g_area asks the
    // delivery/collection fork; comes-to-you doesn't use fulfilment. Changing the
    // answer clears the previous shape's offering but keeps About-you and photos.
    const pickShape = (next: string) => {
        if (shape && shape !== next) clearShapeDependentAnswers();
        setShape(next);
        setFulfilment(next === 'slot' ? 'collection' : '');
    };

    // Screen two: select a sub-type. Records the category (a starting point,
    // confirmed at review) and pre-selects the booking shape it usually is.
    const selectGuestCategory = (key: string) => {
        // A real change FROM one category TO another drops the previous offering's
        // answers; picking the same one again leaves the work in place, and the
        // first pick (from none) has nothing to clear — nor does re-picking after a
        // reload, which does not restore the group.
        if (guestCategory && key !== guestCategory) clearOfferingAnswers();
        setGuestCategory(key);
        const cat = guestCategoryByKey(key);
        // Set the shape unconditionally — including to '' for a null-shape category
        // ('something else'). The old `if (cat.shape)` guard meant a switch from a
        // slot to 'something else' kept the slot shape, and the flow ran as a slot
        // (the empty "What's the address" screen). '' is the honest "no shape yet".
        setShape(cat?.shape || '');
        // A slot's location fork: the seven fixed categories default to come-to-me
        // ('collection') and skip g_slot_where; the three either-way ones (yoga,
        // massage, painting) start blank so that screen asks. Made-to-order forks
        // on its own screen and comes-to-you doesn't use the field, so both clear.
        setFulfilment(defaultSlotFulfilment(key));
        markVisited('trade');
        markVisited('g_subtype');
    };

    // Screen one: select a top-level group.
    const selectGroup = (key: string) => {
        // A real change FROM one group TO another means a different category will
        // be chosen, so the old category and its offering answers go now — nothing
        // survives the switch. Setting the group from none (a first pick, or after a
        // reload, which does not restore the group) clears nothing.
        if (guestGroup && key !== guestGroup) {
            setGuestCategory('');
            clearOfferingAnswers();
        }
        setGuestGroup(key);
        markVisited('trade');
    };

    // Next on screen one. A group with real sub-types opens screen two; 'other'
    // (alone under its group) skips it — its lone category is set and we go
    // straight to the business step, no screen-two of one card.
    // Where a guest goes after the category pick: the About-you opener (g_you) if
    // the category asks about expertise, otherwise straight to Location (g_area),
    // which every guest has. There is no naming step any more — the title is the
    // account name, derived at submit. The account is already made by now (verify
    // is the first screen of all, before the picker), so there is no auth detour.
    const firstGuestContentStep = (category: string): StepKey =>
        guestAsksExpertise(category) ? 'g_you' : 'g_area';

    const advanceFromGroup = () => {
        const subs = categoriesForGroup(guestGroup);
        if (guestGroup === 'other' || subs.length <= 1) {
            const key = subs[0]?.key || '';
            if (key) selectGuestCategory(key);
            setStep(firstGuestContentStep(key));
        } else {
            setStep('g_subtype');
        }
        scrollPanelToTop();
    };

    // Next on screen two.
    const advanceFromSubtype = () => {
        setStep(firstGuestContentStep(guestCategory));
        scrollPanelToTop();
    };



    // A portrait for a guest-trade provider — the person a guest is letting into
    // the cottage. Kept apart from the work gallery (photos). Same owner-prefixed
    // path and same compression as the logo; the only difference is which state
    // it lands in.
    const uploadHeadshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        if (!file) return;

        if (!session) {
            toast.info('Your photo can go on as soon as this is sent — nothing has been lost, just pick it again then.', {
                theme: 'colored',
            });
            e.target.value = '';
            return;
        }

        setUploadingHeadshot(true);

        try {
            const ready = await compressImage(file);
            const path = 'providers/headshot-' + session.user.id + '-' + Date.now() + '.jpg';

            const { error } = await supabase.storage
                .from(Env.S3_BUCKET)
                .upload(path, ready, { contentType: 'image/jpeg' });

            if (error) {
                toast.error(error.message, { theme: 'colored' });
            } else {
                setHeadshot(path);
            }
        } catch (err) {
            toast.error('That image could not be read. Try a different one.', { theme: 'colored' });
        }

        setUploadingHeadshot(false);
        e.target.value = '';
    };

    // A photo for one menu item — the cake itself, not the baker. Same
    // owner-prefixed path and compression as the gallery and headshot; it lands
    // on the item row at index i so the picture and the price stay together.
    const uploadItemPhoto = async (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        if (!file) return;

        if (!session) {
            toast.info('Your photo can go on as soon as this is sent — nothing has been lost, just pick it again then.', {
                theme: 'colored',
            });
            e.target.value = '';
            return;
        }

        setUploadingItem(i);

        try {
            const ready = await compressImage(file);
            const path = 'providers/item-' + session.user.id + '-' + Date.now() + '_' + generateRandomNumber() + '.jpg';

            const { error } = await supabase.storage
                .from(Env.S3_BUCKET)
                .upload(path, ready, { contentType: 'image/jpeg' });

            if (error) {
                toast.error(error.message, { theme: 'colored' });
            } else {
                setItems((rows) => rows.map((r, j) => (j === i ? { ...r, image: path } : r)));
            }
        } catch (err) {
            toast.error('That image could not be read. Try a different one.', { theme: 'colored' });
        }

        setUploadingItem(null);
        e.target.value = '';
    };

    // A gallery photo for the guest listing — the room, the table, the view. The
    // dedicated photos step (g_photos) that Airbnb has and we lacked. Same
    // owner-prefixed path and compression as the headshot and item photos;
    // appended to `photos`, which already saves and loads and is read by the
    // listing. More than one file at a time, so a provider can add a set at once.
    const uploadGalleryPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        if (!session) {
            toast.info('Your photos can go on as soon as this is sent — nothing has been lost, just pick them again then.', {
                theme: 'colored',
            });
            e.target.value = '';
            return;
        }

        setUploadingPhotos(true);

        for (const file of files) {
            try {
                const ready = await compressImage(file);
                const path = 'providers/photo-' + session.user.id + '-' + Date.now() + '_' + generateRandomNumber() + '.jpg';

                const { error } = await supabase.storage
                    .from(Env.S3_BUCKET)
                    .upload(path, ready, { contentType: 'image/jpeg' });

                if (error) {
                    toast.error(error.message, { theme: 'colored' });
                } else {
                    setPhotos((prev) => [...prev, path]);
                }
            } catch (err) {
                toast.error('That image could not be read. Try a different one.', { theme: 'colored' });
            }
        }

        setUploadingPhotos(false);
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
        // Back to the right step one to re-pick: a guest re-chooses a category
        // (only reachable via ?trade=guest), a trade re-picks off the grid.
        router.push(trade === 'guest' ? '/services/join?trade=guest' : '/services/join');
    };

    // The tradesman area sub-flow: open to add (null) or to edit a row, commit
    // the draft on Save, drop the row on Remove. The model is unchanged — a town
    // from the known list plus a radius — so existing rows load and re-save
    // exactly as before and the directory filter keeps working.
    const openHostArea = (index: number | null) => {
        if (index === null) {
            setAreaEditIndex(null);
            setAreaDraftTown('');
            setAreaDraftRadius(10);
        } else {
            const a = areas[index];
            setAreaEditIndex(index);
            setAreaDraftTown(a?.town || '');
            setAreaDraftRadius(Number(a?.radius_miles) || 10);
        }
        setAreaModalOpen(true);
    };
    const saveHostArea = () => {
        const town = areaDraftTown.trim();
        if (!town) return;
        const row = { town, radius_miles: Number(areaDraftRadius) || 10 };
        setAreas((prev) => (areaEditIndex === null
            ? [...prev, row]
            : prev.map((x, j) => (j === areaEditIndex ? row : x))));
        setAreaModalOpen(false);
    };
    const removeHostArea = () => {
        if (areaEditIndex === null) return;
        setAreas((prev) => prev.filter((_, j) => j !== areaEditIndex));
        setAreaModalOpen(false);
    };

    // Guest coverage is a fixed list of regions, ticked in the picker. A region
    // is stored as an area row whose `town` holds the region label and whose
    // radius is 0 — nothing reads radius on the guest path any more (coverage is
    // informational, the coversPoint filter is gone), so 0 is a value no one
    // consults, not a distance. "All of Dumfries & Galloway" is mutually
    // exclusive with the individual regions: picking it clears the rest, and
    // picking an individual clears it.
    const ALL_REGION_LABEL = GUEST_REGIONS.filter((r) => r.key === GUEST_COVERAGE_ALL_KEY)[0].label;
    const areasHasAll = areas.some((a) => a.town === ALL_REGION_LABEL);
    const regionHint = (label: string) => GUEST_REGIONS.filter((r) => r.label === label)[0]?.hint || '';
    // The "All of Dumfries & Galloway" hint is shape-specific — travel for a chef
    // who comes to you, delivery for a baker, neither for a fixed slot. The
    // individual regions' hints (town lists) are shape-neutral and stay as-is.
    const allRegionHint = shape === 'comes_to_you'
        ? GUEST_SCREEN_COPY.coverageAllHintTravel
        : shape === 'made_to_order'
            ? GUEST_SCREEN_COPY.coverageAllHintDeliver
            : GUEST_SCREEN_COPY.coverageAllHintFixed;
    const regionHintFor = (label: string) => (label === ALL_REGION_LABEL ? allRegionHint : regionHint(label));
    const regionPicked = (label: string) => areas.some((a) => a.town === label);
    const toggleRegion = (r: { key: string; label: string }) => {
        if (r.key === GUEST_COVERAGE_ALL_KEY) {
            setAreas((prev) => (prev.some((a) => a.town === r.label) ? [] : [{ town: r.label, radius_miles: 0 }]));
            return;
        }
        setAreas((prev) => {
            const withoutAll = prev.filter((a) => a.town !== ALL_REGION_LABEL);
            return withoutAll.some((a) => a.town === r.label)
                ? withoutAll.filter((a) => a.town !== r.label)
                : [...withoutAll, { town: r.label, radius_miles: 0 }];
        });
    };

    // The guest-experience columns. All are a starting point the owner confirms at review:
    //   - custom_label: the picked category's guest-facing word. Seeded only
    //     while the row is not yet approved, so the owner's confirmed label at
    //     review is never overwritten by a later applicant edit. "Something else"
    //     seeds nothing, so approval still gates on the owner giving it a word.
    //   - shape + exclusive_per_date: the inferred booking shape (comes_to_you
    //     folds to exclusive_per_date, kept in sync per the slot_shape migration).
    //   - lead_time_days / slot_length_minutes / slot_capacity: the shape's own
    //     numbers; null / 0 for the shapes they don't apply to.
    const guestProviderFields = (): any => {
        if (audienceForTrade(trade) !== 'guest') return {};
        const cat = guestCategoryByKey(guestCategory);
        const isSlot = shape === 'slot';
        const slotPerItem = isSlot && slotDurationPerItem(guestCategory);
        // A travelling mixed provider sells only private sessions — no provider
        // length (each item has its own) and no declared capacity (its head-count
        // cap is the cottage, not a class size), so both are stored null.
        const travellingMixed = isSlot && slotMixedDuration(guestCategory) && fulfilment === 'delivery';
        const isMTO = shape === 'made_to_order';
        const num = (v: string, min: number) => {
            const n = Math.floor(Number(String(v || '').trim()));
            return String(v || '').trim() !== '' && Number.isFinite(n) ? Math.max(min, n) : null;
        };
        // The terms acceptance, recorded in the declarations jsonb: which version
        // of the terms they agreed to and when. Not a bare boolean — the version
        // stamp makes a stale agreement obvious if the text later changes. Written
        // only when they've agreed (the send gate guarantees they have); the
        // timestamp is the moment of submit.
        const acceptance: Record<string, string> = termsAgreed
            ? { terms_version: PROVIDER_TERMS_VERSION, terms_agreed_at: new Date().toISOString() }
            : {};
        // Fulfilment (made-to-order this pass): the direction, plus the collection
        // address when they collect. The address is OMITTED from the write while it
        // is not loaded AND the field is empty — so a returning provider whose
        // private address failed to load can never blank a real one on save. When
        // loaded (even to empty) the field is authoritative, and a delivery-only
        // choice clears it. `undefined` keys drop out of the update.
        const collects = fulfilment === 'collection' || fulfilment === 'both';
        // The three private fields plus the public based_line the town drives, or
        // undefined to omit them all — the not-loaded-and-empty safety lives in
        // collectionFieldsForWrite (unit-proved). Spreading undefined writes
        // nothing, so a returning provider whose private address failed to load
        // can never blank a real one on save.
        // Made-to-order AND slot both carry a fulfilment now: a come-to-me slot
        // (collection) writes an address exactly like a collecting baker — town
        // → public based_line, street + postcode private, released on a confirmed
        // booking — and a travelling slot (delivery) clears it and keeps regions.
        // This is the code that ALSO fixes based_line never being derived for a
        // slot: with the slot going through collectionFieldsForWrite, its town
        // becomes the public based_line the guest sees.
        const usesFulfilment = isMTO || isSlot;
        const collectionWrite = usesFulfilment
            ? collectionFieldsForWrite({
                collects, loaded: collectionAddressLoaded,
                street: collectionStreet, town: collectionTown, postcode: collectionPostcode,
            })
            : undefined;
        const fulfilmentFields = usesFulfilment
            ? { fulfilment: fulfilment || null, ...(collectionWrite || {}) }
            : {};
        return {
            ...(cat && cat.label && status !== 'approved' ? { custom_label: cat.label } : {}),
            shape: shape || 'made_to_order',
            exclusive_per_date: shape === 'comes_to_you',
            lead_time_days: isMTO ? (num(leadTimeDays, 0) ?? 0) : 0,
            // The one-at-a-time shape (massage) has no single provider length —
            // each treatment carries its own — so it stores none, and capacity is
            // fixed at 1 (one person at a time, never asked). Every other slot
            // keeps its provider length and its asked capacity.
            slot_length_minutes: (isSlot && !slotPerItem && !travellingMixed) ? num(slotLength, 15) : null,
            // Max guests → slot_capacity for a slot (drives sellable seats for a
            // shared/per-person slot via sessionCapacity; a private/flat slot
            // records it but still sells whole). Written from the one maxGuests
            // state, so it can never disagree with the jsonb copy below.
            slot_capacity: slotPerItem ? 1 : travellingMixed ? null : (isSlot ? (num(maxGuests, 1) ?? 1) : null),
            // The per-person minimum — a real number only for a shared/per-person
            // slot; a private/flat slot is one booking whatever the head count, so
            // it stores 1 (no minimum). Floored at 1 to satisfy the column's
            // check; the min ≤ capacity rule is enforced before send (submitProblems).
            slot_min_people: (isSlot && offeringHasShared(slotOfferEffective)) ? Math.max(1, num(slotMinPeople, 1) ?? 1) : 1,
            ...fulfilmentFields,
            declarations: acceptance,
        };
    };

    // The Airbnb-shaped content answers, written to the guest_details jsonb
    // column (not spread into the row like guestProviderFields). Empty stays null
    // so the stored object is clean.
    const guestContentFields = (): Record<string, string | string[] | null> => {
        const t = (v: string) => (String(v || '').trim() || null);
        // A host trade now fills the SAME About-you hub as a guest — a years
        // count, a professional title, qualifications and endorsements — so its
        // row carries those in guest_details too (the column already exists; it is
        // no longer guest-only). The guest-specific answers below (category, what
        // to expect, dietary, max guests) have no meaning for a trade, so a host
        // gets just the four profile fields.
        if (audienceForTrade(trade) !== 'guest') {
            return {
                years_experience: t(yearsDoing),
                professional_title: t(professionalTitle),
                qualifications: t(qualifications),
                recognition: t(recognition),
            };
        }
        return {
            // The category KEY the provider picked, persisted so an approved
            // provider knows its own sub-type. Everything that used to guess it
            // back from the label or the Stripe code can read this instead — see
            // the recovery below and lib/serviceProviders guestCategory/isFood.
            category: t(guestCategory),
            years_experience: t(yearsDoing),
            professional_title: t(professionalTitle),
            qualifications: t(qualifications),
            recognition: t(recognition),
            what_to_expect: t(whatToExpect),
            // What the food provider can cater for, as ticks. An array of keys
            // (DIETARY_OPTIONS), or null when nothing is ticked — the caveats
            // live in the dietary_note column, not here. Empty stays null so a
            // blank answer still reads as "hasn't said" on the listing.
            dietary_options: dietaryOptions.length ? dietaryOptions : null,
            // Max guests rides here for every category that has it (a slot ALSO
            // writes slot_capacity, from the same state, so the two agree).
            max_guests: t(maxGuests),
        };
    };

    // The stored description column, per audience. The service_providers table
    // has description NOT NULL and the trade shop card reads it, so a host row
    // must always carry a non-empty one — but a host no longer types a free-text
    // description (its "about you" is the hub). So it is DERIVED from the hub: the
    // professional title, plus the qualifications when given. The title is the
    // hub's one required field (submitProblems gates on it), so this is never
    // empty at submit; the fallbacks are belt-and-braces. A guest keeps its own
    // description (the "what to expect" field feeds it as before).
    const contentDescription = (): string => {
        if (audienceForTrade(trade) === 'guest') return description.trim();
        const parts = [professionalTitle.trim(), qualifications.trim()].filter(Boolean);
        return parts.join('. ') || businessName.trim() || 'Local trade';
    };

    // The listing title for a guest is now the Title (their Intro field), so it
    // is not derived from the name any more. What we still derive from the
    // account is the BYLINE — the person's FIRST name, shown beneath their photo
    // so a guest sees who they're booking without a surname on the listing.
    // firstName honours the same show_full_name / preferred_name switch guests
    // and hosts rely on in messaging; a surname must never reach a guest.
    const resolveGuestBylineNow = async (): Promise<string> => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return '';
        const { data: prof } = await supabase.from('profiles')
            .select('full_name, preferred_name, show_full_name').eq('id', session.user.id).maybeSingle();
        return firstName(prof ? (prof as any) : null, '');
    };

    // Load the byline (the provider's first name) for the finish-screen summary
    // once they reach it. Derived from the account (async), so it can't be
    // computed inline; fetched when the finish step is shown and a session exists.
    useEffect(() => {
        if (!isGuest || step !== 'finish' || !session || summaryByline) return;
        let cancelled = false;
        resolveGuestBylineNow().then((name) => { if (!cancelled) setSummaryByline(name); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isGuest, step, session]);

    const save = async (submit: boolean) => {
        // Agreeing to the terms gates send for a guest — someone who won't agree
        // should not go live. Checked before the account/validation branches so it
        // applies whichever submit path they are on. Not a submitProblems field:
        // it lives on the finish screen, so its own error shows there.
        if (submit && isGuest && !termsAgreed) {
            setTouchedSubmit(true);
            setTermsError(GUEST_SCREEN_COPY.termsGate);
            goToFirstProblem();
            return;
        }

        let active: any = session;

        if (submit) {
            setTouchedSubmit(true);
            if (problems.length) {
                goToFirstProblem();
                return;
            }
        }

        setSaving(true);

        const now = new Date();

        // A guest's business_name is the LISTING title (g_title, required) — the
        // name of the experience; the professional title rides in guest_details.
        // A host trades under the business name they typed.
        const title = audienceForTrade(trade) === 'guest' ? listingTitle.trim() : businessName.trim();

        const payload: any = {
            ...guestProviderFields(),
            owner_id: active.user.id,
            business_name: title,
            trade,
            ...(trade === 'other' && otherText.trim() ? { custom_label: otherText.trim() } : {}),
            description: contentDescription(),
            contact_email: contactEmail.trim(),
            contact_phone: contactPhone.trim() || null,
            sms_opt_out: smsOptOut,
            audience: audienceForTrade(trade),
            // Who they are — a guest trade only. A guest is choosing someone to
            // come into their cottage, so the listing carries a bit of the
            // person. Null for a host trade, where a logo and a trade say enough.
            provider_name: audienceForTrade(trade) === 'guest' ? (providerName.trim() || null) : null,
            dietary_note: audienceForTrade(trade) === 'guest' ? (dietaryNote.trim() || null) : null,
            headshot,
            // The seven content answers now have a home on the row (the
            // guest_details jsonb column, 20260906143712), so the signed-in
            // wizard writes them here rather than only in the anonymous apply
            // payload. Null for a host trade, which has none of them.
            // Both audiences carry their About-you content in guest_details now:
            // a guest's category/expertise/dietary, a host's four profile fields.
            guest_details: guestContentFields(),
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
            hourly_rate: hourlyRate.trim() !== '' ? Number(hourlyRate) : null,
            callout_waived: calloutFee.trim() !== '' ? calloutWaived : false,
            provides_quote: provideQuote,
            flat_fee: flatFee.trim() !== '' ? Number(flatFee) : null,
            registration_number: (asksAboutFuel(trade) || trade === 'electrician') ? (registrationNumber.trim() || null) : null,
            // Bands are gone; the old columns are written null so a re-saved row
            // clears them.
            pricing_choice: null,
            billable_hourly_rate: null,
            covered_bands: [],
            updated_at: now.toISOString(),
        };

        // What this does to the status fields is decided in lib, not here, so
        // that the rule can be tested: an approved provider is never knocked
        // back into the queue by their own edit. An empty patch means there is
        // no status change to make.
        //
        // The patch is no longer merged into the payload. `status`,
        // `submitted_at` and `review_note` are revoked from `authenticated` in
        // 20260827185827_provider_status_grants.sql — a provider who could write
        // `status` could approve themselves — so the one legitimate status
        // write goes through `submit_service_provider`, which re-checks
        // ownership and the approved case in the database. Sending any of
        // those three here would now be refused outright, which is the point.
        const statusPatch = submit ? submitStatusPatch(status, now) : {};

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

        // Submitting is its own step now, after the row exists and its columns
        // are saved. The function is the only thing that may move `status`.
        if (Object.keys(statusPatch).length > 0) {
            const { error } = await supabase.rpc('submit_service_provider', { p_id: id });
            if (error) {
                setSaving(false);
                toast.error(error.message, { theme: 'colored' });
                return;
            }
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
        // revoked from `authenticated` in 20260825205043_trade_registration.sql, so
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
                // A priced extra says yes by having a price OR by ticking "I
                // provide a quote". A blank with no quote is a no.
                if (extra.type === 'priced') {
                    return entry.quote === true || (String(entry.price).trim() !== '' && Number(entry.price) > 0);
                }
                return entry.offered;
            })
            .map((extra) => {
                const entry = extraOf(extra.key);
                const byQuote = extra.type === 'priced' && entry.quote === true;
                const priced = extra.type === 'priced' && !byQuote && String(entry.price).trim() !== '' && Number(entry.price) > 0;
                return {
                    provider_id: id,
                    extra_key: extra.key,
                    offered: true,
                    // Null for a toggle, a reimbursed one, or one priced by quote:
                    // the amount is whatever the receipt says, weeks later, or is
                    // quoted per job. Paid host to provider directly, never through us.
                    price: priced ? Number(entry.price) : null,
                    quote: byQuote,
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

        // The child writes below used to be `await …insert(rows)` with the
        // returned error thrown away, so a rejected write (a constraint, an RLS
        // refusal) vanished and the save reported success over the top of it —
        // the class of silent failure that hid the coverage bug. Each one is now
        // checked and, if it fails, named in a warning at the end, like the
        // skills write already does. Nothing here aborts the save (the row is
        // written); it just stops a failure being invisible.
        const savedButFailed: string[] = [];

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
                    // A guest's region has no radius, so this is 0 for them (the
                    // check allows it, and nothing on the guest path reads it); a
                    // host keeps their real radius. Same honest value the finish
                    // route writes, so the two save paths never disagree.
                    radius_miles: a.radius_miles,
                };
            });
            const { error } = await supabase.from('service_areas').insert(rows);
            if (error) {
                console.error('[provider-save] service_areas insert failed', error);
                savedButFailed.push('your coverage areas');
            }
        }

        // Weekly opening hours are NOT written here any more. They moved out of
        // the wizard to the listing editor's Availability section, which is the
        // single home for the weekly template — so the wizard neither asks for
        // hours nor writes slot_availability. A new slot provider sets them in the
        // editor after create; the diary still owns the dated exceptions.

        // The menu — UPSERTED BY ID, not deleted and re-inserted. A guest trade
        // only; a host trade never has items. An item now carries a photo, and
        // delete-then-insert would give every row a new id on every save and
        // orphan the photo attached to it — the kind of thing nobody notices
        // until someone's pictures vanish. So a row that was only edited keeps
        // its id (and its photo); only a row the provider actually removed is
        // deleted. The order snapshots what it was for, so none of this touches
        // a placed order. Empty rows (no name or no price) are dropped.
        if (audienceForTrade(trade) === 'guest') {
            // A slot keeps each item's OWN unit — flat for a private hire, person
            // for a shared table. private/shared derive it from the offering; 'both'
            // has the provider choose it per item on the unit step. Either way a
            // slot row is only ever flat or person, normalised here.
            // The one-at-a-time shape (massage): each treatment carries its own
            // length. NULL for every other category (the provider's single length
            // is used). This is what makes the times a guest sees depend on the
            // treatment, and what the interval-overlap claim reads.
            const slotPerItem = shape === 'slot' && slotDurationPerItem(guestCategory);
            const slotMixed = shape === 'slot' && slotMixedDuration(guestCategory);
            // A TIMED item carries its own length: every item on the pure
            // one-at-a-time shape (massage), and a mixed provider's one-at-a-time
            // items (unit 'flat'). A mixed shared CLASS (unit 'person') is untimed —
            // it uses the provider's single length — so it stores no duration.
            const isTimed = (unit: string) => (slotPerItem || slotMixed) && String(unit) === 'flat';
            const valid = items
                .map((it, i) => ({
                    id: it.id,
                    provider_id: id,
                    name: String(it.name || '').trim(),
                    description: String(it.description || '').trim() || null,
                    price: String(it.price || '').trim() !== '' ? Number(it.price) : null,
                    // A travelling item is always private (flat), whatever the row
                    // carries — nobody joins a class in someone else's cottage.
                    unit: shape === 'slot'
                        ? ((fulfilment === 'both' && String(it.fulfilment) === 'delivery') ? 'flat' : (String(it.unit) === 'person' ? 'person' : 'flat'))
                        : String(it.unit || 'flat'),
                    image: it.image || null,
                    duration_minutes: isTimed(it.unit) && Number(it.duration) > 0 ? Math.round(Number(it.duration)) : null,
                    // Per-item location, only when the provider answered 'both'; null
                    // otherwise (the item inherits the provider's single answer).
                    fulfilment: (shape === 'slot' && fulfilment === 'both') ? (String(it.fulfilment) === 'delivery' ? 'delivery' : 'collection') : null,
                    sort_order: i,
                    active: true,
                }))
                .filter((r) => r.name && r.price !== null && Number(r.price) > 0);

            // ALL-OR-NOTHING for the per-treatment shape: a massage treatment
            // without a length must never reach the database, or it would fall back
            // to the provider length and could overlap a timed treatment — the
            // double-booking again. The duration step is mandatory in the sub-flow,
            // so this only ever fires as a guard; when it does, the untimed row is
            // not written and the provider is told, rather than silently accepted.
            const writable = slotPerItem ? valid.filter((r) => r.duration_minutes != null) : valid;
            if (slotPerItem && writable.length !== valid.length) {
                savedButFailed.push('a length on every treatment');
            }

            // Delete only the rows that are in the database but no longer on the
            // form — the ones the provider took off the menu.
            const { data: existingItems } = await supabase
                .from('service_provider_items').select('id').eq('provider_id', id);
            const keep = new Set(writable.map((r) => r.id).filter(Boolean));
            const removed = (existingItems || [])
                .map((r: any) => r.id)
                .filter((x: string) => !keep.has(x));
            if (removed.length) {
                await supabase.from('service_provider_items').delete().in('id', removed);
            }

            // Edited rows keep their id (update in place); new rows have none
            // (insert, letting the id default). Split so each request carries a
            // uniform set of columns.
            const toUpdate = writable.filter((r) => r.id);
            const toInsert = writable.filter((r) => !r.id).map(({ id: _omit, ...rest }) => rest);
            if (toUpdate.length) {
                const { error } = await supabase.from('service_provider_items').upsert(toUpdate);
                if (error) { console.error('[provider-save] items upsert failed', error); savedButFailed.push('your prices'); }
            }
            if (toInsert.length) {
                const { error } = await supabase.from('service_provider_items').insert(toInsert);
                if (error) { console.error('[provider-save] items insert failed', error); savedButFailed.push('your prices'); }
            }
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

        // A child write was refused. The row saved, but a part they filled in did
        // not — say so plainly and name it, rather than the old silent success.
        // (A guest whose coverage or prices vanished would otherwise find out
        // only when nobody could book them.)
        if (savedButFailed.length) {
            const parts = Array.from(new Set(savedButFailed));
            toast.warning(
                'Your listing saved, but we could not save ' + parts.join(' or ') + '. Please try that part again.',
                { theme: 'colored', autoClose: false }
            );
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

    if (loading) {
        return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>;
    }

    // The read failed. Never the blank form — that would invite a second row
    // over one we could not read. Offer a retry instead.
    if (loadFailed) {
        return (
            <div className="max-w-md mx-auto px-4 sm:px-6 py-16 text-center">
                <p className="text-slate-900 font-semibold">We couldn’t load your details.</p>
                <p className="text-sm text-slate-500 mt-1.5">
                    Nothing has been lost — this is a problem reading your account, not your work.
                </p>
                <button type="button" onClick={() => window.location.reload()}
                    className="mt-6 inline-flex items-center rounded-full bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
                    Try again
                </button>
            </div>
        );
    }

    // EVERY SIGN-UP OPENS THE SAME WAY: "What's your email?", a 6-digit code,
    // signed in — the shared first step the holiday-let sign-up opens on too.
    //
    // It replaced two different starts: the guest wizard's own g_verify screen,
    // and a trade applying signed out and being emailed a verification link
    // AFTER submitting (/api/services/apply). The address is now proved before
    // anything is typed, so a trade saves through the ordinary signed-in path
    // and there is no link to wait for. Links already sent under the old flow
    // still work — /services/join/finish/[token] is untouched, and attaches the
    // application to the account if the code step has since made one.
    //
    // A full reload once signed in, so load() runs again as the owner and the
    // wizard opens exactly as it does for any returning signed-in applicant.
    if (!session) {
        return (
            <EmailFirstStep
                eyebrow={isGuest ? 'Host a guest experience' : 'Offer a service'}
                intro={isGuest
                    ? 'Sign in or create your free account to set up your experience. Everything you add is saved to your account as you go.'
                    : 'Sign in or create your free account to set up your business. Everything you add is saved to your account as you go.'}
                exitHref="/business"
                onSignedIn={() => window.location.reload()}
            />
        );
    }

    const summary = statusSummary(status);
    const locked = status === 'pending_review';

    const position = stepNumber(trade, step, stepCtx);
    const total = stepCount(trade, stepCtx);
    const lastStep = isLastStep(trade, step, stepCtx);

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
        <div className="fixed inset-0 z-[60] flex flex-col bg-white">
            {/* One full-page takeover for everyone — a guest experience and a
                host trade now share the same wizard (no card, no dimmed backdrop),
                matching /addhome and the fork. */}
            <div className="flex flex-col w-full h-full bg-white overflow-hidden">

                {/* Takeover top bar — Back top-left, brand, close top-right. No
                    step count or per-screen segments: the flow is named sections
                    (the left rail on wide screens, the section eyebrow at the top
                    of each screen on a phone), the same for a guest and a trade. */}
                <div className="shrink-0 border-b border-slate-100 px-4 sm:px-8">
                    <div className="flex h-16 items-center justify-between gap-3">
                        {/* Guests keep Back top-left; a trade's Back lives in the
                            footer (both its buttons at the bottom), so a spacer here
                            keeps the brand centred. */}
                        {isGuest ? (
                            (position > 1 || openGroup) ? (
                                <button type="button" onClick={goBack} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition">
                                    <ChevronLeft className="w-5 h-5" /> Back
                                </button>
                            ) : (
                                <Link href="/business" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition">
                                    <ChevronLeft className="w-5 h-5" /> Back
                                </Link>
                            )
                        ) : (
                            <span className="w-9" aria-hidden />
                        )}
                        <span className="text-sm font-bold tracking-tight text-slate-900">Galloway Getaways</span>
                        <Link href="/business" aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition">
                            <X className="w-5 h-5" />
                        </Link>
                    </div>
                </div>

                {/* For a guest, a two-column body on wide screens: the named-
                    section rail on the left, the scrolling question column on
                    the right. Below lg the rail is hidden and the section name
                    rides as an eyebrow at the top of each screen instead. A host
                    trade keeps its single column (`contents` adds no wrapper). */}
                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {currentSection && flowSections.length > 0 && (
                        <nav aria-label="Sections"
                            className={'hidden lg:flex shrink-0 flex-col overflow-y-auto border-r border-slate-100 py-12 transition-[width] duration-300 ease-out '
                                + (railCollapsed ? 'w-16 px-2' : 'w-72 px-6')}>
                            <div className={'flex flex-col ' + (railCollapsed ? 'gap-1' : 'gap-0.5')}>
                                {flowSections.map((sec) => {
                                    const st = sectionStatus(sec);
                                    const summary = st === 'done' ? sectionSummary(sec.key) : '';
                                    const clickable = st === 'done';
                                    return (
                                        <button
                                            key={sec.key}
                                            type="button"
                                            disabled={!clickable}
                                            onClick={() => clickable && goToStep(sec.firstStep)}
                                            aria-current={st === 'active' ? 'step' : undefined}
                                            // On the collapsed strip the label is gone, so
                                            // the name rides as a native hover tooltip.
                                            title={railCollapsed ? sec.label : undefined}
                                            className={'group flex rounded-xl transition '
                                                + (railCollapsed ? 'items-center justify-center p-2 ' : 'items-start gap-3 px-3 py-2.5 text-left ')
                                                + (clickable ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default')}
                                        >
                                            <span className={'flex h-6 w-6 shrink-0 items-center justify-center rounded-full '
                                                + (railCollapsed ? '' : 'mt-0.5 ')
                                                + (st === 'done' ? 'bg-emerald-600 text-white'
                                                    : st === 'active' ? 'border-2 border-emerald-600 text-emerald-700'
                                                        : 'border-2 border-slate-200 text-slate-400')}>
                                                {(() => {
                                                    if (st === 'done') return <Check className="h-3.5 w-3.5" strokeWidth={3} />;
                                                    const Ic = SECTION_ICONS[sec.key];
                                                    return Ic ? <Ic className="h-3.5 w-3.5" strokeWidth={2.25} /> : null;
                                                })()}
                                            </span>
                                            {!railCollapsed && (
                                                <span className="min-w-0">
                                                    <span className={'block text-sm '
                                                        + (st === 'active' ? 'font-bold text-slate-900'
                                                            : st === 'done' ? 'font-semibold text-slate-700'
                                                                : 'font-medium text-slate-400')}>
                                                        {sec.label}
                                                    </span>
                                                    {summary && (
                                                        <span className="mt-0.5 block truncate text-xs text-slate-400">{summary}</span>
                                                    )}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Collapse / expand control, pinned to the bottom of the
                                rail. The chevron points the way the rail will move:
                                left to fold it away, right to open it back up. */}
                            <button
                                type="button"
                                onClick={toggleRail}
                                aria-label={railCollapsed ? 'Expand sections' : 'Collapse sections'}
                                className={'mt-auto flex items-center rounded-xl py-2.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 '
                                    + (railCollapsed ? 'justify-center px-2' : 'gap-2 px-3')}
                            >
                                {railCollapsed
                                    ? <ChevronRight className="h-5 w-5" />
                                    : <><ChevronLeft className="h-5 w-5" /><span className="text-sm font-medium">Collapse</span></>}
                            </button>
                        </nav>
                    )}

                {/* ---- the questions ---- */}
                {/* ONE panel layout, keyed on the STEP, shared by both audiences —
                    so a trade page and its guest equivalent can never sit in
                    different positions or drift apart again. Only two screens
                    differ by audience, and only because their CONTENT genuinely
                    does: the picker (a five-card guest grid vs a host trade grid)
                    and the finish screen (a full-width guest listing preview vs the
                    host account panel). Every question screen — the shared years
                    opener, the About-you hub, the business screens — resolves to
                    the same class for both. */}
                <div id="signup-panel" className={'flex-1 w-full mx-auto overflow-y-auto px-5 sm:px-6 '
                    + (step === 'trade'
                        ? (isGuest
                            /* Guest: sits lower with more air, and widens so the
                               five category cards sit on a single row. */
                            ? 'max-w-5xl pt-20 pb-10 sm:pt-28 sm:pb-12'
                            : 'max-w-3xl pt-14 pb-10 sm:pt-16 sm:pb-12')
                        : step === 'g_subtype'
                            ? 'max-w-3xl py-10 sm:py-12'
                            /* The centred-stepper screens are a flex column so the
                               stepper centres in the space under the question rather
                               than sitting high with a void. g_you is SHARED, so a
                               host trade now gets exactly the guest's centred years
                               layout. */
                            : (step === 'g_you' || step === 'g_capacity' || step === 'g_notice' || step === 'g_slot_min' || step === 'g_slot_length')
                                ? 'max-w-2xl py-10 sm:py-12 flex flex-col'
                                : step === 'finish'
                                    /* Guest finish is a full-width listing preview;
                                       a host's is the narrower account panel. */
                                    ? (isGuest ? 'max-w-6xl py-10 sm:py-12' : 'max-w-3xl py-10 sm:py-12')
                                    /* The made-to-order fork and the slot choice
                                       forks centre their cards in the space on
                                       desktop, like the steppers. */
                                    : (guestMtoArea || guestSlotChoice)
                                        ? 'max-w-2xl py-10 sm:py-12 sm:flex sm:flex-col'
                                        : 'max-w-2xl py-10 sm:py-12')}>
                    {/* One big question a screen. The picker screens (group,
                        sub-type) and the years opener centre it — over the cards
                        for the pickers, over the big stepper for the years, both
                        Airbnb-style; the other content screens sit it left over
                        their fields. The finish step carries its own heading. */}
                    {/* The section name, at the top of every screen inside a
                        section — the mobile stand-in for the rail, and a quiet
                        anchor on desktop too. The pickers (trade, g_subtype)
                        have no section, so it shows nothing there. */}
                    {currentSection && (
                        <p className={'text-xs font-bold uppercase tracking-[0.12em] text-emerald-700 mb-3 '
                            + ((step === 'g_you' || step === 'g_creds' || step === 'g_menu' || step === 'g_capacity' || step === 'g_notice' || step === 'g_photos' || step === 'g_shape' || step === 'g_slot_basis' || step === 'g_slot_min' || step === 'g_slot_where' || step === 'g_slot_length' || step === 'g_title') ? 'text-center' : '')}>
                            {currentSection.label}
                        </p>
                    )}
                    {/* A host trade's per-screen heading — the question, as a body
                        h1, the way the guest screens carry theirs (it used to live
                        in the modal header). The finish step has its own heading;
                        the trade picker's h1 is rendered with its tiles below; and
                        g_creds (the expertise hub) renders its OWN heading with the
                        photo, so the generic step title is suppressed there — the
                        same exclusion the guest branch below makes. */}
                    {!isGuest && step !== 'finish' && step !== 'trade' && step !== 'g_creds' && (
                        <h1 className="font-extrabold tracking-tight text-slate-900 [text-wrap:balance] text-3xl sm:text-4xl mb-8">
                            {stepMeta.title}
                        </h1>
                    )}
                    {!isGuest && step === 'trade' && (
                        <h1 className="font-extrabold tracking-tight text-slate-900 [text-wrap:balance] text-3xl sm:text-4xl mb-8 text-center">
                            {stepMeta.title}
                        </h1>
                    )}
                    {isGuest && step !== 'finish' && step !== 'g_creds' && step !== 'g_menu' && step !== 'g_capacity' && step !== 'g_slot_min' && step !== 'g_slot_length' && step !== 'g_slot_hours' && (
                        <h1 className={'font-extrabold tracking-tight text-slate-900 [text-wrap:balance] text-3xl sm:text-4xl '
                            + ((step === 'trade' || step === 'g_subtype' || step === 'g_you' || step === 'g_notice' || step === 'g_shape' || step === 'g_slot_basis' || step === 'g_slot_where' || step === 'g_title') ? 'mb-10 text-center'
                                /* g_photos is centred (this screen only, to match
                                   Airbnb) with a tight gap so "Add at least 3 photos."
                                   reads as a subtitle, not a stranded paragraph. */
                                : step === 'g_photos' ? 'mb-2 text-center'
                                    : 'mb-8')}>
                            {step === 'trade'
                                ? 'What experience are you offering guests?'
                                /* g_area is the PLACE now. A traveller is asked where
                                   they cover; a made-to-order asks the fulfilment
                                   fork; a slot's heading follows its fulfilment — the
                                   address it gives (premises or meeting point) or the
                                   regions it travels to. Session length and hours are
                                   their own screens (g_slot_length/g_slot_hours) and
                                   ride the generic stepMeta title. */
                                : (step === 'g_area' && shape === 'comes_to_you')
                                    ? GUEST_SCREEN_COPY.locationHeadingTravel
                                    : (step === 'g_area' && shape === 'made_to_order')
                                        ? GUEST_SCREEN_COPY.fulfilmentHeading
                                    : (step === 'g_area' && shape === 'slot')
                                        ? (fulfilment === 'both'
                                            ? GUEST_SCREEN_COPY.slotPlaceHeadingBoth
                                            : fulfilment === 'delivery'
                                            ? GUEST_SCREEN_COPY.slotPlaceHeadingTravel
                                            : slotIsMeetingPoint(guestCategory)
                                                ? GUEST_SCREEN_COPY.slotPlaceHeadingMeeting
                                                : GUEST_SCREEN_COPY.slotPlaceHeadingPremises)
                                    : step === 'g_photos'
                                        ? GUEST_SCREEN_COPY.photosHeading
                                        : stepMeta.title}
                        </h1>
                    )}
                    {/* Max guests renders its heading here, at the top, exactly
                        where the years question sits (same classes, same spacing
                        after the eyebrow), so the two questions line up. Its
                        wording is shape-aware, so it can't ride the generic h1
                        above. The stepper alone fills the centred space below. */}
                    {isGuest && step === 'g_capacity' && (
                        <>
                            <h1 className="font-extrabold tracking-tight text-slate-900 [text-wrap:balance] text-3xl sm:text-4xl text-center mb-2">
                                {shape === 'comes_to_you' ? GUEST_SCREEN_COPY.capacityHeadingTravel : GUEST_SCREEN_COPY.capacityHeadingVenue}
                            </h1>
                            <p className="text-center text-sm text-slate-500 [text-wrap:balance] mb-10">
                                {shape === 'comes_to_you' ? GUEST_SCREEN_COPY.capacitySubtextTravel : GUEST_SCREEN_COPY.capacitySubtextVenue}
                            </p>
                        </>
                    )}
                    {/* The minimum screen renders its heading+subtext here, at the
                        top like g_capacity, so the question and its explanation sit
                        above the big centred stepper rather than below it. */}
                    {isGuest && step === 'g_slot_min' && (
                        <>
                            <h1 className="font-extrabold tracking-tight text-slate-900 [text-wrap:balance] text-3xl sm:text-4xl text-center mb-2">
                                {GUEST_SCREEN_COPY.slotMinQuestion}
                            </h1>
                            <p className="text-center text-sm text-slate-500 [text-wrap:balance] mb-10">
                                {GUEST_SCREEN_COPY.slotMinSubtext}
                            </p>
                        </>
                    )}
                    {/* Session length renders its heading+subtext here, above the
                        big centred stepper — same shape as capacity and the
                        minimum. */}
                    {isGuest && step === 'g_slot_length' && (
                        <>
                            <h1 className="font-extrabold tracking-tight text-slate-900 [text-wrap:balance] text-3xl sm:text-4xl text-center mb-2">
                                {GUEST_SCREEN_COPY.slotLengthQuestion}
                            </h1>
                            <p className="text-center text-sm text-slate-500 [text-wrap:balance] mb-10">
                                {GUEST_SCREEN_COPY.slotLengthSubtext}
                            </p>
                        </>
                    )}

            {/* The "your details have been saved" banner used to sit here on
                every step. It restored with a draft — so it showed before
                anything had been typed — and it repeated on each screen, which
                read as noise rather than reassurance. The draft still saves
                (that behaviour is untouched); it just no longer announces
                itself on every page. */}

            {/* Sent, and waiting on us. */}
            {status === 'pending_review' && (
                <div className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-5">
                    <p className="font-semibold text-amber-900">{summary.label}</p>
                    <p className="text-sm text-amber-900/80 mt-1">
                        Thanks — we check every business before it appears, usually within {REVIEW_WITHIN_HOURS} hours.
                        We will email you either way. You can still read what you sent below.
                    </p>
                    {/* A guest business is read by a person, who decides whether
                        it fits and what category it takes before it can go live.
                        Said plainly here so they are not left wondering why theirs
                        is not instant — without promising a yes. */}
                    {audienceForTrade(trade) === 'guest' && (
                        <p className="text-sm text-amber-900/80 mt-3">
                            We read what you described and decide whether it’s a fit for guests before
                            listing you. Nothing more is needed from you — your listing is with us and
                            we’ll be in touch.
                        </p>
                    )}
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
                    {/* NO "LIVE" FOR A GUEST PROVIDER WHO IS NOT YET CONNECTED.
                        statusSummary('approved') says "Live · people can find
                        you" — true for a host, whose approval is the end of it.
                        A guest provider has a second gate (payouts), and the
                        dashboard right below says so; claiming "Live" above it
                        was the panel telling them they were live and not live at
                        once. So the header defers to that gate instead of
                        pre-empting it. */}
                    {audienceForTrade(trade) === 'guest' ? (
                        <>
                            <p className="font-semibold text-emerald-900">You’re approved</p>
                            <p className="text-sm text-emerald-900/80 mt-1">
                                Manage your experience and requests below.
                            </p>
                        </>
                    ) : (
                        /* A live-status banner, not a heading. A bare bold
                           "Live" read as a section title; a provider glancing at
                           it could not tell it was telling them their state. The
                           pulsing dot and the pill say "this is your status"
                           before the words are read. */
                        <>
                            <div className="flex items-center gap-2">
                                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
                                </span>
                                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">{summary.label}</span>
                            </div>
                            <p className="text-sm text-emerald-900/80 mt-1.5">{summary.detail}</p>
                        </>
                    )}

                    {/* A guest-trade provider does two more things here after
                        approval: set up payouts (the second gate) and answer the
                        requests that come in. Kept in its own component so this
                        already-large file does not grow a dashboard inside it. */}
                    {providerId && audienceForTrade(trade) === 'guest' && (
                        <ProviderExperienceDashboard providerId={providerId} />
                    )}
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
                // A guest picks a category, not a trade. Same grid of tiles the
                // tradesman gets, "Something else" last — but these seed a
                // starting category the owner confirms, and never a trade of
                // their own. Branching here on the audience is also what deletes
                // the old bug where the guest picker showed the tradesman trades
                // under a "Guest experience" header: the guest never reaches the
                // host pickerEntries below.
                if (audienceForTrade(trade) === 'guest') {
                    // Screen one: five broad groups, a glyph and a name, nothing
                    // else. The narrower choice is screen two (g_subtype). No
                    // instructions, no Stripe line — the question carries it.
                    return (
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                            {GUEST_GROUPS.map((g) => {
                                const Icon = TRADE_ICONS[g.icon] || Sparkles;
                                // Select, don't advance: the card takes an emerald
                                // outline and the footer Next carries them on — so
                                // this screen behaves the same as the sub-type one.
                                const on = guestGroup === g.key;
                                return (
                                    <button
                                        key={g.key}
                                        type="button"
                                        aria-pressed={on}
                                        onClick={() => selectGroup(g.key)}
                                        className={'group flex flex-col items-center gap-4 rounded-3xl border-2 bg-white p-5 text-center transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 '
                                            + (on ? 'border-emerald-600 shadow-md' : 'border-slate-200 hover:border-slate-300')}
                                    >
                                        {/* The illustration zone — large and dominant, Airbnb-style.
                                            The 3D artwork drops in here: replace the <Icon> with
                                            <img src="/illustrations/guest-<key>.png" alt="" className="h-full w-auto" />.
                                            The fixed height keeps every card's art aligned. */}
                                        <span className="flex h-24 items-center justify-center sm:h-28">
                                            <Icon className={'h-14 w-14 sm:h-16 sm:w-16 ' + (on ? 'text-emerald-700' : 'text-emerald-600')} strokeWidth={1.5} aria-hidden />
                                        </span>
                                        <span className="text-sm font-semibold leading-snug text-slate-900 sm:text-base">{g.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    );
                }

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

                            <TradeTileGrid>
                                {inGroup.map((t) => (
                                    <TradeTile
                                        key={t.key}
                                        tradeKey={t.key}
                                        label={t.label}
                                        hint={taken.indexOf(t.key) !== -1 ? 'You have this one' : undefined}
                                        onClick={() => chooseTrade(t.key)}
                                    />
                                ))}
                            </TradeTileGrid>

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

                // One flat list of every trade — no "Maintenance & repairs"
                // folder. Cleaning stays in the list but as a "Coming soon" tile
                // (visible, not selectable). An "Other" tile lets someone whose
                // trade isn't listed type their own.
                const claimedKeys = mine.map((x: any) => String(x.trade || ''));
                const flat = tradesFor('host').filter((t) => t.key !== 'other' && claimedKeys.indexOf(t.key) === -1);
                // Coming-soon trades are not joinable, so they do not count as
                // trades still "left" to sign up for — keeps the picker grid and
                // the "signed up for everything" line agreeing.
                const left = unclaimedTrades(mine, 'host').filter((t) => !isTradeComingSoon(t.key));

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

                        {(flat.length > 0 || true) && (
                            <>
                                {mine.length > 0 && (
                                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                                        Add another trade
                                    </h2>
                                )}
                                <TradeTileGrid>
                                    {flat.map((t) => (
                                        isTradeComingSoon(t.key) ? (
                                            <TradeTile key={t.key} tradeKey={t.key} label={t.label} comingSoon />
                                        ) : (
                                            <TradeTile
                                                key={t.key}
                                                tradeKey={t.key}
                                                label={t.label}
                                                onClick={() => chooseTrade(t.key)}
                                            />
                                        )
                                    ))}
                                    {/* Their trade isn't on the list — they type it. */}
                                    <TradeTile
                                        key="__other"
                                        tradeKey="other"
                                        label="Something else"
                                        hint="Tell us your trade"
                                        onClick={() => setOtherOpen(true)}
                                    />
                                </TradeTileGrid>
                            </>
                        )}

                        {left.length === 0 && mine.length > 0 && (
                            <p className="text-sm text-slate-500">You have signed up for every trade we cover.</p>
                        )}

                        <SubFlowModal
                            open={otherOpen}
                            title="What's your trade?"
                            onClose={() => setOtherOpen(false)}
                            saveLabel="Continue"
                            saveDisabled={!otherText.trim()}
                            onSave={() => { setOtherOpen(false); chooseTrade('other'); }}
                        >
                            <input
                                type="text"
                                value={otherText}
                                onChange={(e) => setOtherText(e.target.value)}
                                placeholder="e.g. Chimney sweep, Locksmith, Pest control"
                                className="w-full rounded-xl border border-slate-300 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                            />
                            <p className="mt-2 text-sm text-slate-500">We&apos;ll list you under this — you can change it later.</p>
                        </SubFlowModal>
                    </div>
                );
            })()}

            {/* SCREEN TWO — the narrower choice under the chosen group. The
                group card they picked on screen one travels here and lands
                pinned above the choices (a 3D swoosh, not a jump cut). Select a
                sub-type for an emerald outline; the footer Next carries them on.
                Outside the fieldset: it is a picker, not a field. */}
            {onStep('g_subtype') && audienceForTrade(trade) === 'guest' && (() => {
                const groupMeta = GUEST_GROUPS.filter((x) => x.key === guestGroup)[0];
                const GroupIcon = groupMeta ? (TRADE_ICONS[groupMeta.icon] || Sparkles) : Sparkles;
                return (
                    <>
                        {groupMeta && (
                            <div className="mb-9 flex justify-center [perspective:900px]">
                                <div className="animate-guest-swoosh inline-flex items-center gap-3 rounded-2xl border-2 border-emerald-600 bg-emerald-50/60 px-5 py-3 shadow-sm">
                                    <GroupIcon className="h-8 w-8 text-emerald-700" strokeWidth={1.5} aria-hidden />
                                    <span className="text-base font-semibold text-slate-900">{groupMeta.label}</span>
                                </div>
                            </div>
                        )}
                        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                            {categoriesForGroup(guestGroup).map((c) => {
                                const on = guestCategory === c.key;
                                return (
                                    <button
                                        key={c.key}
                                        type="button"
                                        aria-pressed={on}
                                        onClick={() => selectGuestCategory(c.key)}
                                        className={'rounded-2xl border-2 bg-white px-5 py-6 text-center transition hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 '
                                            + (on ? 'border-emerald-600 shadow-sm' : 'border-slate-200 hover:border-slate-300')}
                                    >
                                        <span className="text-base font-semibold text-slate-900">{c.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                );
            })()}

            {/* min-w-0 defeats the <fieldset> quirk: a fieldset defaults to
                min-inline-size:min-content and will not shrink to its container,
                so a wide nowrap child (a truncated row summary) pushed it past
                the panel on a narrow screen and threw the centred content off. */}
            <fieldset disabled={locked} className={'min-w-0 ' + (locked ? 'opacity-70' : '')
                /* On the years opener the fieldset fills the panel below the
                   question so its one section can centre vertically. */
                + (step === 'g_you' || (isGuest && (step === 'g_capacity' || step === 'g_notice' || step === 'g_slot_min' || step === 'g_slot_length')) ? ' flex-1 flex flex-col' : '')
                /* Same fill on the made-to-order fork and the slot choice forks,
                   but desktop only — mobile keeps its natural top-down stack. */
                + (guestMtoArea || guestSlotChoice ? ' sm:flex-1 sm:flex sm:flex-col' : '')}>
                {/* The standalone business step is host-only now. A guest names
                    the experience on g_about ("Name it, and tell guests what it
                    is"), beside the description, so they never answer it twice. */}
                {onStep('business') && (
                    <section className="mb-8">
                        {/* One question a screen now: just the name here. The
                            "What's your business called?" heading is the step h1
                            above, so the field needs no second label of its own. */}
                        <input
                            type="text"
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            placeholder="Solway Joinery"
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
                {/* No separate logo step any more. A trade already adds a photo of
                    themselves on "Tell hosts about yourself" (the g_creds headshot),
                    and that photo is what a listing shows now — so a second "Add a
                    logo" screen asked for an image we had already taken. A guest
                    never had one (its photos ARE its menu items). Legacy logos still
                    display as a fallback where a provider set one before. */}

                {/* The trade chip is gone: it said what they picked, and the
                    modal header now says that on every step. */}

                {/* The host's "Tell us about yourself" free-text description has
                    moved off the business step and become the expertise hub
                    (g_creds, "Tell hosts about yourself"): a profile photo, a
                    professional title and optional qualifications/endorsements,
                    the same hub a guest fills. The business step now carries only
                    the name, coverage and contact. The stored `description` column
                    is derived from the hub at submit (see the payloads). */}

                {/* THE BOOKING SHAPE IS INFERRED, NEVER ASKED. The old "How do
                    guests get it?" screen made a sauna owner classify our internal
                    booking model — obvious from the category, so we read it off
                    the category (cat.shape) at selection instead. Everything that
                    used to sit under it now adapts silently: the price unit on
                    g_menu, and the schedule on the where-and-when step. */}

                {/* EXPERTISE — a hub, Airbnb-style, not a form. A photo of the
                    host at the top, a heading and a line of subtext, then rows
                    that each open a small sub-flow modal. The qualifications row
                    is the one that gates Next for a chef; its "putting their
                    safety in your hands" note lives inside that modal now, so the
                    hub itself stays clean. Built on the reusable HubRow /
                    SubFlowModal primitives, which later screens will want too. */}
                {onStep('g_creds') && (() => {
                    const titleFilled = professionalTitle.trim() !== '';
                    const titleSummary = professionalTitle.trim();
                    const qualsFilled = qualifications.trim() !== '';
                    const recognitionFilled = recognition.trim() !== '';
                    // Borderless fields for the sub-flow modals: no box, no fill,
                    // centred, floating in white space, with a quiet underline. The
                    // counter (where there's a limit) sits at the right-hand end of
                    // the field's line, just above the underline — not centred below.
                    const fieldWrap = 'relative border-b border-slate-200 pb-2 transition-colors focus-within:border-slate-400';
                    const bigInput = 'w-full bg-transparent pr-12 text-center text-2xl text-slate-900 placeholder:text-slate-300 focus:outline-none';
                    const bigArea = 'w-full resize-none bg-transparent text-center text-xl leading-relaxed text-slate-900 placeholder:text-slate-300 focus:outline-none';
                    const counterField = 'pointer-events-none absolute bottom-1 right-0 text-xs text-slate-400';
                    return (
                    <section className="mb-8 md:max-w-xl md:mx-auto">
                        {/* The host photo, centred — the only place it lives now,
                            so it has no row of its own. A neutral circle before a
                            photo, the headshot after. Tapping it opens the file
                            picker directly the first time; once a photo is set,
                            tapping offers replace/remove. A small badge overlaps
                            the bottom-right — a plus before, a pencil after — so
                            it reads as tappable. */}
                        <div className="flex flex-col items-center text-center">
                            <div className="relative h-24 w-24">
                                <button type="button" aria-label={headshot ? 'Change your photo' : 'Add a photo of you'}
                                    onClick={() => (headshot ? setPhotoMenuOpen((o) => !o) : headshotInputRef.current?.click())}
                                    className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-400 transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
                                    {headshot
                                        ? <img src={getImageUrl(headshot)} alt="" className="h-full w-full object-cover" />
                                        : <User className="h-10 w-10" strokeWidth={1.5} />}
                                </button>
                                <span aria-hidden
                                    className="pointer-events-none absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-700 text-white shadow-sm">
                                    {headshot ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
                                </span>
                                {photoMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-[65]" onClick={() => setPhotoMenuOpen(false)} />
                                        <div className="absolute left-1/2 top-full z-[66] mt-3 w-44 -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 text-left shadow-lg">
                                            <button type="button"
                                                onClick={() => { setPhotoMenuOpen(false); headshotInputRef.current?.click(); }}
                                                className="block w-full px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                                                {uploadingHeadshot ? 'Uploading…' : 'Replace photo'}
                                            </button>
                                            <button type="button"
                                                onClick={() => { setPhotoMenuOpen(false); setHeadshot(null); }}
                                                className="block w-full px-4 py-2.5 text-sm text-rose-600 hover:bg-slate-50">
                                                Remove photo
                                            </button>
                                        </div>
                                    </>
                                )}
                                <input ref={headshotInputRef} type="file" accept="image/png, image/jpeg"
                                    className="hidden" onChange={uploadHeadshot} disabled={uploadingHeadshot} />
                            </div>
                            <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance] sm:text-3xl">
                                {isGuest ? GUEST_SCREEN_COPY.expertiseHeading : 'Tell hosts about yourself'}
                            </h1>
                            <p className="mt-2 text-sm text-slate-500 [text-wrap:balance]">
                                {GUEST_SCREEN_COPY.expertiseSubtext}
                            </p>
                        </div>

                        {/* Borderless rows: Your title (which also holds a line
                            about you), Qualifications, Endorsements. Each opens its
                            own modal. Only Qualifications (and only for the required
                            categories) gates Next. The name is NOT asked here — it
                            is the person's account name, captured at the account
                            step and used as the listing title, so asking it again
                            would be asking twice. Photo and title above are the
                            rest of the person. */}
                        <div className="mt-10 space-y-6">
                            <HubRow
                                filled={titleFilled}
                                label={GUEST_SCREEN_COPY.titleRowLabel}
                                prompt={GUEST_SCREEN_COPY.titleRowPrompt}
                                summary={titleSummary}
                                onOpen={() => setExpertiseModal('title')}
                            />
                            {/* Qualifications. For a guest, prompted only where a
                                formal qualification genuinely matters (the
                                physical-safety categories). For a host trade it is
                                always offered — a certificate or a scheme is worth
                                showing on any trade. Optional either way. */}
                            {(catAsksQuals || !isGuest) && (
                                <HubRow
                                    filled={qualsFilled}
                                    label={GUEST_SCREEN_COPY.qualsRowLabel}
                                    suffix={GUEST_SCREEN_COPY.optionalSuffix}
                                    prompt={GUEST_SCREEN_COPY.qualsRowPrompt}
                                    summary={qualifications.trim()}
                                    onOpen={() => setExpertiseModal('quals')}
                                />
                            )}
                            <HubRow
                                filled={recognitionFilled}
                                label={GUEST_SCREEN_COPY.recognitionRowLabel}
                                suffix={GUEST_SCREEN_COPY.optionalSuffix}
                                prompt={GUEST_SCREEN_COPY.recognitionRowPrompt}
                                summary={recognition.trim()}
                                onOpen={() => setExpertiseModal('endorsements')}
                            />
                        </div>


                        {/* ---- Your title (the person's PROFESSIONAL title — a
                            credential shown in the About block, NOT the listing
                            name, which is g_title): one borderless field, no
                            caption, counter at the right above the underline. ---- */}
                        <SubFlowModal
                            open={expertiseModal === 'title'}
                            title={GUEST_SCREEN_COPY.titleModalTitle}
                            onClose={() => setExpertiseModal(null)}
                            saveLabel={GUEST_SCREEN_COPY.save}
                            saveDisabled={!professionalTitle.trim()}
                        >
                            <div className={fieldWrap}>
                                <input
                                    type="text"
                                    value={professionalTitle}
                                    onChange={(e) => setProfessionalTitle(e.target.value.slice(0, 40))}
                                    /* The guest example ("Cold-water swimming
                                       guide") is guest copy — it must not leak onto a
                                       trade page. A trade just gets the field under
                                       its "Your title" heading, no placeholder. */
                                    placeholder={isGuest ? GUEST_SCREEN_COPY.titlePlaceholder : ''}
                                    className={bigInput}
                                />
                                <span className={counterField}>{professionalTitle.length}/40</span>
                            </div>
                        </SubFlowModal>

                        {/* ---- Qualifications (note sits just above Save) ---- */}
                        <SubFlowModal
                            open={expertiseModal === 'quals'}
                            title={GUEST_SCREEN_COPY.qualsModalTitle}
                            onClose={() => setExpertiseModal(null)}
                            saveLabel={GUEST_SCREEN_COPY.save}
                            saveDisabled={!qualifications.trim()}
                            note={GUEST_SCREEN_COPY.qualsOptionalNote}
                        >
                            <div className={fieldWrap}>
                                <textarea
                                    value={qualifications}
                                    onChange={(e) => setQualifications(e.target.value.slice(0, 150))}
                                    rows={4}
                                    /* Guest wording ("A guest chooses you on this")
                                       stays off the trade page — empty for a trade. */
                                    placeholder={isGuest ? GUEST_SCREEN_COPY.qualsPlaceholder : ''}
                                    className={bigArea + ' pr-12'}
                                />
                                <span className={counterField}>{qualifications.length}/150</span>
                            </div>
                        </SubFlowModal>

                        {/* ---- Endorsements: always optional (note above Save) ---- */}
                        <SubFlowModal
                            open={expertiseModal === 'endorsements'}
                            title={GUEST_SCREEN_COPY.recognitionModalTitle}
                            onClose={() => setExpertiseModal(null)}
                            saveLabel={GUEST_SCREEN_COPY.save}
                            saveDisabled={!recognition.trim()}
                            note={GUEST_SCREEN_COPY.recognitionNote}
                        >
                            <div className={fieldWrap}>
                                <textarea
                                    value={recognition}
                                    onChange={(e) => setRecognition(e.target.value)}
                                    rows={4}
                                    placeholder={GUEST_SCREEN_COPY.recognitionPlaceholder}
                                    className={bigArea}
                                />
                            </div>
                        </SubFlowModal>
                    </section>
                    );
                })()}

                {/* WHAT THEY OFFER, AND FOR HOW MUCH.
                    One model for everyone now — no preset trade to frame it by.
                    Everyone names each thing a guest can book and its price: a
                    chef with one set dinner adds one row; a baker lists a cake,
                    cupcakes and a tray bake at three prices nobody could guess.
                    The guest picks an item; the order snapshots it. A provider
                    with no priced item is simply not live to guests. A one-item
                    menu renders as a single price on the card, so the chef's
                    "one thing, one price" reads exactly as it should. */}
                {onStep('g_menu') && audienceForTrade(trade) === 'guest' && (() => {
                    // Rebuilt to the flow's craft: a centred question, then each
                    // priced thing as a borderless HubRow (name + price + a photo
                    // thumbnail), an add row at the bottom, and a per-item sub-flow
                    // of one question a screen (name → price+type → description →
                    // photo), the same shape as Airbnb's itinerary. The pricing
                    // MODEL is unchanged — the same units and the same commission,
                    // only the presentation. A slot is one session offering (a
                    // sauna owner sells "the sauna", not a list), so it shows a
                    // single row with no add and its price unit read off the
                    // private/shared answer rather than picked here.
                    const isSlot = shape === 'slot';
                    // The one-at-a-time shape (massage): a repeating list of
                    // treatments, each with its OWN length, priced whole for one
                    // person. It is neither the single-offering slot (sauna) nor a
                    // 'both' provider — a third presentation: the menu hub's
                    // repeating list, plus a duration step in the item sub-flow.
                    const perItemShape = isSlot && slotDurationPerItem(guestCategory);
                    // The mixed shape (yoga, pottery, painting): the menu is a
                    // repeating list and EACH item chooses, in its own sub-flow,
                    // between a shared class (per-person, untimed — the provider
                    // length) and a one-at-a-time booking (flat, with its own
                    // duration). Both live on one provider.
                    const mixedShape = isSlot && slotMixedDuration(guestCategory);
                    // A traveller's session is EXCLUSIVE by definition — nobody books
                    // a place in a class held in someone else's cottage — so the
                    // shared-vs-private question is only asked of a come-to-me
                    // provider. Fulfilment is answered at g_slot_where (or defaulted),
                    // both BEFORE this menu screen, so it is known here. A travelling
                    // mixed provider is treated like the pure one-at-a-time shape:
                    // every item is a private session, timed, no question.
                    // Provider-level travel: true only when the whole listing travels
                    // ('delivery'). A 'both' provider is false here and resolves travel
                    // PER ITEM below (itemTravels), where the item's location is known.
                    const travels = fulfilment === 'delivery';
                    // 'offer both' is the only slot where the unit is ambiguous, so
                    // it alone lets the provider add items and choose each one's unit
                    // (session vs person) as a step in the sub-flow. private/shared
                    // stay a single item whose unit is derived, never asked.
                    const slotBoth = isSlot && slotOffer === 'both';
                    const blank = { id: undefined as string | undefined, name: '', description: '', price: '', unit: 'flat', image: null as string | null, duration: '' };

                    const UNIT_WORD: Record<string, string> = GUEST_SCREEN_COPY.priceUnitLabels;
                    const unitWord = (r: { unit: string }) => isSlot
                        ? (String(r.unit) === 'person' ? 'per person' : 'for the session')
                        : (UNIT_WORD[r.unit || 'flat'] || '');
                    const rowSummary = (r: { price: string; unit: string; duration?: string }) => {
                        const p = String(r.price || '').trim();
                        if (!(p !== '' && Number(p) > 0)) return GUEST_SCREEN_COPY.menuRowPrompt;
                        // For a treatment, the length is the useful qualifier ("£60 ·
                        // 60 min"), not a per-person/session unit that never varies.
                        // A timed row (a treatment, or a mixed provider's flat 1:1)
                        // reads by its length; a shared class reads by its unit.
                        const timedRow = perItemShape || (mixedShape && String(r.unit) === 'flat');
                        const qualifier = timedRow
                            ? (Number(r.duration) > 0 ? String(Math.round(Number(r.duration))) + ' min' : '')
                            : unitWord(r);
                        return '£' + p + (qualifier ? ' · ' + qualifier : '');
                    };
                    // An item is done only when it has BOTH a name and a real price —
                    // the tick has to mean that. A seeded 'both' row ('For the whole
                    // thing', 'Per person') has a name from the start, so keying the tick off
                    // the name alone showed it as done while it still read "Name it
                    // and set a price". This is the completeness the row displays.
                    const isRowComplete = (r: { name: string; price: string }) =>
                        String(r.name || '').trim() !== '' && Number(r.price) > 0;

                    // The slot shapes this offer prices as — the whole session (a
                    // flat, private hire) and/or a per-person seat — each shown as a
                    // NAMED guidance row until the host fills it, so the screen is
                    // never a blank list. private/shared show only their one shape;
                    // 'both' shows both. A shape the host has already priced shows
                    // their real item; guidance never appears over real data.
                    const offerUnits: string[] = slotOffer === 'private' ? ['flat']
                        : slotOffer === 'shared' ? ['person']
                            : ['flat', 'person'];
                    const shapeMeta: Record<string, { label: string; hint: string }> = {
                        flat: { label: GUEST_SCREEN_COPY.menuSlotUnitFlat, hint: GUEST_SCREEN_COPY.menuSlotUnitFlatHint },
                        person: { label: GUEST_SCREEN_COPY.menuSlotUnitPerson, hint: GUEST_SCREEN_COPY.menuSlotUnitPersonHint },
                    };
                    const shapeRows = offerUnits.map((unit) => {
                        const index = items.findIndex((r) => String(r.unit) === unit);
                        return { unit, label: shapeMeta[unit].label, hint: shapeMeta[unit].hint, index, item: index >= 0 ? items[index] : null };
                    });
                    const usedIdx = new Set(shapeRows.filter((r) => r.index >= 0).map((r) => r.index));
                    // Any item beyond the one-per-shape starters (a 'both' host who
                    // added a further option), rendered as its own row after them.
                    const extraRows = items.map((r, i) => ({ r, i })).filter(({ i }) => !usedIdx.has(i));

                    const rows = items;
                    const setField = (i: number, field: 'name' | 'description' | 'price' | 'unit' | 'duration' | 'fulfilment', val: string) =>
                        setItems((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: val } : r)));

                    const openEdit = (i: number) => { setMenuIndex(i); setUnitLocked(false); setMenuStep(0); setPayoutOpen(false); };
                    const openAdd = () => { setItems((prev) => [...prev, { ...blank }]); setMenuIndex(items.length); setUnitLocked(false); setMenuStep(0); setPayoutOpen(false); };
                    // Opening a named shape guidance row. The item's unit IS the shape
                    // (locked, so 'both' skips the unit step — tapping the shape was
                    // the unit choice); its name is the host's to write and its price
                    // is empty. It lives in state so the sub-flow can edit it, but is
                    // dropped on cancel and kept OUT of the draft until it has a price
                    // (see the draft filter) — the suggestion itself persists nothing.
                    const openGuidance = (unit: string) => {
                        setItems((prev) => [...prev, { id: undefined as string | undefined, name: '', description: '', price: '', unit, image: null as string | null, duration: '' }]);
                        setMenuIndex(items.length); setUnitLocked(true); setMenuStep(0); setPayoutOpen(false);
                    };
                    // On close, a slot drops any item with no real price — so a
                    // guidance shape opened and abandoned leaves nothing behind and its
                    // row returns to guidance. A full menu keeps a named-but-unpriced
                    // draft as before (its final save drops it).
                    const closeItem = () => {
                        setItems((prev) => prev.filter((r) => isSlot ? Number(r.price) > 0 : (String(r.name || '').trim() !== '' || String(r.price || '').trim() !== '')));
                        setMenuIndex(null); setUnitLocked(false);
                    };
                    const removeItem = (i: number) => { setItems((prev) => prev.filter((_, j) => j !== i)); setMenuIndex(null); setUnitLocked(false); };

                    const it = menuIndex !== null ? items[menuIndex] : null;
                    const nameFilled = !!it && String(it.name || '').trim() !== '';
                    const priceNum = it ? (Number(it.price) || 0) : 0;
                    const priceFilled = priceNum > 0;
                    // PER-ITEM LOCATION. A provider who answered 'both' to "where does
                    // it happen?" (fulfilment === 'both') sets each item's location in
                    // its own sub-flow. So `travels` becomes a per-ITEM fact here — a
                    // travelling item drives the same forced-private+timed path the
                    // pure-delivery provider gets, a studio item the come-to-me path.
                    // Until the item's location is answered it reads as not-travelling.
                    const locationPerItem = isSlot && fulfilment === 'both';
                    const itemTravels = travels || (locationPerItem && String(it && it.fulfilment) === 'delivery');
                    const mixedChoiceItem = mixedShape && !itemTravels;
                    const forcedOneToOneItem = perItemShape || (mixedShape && itemTravels);
                    // The sub-flow is one question a screen. A 'both' slot gets the
                    // unit-choice screen between price and description — but only when
                    // the unit is not already decided by the shape the host opened
                    // (unitLocked). Steps are addressed by KIND, not a bare index.
                    // One question a screen. The per-treatment shape inserts DURATION
                    // between name and price — the one added screen, same craft, no
                    // per-person/unit step (a treatment is always flat). 'both' keeps
                    // its unit step; everything else is name → price → desc → photo.
                    // A come-to-me mixed provider is asked HOW IT IS BOOKED after the
                    // name (a shared class vs a private session), and only a private
                    // session (unit 'flat') then gets the duration screen; a class
                    // skips it and uses the provider length. Massage and a TRAVELLING
                    // mixed provider skip the question entirely — every item is a
                    // private session, so it goes straight to the duration screen.
                    const mixedTimed = mixedChoiceItem && String(it && it.unit) === 'flat';
                    // A 'both' provider is asked the item's LOCATION right after its
                    // name — before booked/duration, which depend on whether it travels.
                    const locStep: Array<'location'> = locationPerItem ? ['location'] : [];
                    const stepKinds: Array<'name' | 'location' | 'booked' | 'duration' | 'price' | 'unit' | 'desc' | 'photo'> = forcedOneToOneItem
                        ? ['name', ...locStep, 'duration', 'price', 'desc', 'photo']
                        : mixedChoiceItem
                            ? (mixedTimed
                                ? ['name', ...locStep, 'booked', 'duration', 'price', 'desc', 'photo']
                                : ['name', ...locStep, 'booked', 'price', 'desc', 'photo'])
                            : (slotBoth && !unitLocked)
                                ? ['name', 'price', 'unit', 'desc', 'photo']
                                : ['name', ...locStep, 'price', 'desc', 'photo'];
                    const LAST = stepKinds.length - 1;
                    const stepKind = stepKinds[menuStep] ?? 'name';
                    const durationFilled = !!it && (Number(it.duration) || 0) > 0;

                    // The borderless fields shared with the expertise hub sub-flow.
                    const fieldWrap = 'relative border-b border-slate-200 pb-2 transition-colors focus-within:border-slate-400';
                    const bigInput = 'w-full bg-transparent text-center text-2xl text-slate-900 placeholder:text-slate-300 focus:outline-none';
                    const bigArea = 'w-full resize-none bg-transparent text-center text-xl leading-relaxed text-slate-900 placeholder:text-slate-300 focus:outline-none';

                    // The payout maths is the SAME one the order actually uses
                    // (lib/pricing.serviceCommission, rounded to the penny) rather
                    // than a fresh multiply, so the "You keep" figure matches what
                    // the provider is really paid.
                    const commission = serviceCommission(priceNum, DEFAULT_SERVICE_COMMISSION);
                    const keep = Math.max(0, priceNum - commission);

                    return (
                        <section className="mb-8 md:max-w-xl md:mx-auto">
                            <div className="text-center">
                                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance] sm:text-3xl">
                                    {isSlot ? GUEST_SCREEN_COPY.menuHeadingSlot : GUEST_SCREEN_COPY.menuHeading}
                                </h1>
                                <p className="mt-2 text-sm text-slate-500 [text-wrap:balance]">
                                    {isSlot ? GUEST_SCREEN_COPY.menuSubtextSlot : GUEST_SCREEN_COPY.menuSubtext}
                                </p>
                            </div>

                            <div className="mt-8 space-y-1">
                                {(isSlot && !perItemShape && !mixedShape) ? (
                                    // A slot's shapes as named rows: a priced one shows
                                    // the host's real item; an unfilled one is guidance
                                    // (the shape's name + what it means) that persists
                                    // nothing until opened and priced. 'both' can add a
                                    // further option beyond the two; private/shared can't.
                                    <>
                                        {shapeRows.map((s) => (s.item
                                            ? <HubRow
                                                key={s.unit}
                                                filled={isRowComplete(s.item)}
                                                thumb={s.item.image ? getImageUrl(s.item.image) : null}
                                                label={s.item.name.trim() || s.label}
                                                prompt={GUEST_SCREEN_COPY.menuRowPrompt}
                                                summary={rowSummary(s.item)}
                                                onOpen={() => openEdit(s.index)}
                                            />
                                            : <HubRow
                                                key={s.unit}
                                                filled={false}
                                                label={s.label}
                                                prompt={s.hint}
                                                onOpen={() => openGuidance(s.unit)}
                                            />
                                        ))}
                                        {extraRows.map(({ r, i }) => (
                                            <HubRow
                                                key={r.id || i}
                                                filled={isRowComplete(r)}
                                                thumb={r.image ? getImageUrl(r.image) : null}
                                                label={r.name.trim() || GUEST_SCREEN_COPY.menuSlotRowLabel}
                                                prompt={GUEST_SCREEN_COPY.menuRowPrompt}
                                                summary={rowSummary(r)}
                                                onOpen={() => openEdit(i)}
                                            />
                                        ))}
                                        {slotBoth && (
                                            <HubRow
                                                filled={false}
                                                label={GUEST_SCREEN_COPY.menuSlotAddRow}
                                                prompt={GUEST_SCREEN_COPY.menuRowPrompt}
                                                onOpen={openAdd}
                                            />
                                        )}
                                    </>
                                ) : (
                                    // A full menu (non-slot): the host's items, add-style.
                                    <>
                                        {rows.map((r, i) => (
                                            <HubRow
                                                key={r.id || i}
                                                filled={isRowComplete(r)}
                                                thumb={r.image ? getImageUrl(r.image) : null}
                                                label={r.name.trim() || GUEST_SCREEN_COPY.menuUntitled}
                                                prompt={GUEST_SCREEN_COPY.menuRowPrompt}
                                                summary={rowSummary(r)}
                                                onOpen={() => openEdit(i)}
                                            />
                                        ))}
                                        <HubRow
                                            filled={false}
                                            label={GUEST_SCREEN_COPY.menuAddRow}
                                            prompt={GUEST_SCREEN_COPY.menuRowPrompt}
                                            onOpen={openAdd}
                                        />
                                    </>
                                )}
                            </div>

                            {it && menuIndex !== null && (
                                <SubFlowModal
                                    open
                                    title={
                                        stepKind === 'name' ? (isSlot ? GUEST_SCREEN_COPY.menuNameTitleSlot : GUEST_SCREEN_COPY.menuNameTitle)
                                            : stepKind === 'location' ? GUEST_SCREEN_COPY.menuLocationTitle
                                            : stepKind === 'booked' ? GUEST_SCREEN_COPY.menuBookedTitle
                                            : stepKind === 'duration' ? 'How long is it?'
                                                : stepKind === 'price' ? GUEST_SCREEN_COPY.menuPriceTitle
                                                    : stepKind === 'unit' ? GUEST_SCREEN_COPY.menuSlotUnitTitle
                                                        : stepKind === 'desc' ? GUEST_SCREEN_COPY.menuDescTitle
                                                            : GUEST_SCREEN_COPY.menuPhotoTitle
                                    }
                                    onClose={closeItem}
                                    onBack={menuStep > 0 ? () => setMenuStep((s) => s - 1) : undefined}
                                    onRemove={(!isSlot || slotBoth || perItemShape || mixedShape) ? () => removeItem(menuIndex) : undefined}
                                    saveLabel={menuStep === LAST ? GUEST_SCREEN_COPY.save : GUEST_SCREEN_COPY.menuNext}
                                    saveDisabled={(stepKind === 'name' && !nameFilled) || (stepKind === 'location' && !String(it.fulfilment || '')) || (stepKind === 'duration' && !durationFilled) || (stepKind === 'price' && !priceFilled)}
                                    onSave={menuStep === LAST ? closeItem : () => setMenuStep((s) => s + 1)}
                                    note={menuStep === LAST ? GUEST_SCREEN_COPY.menuPhotoPrompt : undefined}
                                >
                                    {stepKind === 'name' && (
                                        <div className={fieldWrap}>
                                            <input
                                                type="text" value={it.name}
                                                onChange={(e) => setField(menuIndex, 'name', e.target.value)}
                                                placeholder={GUEST_SCREEN_COPY.menuNameExamples[guestCategory] ?? GUEST_SCREEN_COPY.menuNameExampleFallback}
                                                className={bigInput}
                                            />
                                        </div>
                                    )}
                                    {stepKind === 'location' && (
                                        // The per-item location, for a provider who runs
                                        // both studio and travelling sessions. Picking
                                        // "I come to the guest" makes the item a private
                                        // session (unit 'flat') — nobody joins a class held
                                        // in someone else's cottage — so the shared/private
                                        // question is skipped for it and it goes straight to
                                        // its own length. A studio item keeps the normal
                                        // path (a class or a private session, its choice).
                                        <div role="radiogroup" aria-label={GUEST_SCREEN_COPY.menuLocationTitle} className="mx-auto w-full max-w-md space-y-3">
                                            {([
                                                ['collection', GUEST_SCREEN_COPY.slotWhereAtPlace, GUEST_SCREEN_COPY.slotWhereAtPlaceHint],
                                                ['delivery', GUEST_SCREEN_COPY.slotWhereTravel, GUEST_SCREEN_COPY.slotWhereTravelHint],
                                            ] as const).map(([f, label, hint]) => {
                                                const on = String(it.fulfilment) === f;
                                                return (
                                                    <button
                                                        key={f}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={on}
                                                        onClick={() => {
                                                            setField(menuIndex, 'fulfilment', f);
                                                            // A travelling item is always private.
                                                            if (f === 'delivery') setField(menuIndex, 'unit', 'flat');
                                                        }}
                                                        className={'flex w-full items-start gap-3 rounded-2xl border px-4 py-4 text-left transition '
                                                            + (on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-emerald-400')}
                                                    >
                                                        <span className={'mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border transition '
                                                            + (on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent')}>
                                                            <Check className="h-4 w-4" strokeWidth={3} />
                                                        </span>
                                                        <span>
                                                            <span className="block font-semibold text-slate-900">{label}</span>
                                                            <span className="block text-sm text-slate-500">{hint}</span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {stepKind === 'booked' && (
                                        // The per-item timed-or-not choice for a mixed
                                        // provider. A shared class is per-person and uses
                                        // the provider's session length; a one-at-a-time
                                        // booking is a whole session for one, with its own
                                        // length asked next. Switching to a class clears any
                                        // length it may have carried.
                                        <div role="radiogroup" aria-label={GUEST_SCREEN_COPY.menuBookedTitle} className="mx-auto w-full max-w-md space-y-3">
                                            {([
                                                ['person', GUEST_SCREEN_COPY.menuBookedSharedLabel, GUEST_SCREEN_COPY.menuBookedSharedHint],
                                                ['flat', GUEST_SCREEN_COPY.menuBookedPrivateLabel, GUEST_SCREEN_COPY.menuBookedPrivateHint],
                                            ] as const).map(([u, label, hint]) => {
                                                const on = String(it.unit) === u;
                                                return (
                                                    <button
                                                        key={u}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={on}
                                                        onClick={() => {
                                                            setField(menuIndex, 'unit', u);
                                                            if (u === 'person') setField(menuIndex, 'duration', '');
                                                        }}
                                                        className={'flex w-full items-start gap-3 rounded-2xl border px-4 py-4 text-left transition '
                                                            + (on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-emerald-400')}
                                                    >
                                                        <span className={'mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border transition '
                                                            + (on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent')}>
                                                            <Check className="h-4 w-4" strokeWidth={3} />
                                                        </span>
                                                        <span>
                                                            <span className="block font-semibold text-slate-900">{label}</span>
                                                            <span className="block text-sm text-slate-500">{hint}</span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {stepKind === 'duration' && (
                                        // The one added screen for the per-treatment
                                        // shape — the same NumberStepper the single
                                        // provider-length used, now per treatment, in
                                        // 15-minute steps. The guest sees this length;
                                        // the day reserves it (plus any reset gap).
                                        //
                                        // NOT solid: this is the one gated stepper — its
                                        // Next is disabled until a duration is set
                                        // (durationFilled). Greyed means the first press
                                        // of + or − adopts the shown 60 (staying, not
                                        // jumping to 75) and turns it solid, so accepting
                                        // the suggestion is one press, not a round trip.
                                        <div className="flex flex-col items-center">
                                            <NumberStepper
                                                value={it.duration || ''}
                                                onChange={(v: string) => setField(menuIndex, 'duration', v)}
                                                min={15} max={480} step={15} suggestion={60}
                                                size="lg" suffix=" min"
                                            />
                                            <p className="mt-4 text-center text-sm text-slate-500">How long a guest books this treatment for.</p>
                                        </div>
                                    )}
                                    {stepKind === 'price' && (
                                        <div>
                                            {/* A big numeral you TYPE into — no spinner
                                                arrows (nobody sets £45 by nudging up from
                                                zero) and no box; the number is the thing
                                                you see, the £ sits quietly at its baseline.
                                                Airbnb's price register. */}
                                            <div className="flex items-baseline justify-center gap-2">
                                                <span className="text-4xl font-extrabold text-slate-400 sm:text-5xl">£</span>
                                                <input
                                                    type="number" min="0" step="0.01" inputMode="decimal" value={it.price}
                                                    onChange={(e) => setField(menuIndex, 'price', e.target.value)}
                                                    placeholder={GUEST_SCREEN_COPY.menuPricePlaceholder}
                                                    aria-label={GUEST_SCREEN_COPY.menuPriceTitle}
                                                    className="w-48 bg-transparent text-center text-6xl font-extrabold tabular-nums text-slate-900 placeholder:font-extrabold placeholder:text-slate-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none sm:text-7xl"
                                                />
                                            </div>
                                            {/* Price type — the same options and the same
                                                model as before, but no native <select>: a
                                                current-choice HubRow that opens a sub-flow of
                                                selectable rows, matching the coverage picker.
                                                A private/shared slot derives it from the
                                                answer and just states the basis; a 'both' slot
                                                asks it on its own step next, so nothing here. */}
                                            <div className="mt-8">
                                                {isSlot ? (
                                                    slotBoth
                                                        ? null
                                                        : unitWord(it)
                                                            ? <p className="text-center text-sm text-slate-500">Priced {unitWord(it)}</p>
                                                            : null
                                                ) : (
                                                    <>
                                                        <div className="mx-auto max-w-sm">
                                                            <HubRow
                                                                filled
                                                                label={GUEST_SCREEN_COPY.menuPriceTypeLabel}
                                                                prompt=""
                                                                summary={UNIT_WORD[it.unit || 'flat']}
                                                                onOpen={() => setUnitPickerOpen(true)}
                                                            />
                                                        </div>
                                                        <SubFlowModal
                                                            open={unitPickerOpen}
                                                            title={GUEST_SCREEN_COPY.menuPriceTypeTitle}
                                                            onClose={() => setUnitPickerOpen(false)}
                                                            saveLabel={GUEST_SCREEN_COPY.save}
                                                        >
                                                            <div role="radiogroup" aria-label={GUEST_SCREEN_COPY.menuPriceTypeLabel} className="mx-auto w-full max-w-md space-y-2">
                                                                {ORDER_UNITS.map((u) => {
                                                                    const on = (it.unit || 'flat') === u;
                                                                    return (
                                                                        <button
                                                                            key={u}
                                                                            type="button"
                                                                            role="radio"
                                                                            aria-checked={on}
                                                                            onClick={() => { setField(menuIndex, 'unit', u); setUnitPickerOpen(false); }}
                                                                            className={'flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition '
                                                                                + (on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-emerald-400')}
                                                                        >
                                                                            <span className={'flex h-6 w-6 flex-none items-center justify-center rounded-full border transition '
                                                                                + (on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent')}>
                                                                                <Check className="h-4 w-4" strokeWidth={3} />
                                                                            </span>
                                                                            <span className="font-semibold text-slate-900">{UNIT_WORD[u]}</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </SubFlowModal>
                                                    </>
                                                )}
                                            </div>
                                            {/* The payout, presented the way Airbnb's is:
                                                a quiet "You keep £X" line, calm by default,
                                                the maths only when the chevron is tapped. */}
                                            {priceFilled && (
                                                <div className="mt-8 flex flex-col items-center">
                                                    <button type="button" onClick={() => setPayoutOpen((o) => !o)}
                                                        aria-expanded={payoutOpen}
                                                        className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-800">
                                                        {GUEST_SCREEN_COPY.payoutKeepLine} £{keep.toFixed(2)}
                                                        <ChevronDown className={'h-4 w-4 transition-transform ' + (payoutOpen ? 'rotate-180' : '')} />
                                                    </button>
                                                    {payoutOpen && (
                                                        <div className="mt-3 w-full max-w-xs rounded-2xl border border-slate-200 p-4 text-sm">
                                                            <div className="flex justify-between py-1">
                                                                <span className="text-slate-500">{GUEST_SCREEN_COPY.payoutRowPrice}</span>
                                                                <span className="text-slate-900">£{priceNum.toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between py-1">
                                                                <span className="text-slate-500">{GUEST_SCREEN_COPY.payoutRowCommission} ({Math.round(DEFAULT_SERVICE_COMMISSION * 100)}%)</span>
                                                                <span className="text-slate-900">−£{commission.toFixed(2)}</span>
                                                            </div>
                                                            <div className="mt-1 flex justify-between border-t border-slate-100 pt-2 font-semibold">
                                                                <span className="text-slate-900">{GUEST_SCREEN_COPY.payoutRowKeep}</span>
                                                                <span className="text-slate-900">£{keep.toFixed(2)}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {/* THE UNIT STEP — 'both' slots only. Session
                                        (a private hire, flat) or per person (a shared
                                        table). Selectable rows in the wizard's own
                                        register; a unit is always set, so there is no
                                        gate on this screen. */}
                                    {stepKind === 'unit' && (
                                        <div role="radiogroup" aria-label={GUEST_SCREEN_COPY.menuSlotUnitTitle} className="mx-auto w-full max-w-md space-y-3">
                                            {([
                                                ['flat', GUEST_SCREEN_COPY.menuSlotUnitFlat, GUEST_SCREEN_COPY.menuSlotUnitFlatHint],
                                                ['person', GUEST_SCREEN_COPY.menuSlotUnitPerson, GUEST_SCREEN_COPY.menuSlotUnitPersonHint],
                                            ] as const).map(([u, label, hint]) => {
                                                const on = String(it.unit) === u;
                                                return (
                                                    <button
                                                        key={u}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={on}
                                                        onClick={() => setField(menuIndex, 'unit', u)}
                                                        className={'flex w-full items-start gap-3 rounded-2xl border px-4 py-4 text-left transition '
                                                            + (on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-emerald-400')}
                                                    >
                                                        <span className={'mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border transition '
                                                            + (on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent')}>
                                                            <Check className="h-4 w-4" strokeWidth={3} />
                                                        </span>
                                                        <span>
                                                            <span className="block font-semibold text-slate-900">{label}</span>
                                                            <span className="block text-sm text-slate-500">{hint}</span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {stepKind === 'desc' && (
                                        <div className={fieldWrap}>
                                            <textarea
                                                value={it.description} rows={3}
                                                onChange={(e) => setField(menuIndex, 'description', e.target.value)}
                                                placeholder={GUEST_SCREEN_COPY.menuDescPlaceholder}
                                                className={bigArea}
                                            />
                                        </div>
                                    )}
                                    {stepKind === 'photo' && (
                                        <div className="flex flex-col items-center">
                                            <label className="relative flex h-40 w-40 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-center hover:border-emerald-400">
                                                {it.image ? (
                                                    <img src={getImageUrl(it.image)} alt="" className="h-full w-full object-cover" />
                                                ) : (
                                                    <>
                                                        <ImagePlus className="h-8 w-8 text-slate-400" strokeWidth={1.5} />
                                                        <span className="text-xs text-slate-500">{uploadingItem === menuIndex ? 'Uploading…' : 'Add photo'}</span>
                                                    </>
                                                )}
                                                <input type="file" accept="image/*" className="sr-only" onChange={(e) => uploadItemPhoto(menuIndex, e)} />
                                            </label>
                                        </div>
                                    )}
                                </SubFlowModal>
                            )}
                        </section>
                    );
                })()}

                {/* MADE-TO-ORDER: the notice period, on its own screen (g_notice)
                    before the delivery areas — a big centred stepper under the
                    question, like the years and guests screens. The heading is the
                    generic h1 (noticeQuestion). It's the same fact as the
                    made-to-order cancellation cutoff, still asked once. */}
                {onStep('g_notice') && audienceForTrade(trade) === 'guest' && (
                <section className="flex-1 flex flex-col items-center justify-center">
                    <NumberStepper value={leadTimeDays} onChange={setLeadTimeDays} min={0} max={90} suggestion={2} size="lg" solid suffix={GUEST_SCREEN_COPY.noticeSuffix} />
                </section>
                )}

                {/* SLOT: the private/shared answer (which sets the price unit and
                    the capacity), the session length, and the weekly opening hours
                    — the schedule editor a sauna owner needs and never had. §7/§10. */}
                {/* THE COME-TO-ME / TRAVEL FORK — slot, and only the three either-way
                    categories (yoga, massage, painting). It sets `fulfilment` the
                    way made-to-order's own fork does, so g_area then shows an
                    address or the coverage regions. The centred H1 asks the
                    question; here are the two cards. */}
                {/* THE BOOKING-SHAPE FORK — 'something else' only. Three cards in
                    what the provider sells; the pick sets shape (and a matching
                    fulfilment default) so everything after follows a real category
                    of that shape. Sits before g_area, which reads the shape. */}
                {onStep('g_shape') && isGuest && (
                <section className="mb-8 sm:mb-0 sm:flex-1 sm:flex sm:flex-col sm:justify-center md:max-w-xl md:mx-auto">
                    <div className="grid gap-3 sm:grid-cols-3">
                        {[
                            { v: 'slot', t: GUEST_SCREEN_COPY.shapeSlotLabel, d: GUEST_SCREEN_COPY.shapeSlotHint },
                            { v: 'made_to_order', t: GUEST_SCREEN_COPY.shapeMadeLabel, d: GUEST_SCREEN_COPY.shapeMadeHint },
                            { v: 'comes_to_you', t: GUEST_SCREEN_COPY.shapeTravelLabel, d: GUEST_SCREEN_COPY.shapeTravelHint },
                        ].map((o) => (
                            <ChoiceCard key={o.v} selected={shape === o.v} onSelect={() => pickShape(o.v)} title={o.t} hint={o.d} />
                        ))}
                    </div>
                </section>
                )}

                {onStep('g_slot_where') && isGuest && shape === 'slot' && (
                <section className="mb-8 sm:mb-0 sm:flex-1 sm:flex sm:flex-col sm:justify-center md:max-w-xl md:mx-auto">
                    <div className="grid gap-3 sm:grid-cols-3">
                        {[
                            { v: 'collection', t: GUEST_SCREEN_COPY.slotWhereAtPlace, d: GUEST_SCREEN_COPY.slotWhereAtPlaceHint },
                            { v: 'delivery', t: GUEST_SCREEN_COPY.slotWhereTravel, d: GUEST_SCREEN_COPY.slotWhereTravelHint },
                            // 'both' moves the location into each item's sub-flow.
                            { v: 'both', t: GUEST_SCREEN_COPY.slotWhereBoth, d: GUEST_SCREEN_COPY.slotWhereBothHint },
                        ].map((o) => (
                            <ChoiceCard key={o.v} selected={fulfilment === o.v} onSelect={() => setFulfilment(o.v)} title={o.t} hint={o.d} />
                        ))}
                    </div>
                </section>
                )}

                {/* THE WHEN SECTION (slots only), one question a screen. Session
                    length here; the weekly hours on the next screen. Split out of
                    the old overloaded g_area, whose heading promised a schedule
                    while the first control asked session length. */}
                {onStep('g_slot_length') && isGuest && shape === 'slot' && (
                <section className="flex-1 flex flex-col items-center justify-center">
                    <NumberStepper value={slotLength} onChange={setSlotLength} min={15} max={480} step={15} suggestion={60} size="lg" solid suffix={GUEST_SCREEN_COPY.slotLengthSuffix} />
                </section>
                )}


                {/* Who they are — a guest trade only. A guest is choosing
                    someone to come into the cottage they are staying in, so the
                    listing should carry a bit of the person and not only what
                    they charge. All of it is optional; a name is the one that
                    earns its place, the rest fill in trust. Deliberately no
                    vetting badges — nothing here is checked, so nothing claims
                    to be. */}
                {/* THE YEARS OPENER — one question, one number, nothing else, the
                    way Airbnb do it. The question is the centred H1 above; here is
                    just the big centred stepper with air around it. The short line
                    and the photo of the provider moved to the expertise screen
                    (g_creds), where the person's story belongs. Two rules: it goes
                    down to zero (a business started this year has none and we'd
                    still take them), and it shows a suggestion but stores nothing
                    until touched — the same rule as the where-and-when counts. */}
                {/* The years opener — shared by both flows now. A host trade opens
                    on this same counter, saved the same way (guest_details.
                    years_experience). */}
                {onStep('g_you') && (
                <section className="flex-1 flex flex-col items-center justify-center">
                    {/* NOT solid: the suggested 5 shows greyed as a placeholder, not
                        as a black already-answered value. The first press of + or −
                        adopts it and turns it black; Next stays greyed until then
                        (see the disabled logic in the footer). */}
                    <NumberStepper value={yearsDoing} onChange={setYearsDoing} min={0} max={70} suggestion={YEARS_DEFAULT} size="lg" />
                </section>
                )}

                {/* MAXIMUM GUESTS — one centred question, the big stepper, worded
                    by shape. Where the provider travels (comes_to_you) it's the
                    largest group they'll take; where guests come to them (slot)
                    it's what the space holds. For a shared slot this becomes
                    sellable seats, so the default is deliberately low. */}
                {/* THE PRICING BASIS — slot only, its own screen now. Private (the
                    whole session for one group, one flat booking) vs shared
                    (several people join, priced per person). It sets the price
                    unit g_menu reads and decides whether the minimum screen
                    exists. The centred H1 asks the question; here are the two
                    cards. */}
                {onStep('g_slot_basis') && isGuest && shape === 'slot' && (
                <section className="mb-8 sm:mb-0 sm:flex-1 sm:flex sm:flex-col sm:justify-center md:max-w-xl md:mx-auto">
                    <div className="grid gap-3 sm:grid-cols-3">
                        {([
                            { v: 'private', t: GUEST_SCREEN_COPY.slotBasisPrivateLabel, d: GUEST_SCREEN_COPY.slotBasisPrivateHint },
                            { v: 'shared', t: GUEST_SCREEN_COPY.slotBasisSharedLabel, d: GUEST_SCREEN_COPY.slotBasisSharedHint },
                            { v: 'both', t: GUEST_SCREEN_COPY.slotBasisBothLabel, d: GUEST_SCREEN_COPY.slotBasisBothHint },
                        ] as const).map((o) => (
                            <ChoiceCard key={o.v} selected={slotOffer === o.v} onSelect={() => applyOffer(o.v)} title={o.t} hint={o.d} />
                        ))}
                    </div>
                </section>
                )}

                {onStep('g_capacity') && isGuest && (
                <section className="flex-1 flex flex-col items-center justify-center">
                    <NumberStepper value={maxGuests} onChange={setMaxGuests} min={1} max={60} suggestion={shape === 'comes_to_you' ? CAPACITY_DEFAULT_TRAVEL : CAPACITY_DEFAULT_SLOT} size="lg" solid suffix={GUEST_SCREEN_COPY.capacitySuffix} />
                </section>
                )}

                {/* THE PER-PERSON MINIMUM — shared slots only. The smallest group
                    a single booking may be, a big stepper like guests/years. The
                    ceiling (g_capacity) is the max above it, so the stepper caps
                    there; default 1 = no minimum. The route is the real gate —
                    this is the convenience floor. */}
                {onStep('g_slot_min') && isGuest && shape === 'slot' && (offeringHasShared(slotOffer) || slotMixedComeToMe) && (
                <section className="flex-1 flex flex-col items-center justify-center">
                    <NumberStepper value={slotMinPeople} onChange={setSlotMinPeople} min={1} max={Math.max(1, parseInt(maxGuests, 10) || CAPACITY_DEFAULT_SLOT)} suggestion={1} size="lg" solid suffix={GUEST_SCREEN_COPY.slotMinSuffix} />
                </section>
                )}

                {/* THE LISTING'S NAME — what the experience is called. The h1 a
                    guest reads, written to business_name. One centred field, like
                    the years/guests openers; the professional title (a credential)
                    is asked separately on g_creds and shows in the About block. */}
                {onStep('g_title') && isGuest && (
                    <section className="mb-8 md:max-w-xl md:mx-auto">
                        <p className="-mt-6 mb-10 text-center text-sm text-slate-500 [text-wrap:balance]">
                            {GUEST_SCREEN_COPY.experienceTitleSubtext}
                        </p>
                        <div className="relative border-b border-slate-200 pb-2 transition-colors focus-within:border-slate-400">
                            <input
                                type="text"
                                value={listingTitle}
                                onChange={(e) => setListingTitle(e.target.value.slice(0, 60))}
                                placeholder={GUEST_SCREEN_COPY.experienceTitlePlaceholder}
                                className="w-full bg-transparent pr-12 text-center text-2xl text-slate-900 placeholder:text-slate-300 focus:outline-none"
                                autoFocus
                            />
                            <span className="pointer-events-none absolute bottom-1 right-0 text-xs text-slate-400">{listingTitle.length}/60</span>
                        </div>
                    </section>
                )}

                {/* WHAT A GUEST CAN EXPECT — rebuilt to the flow's own craft: no
                    stacked bordered textareas. A hub of borderless rows, each
                    opening a one-field sub-flow (the same pattern as the expertise
                    and price screens). Two questions survive: "What happens" (now
                    DISPLAYED on the listing) and, for a food category, dietary
                    (also displayed). "What's included" and "What a guest brings"
                    were cut — the item description and price already carry them.
                    All optional; none blocks a booking. */}
                {onStep('g_expect') && isGuest && (() => {
                    const fieldWrap = 'relative border-b border-slate-200 pb-2 transition-colors focus-within:border-slate-400';
                    const bigArea = 'w-full resize-none bg-transparent text-center text-xl leading-relaxed text-slate-900 placeholder:text-slate-300 focus:outline-none';
                    const isFoodCat = guestCategoryIsFood(guestCategory);
                    const toggleDietary = (k: string) => setDietaryOptions((prev) =>
                        prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
                    // The row reads back the ticks (in catalogue order) and flags a
                    // note; either alone counts as filled. A blank row still prompts.
                    const dietaryLabels = DIETARY_OPTIONS.filter((o) => dietaryOptions.includes(o.key)).map((o) => o.label);
                    const dietarySummary = dietaryLabels.length
                        ? dietaryLabels.join(', ') + (dietaryNote.trim() ? ' · note added' : '')
                        : dietaryNote.trim();
                    const dietaryFilled = dietaryLabels.length > 0 || dietaryNote.trim() !== '';
                    return (
                    <section className="mb-8 md:max-w-xl md:mx-auto">
                        <div className="mt-6 space-y-6">
                            <HubRow
                                filled={whatToExpect.trim() !== ''}
                                label={GUEST_SCREEN_COPY.expectRowLabel}
                                suffix={GUEST_SCREEN_COPY.optionalSuffix}
                                prompt={GUEST_SCREEN_COPY.expectRowPrompt}
                                summary={whatToExpect.trim()}
                                onOpen={() => setDetailModal('expect')}
                            />
                            {isFoodCat && (
                                <HubRow
                                    filled={dietaryFilled}
                                    label={GUEST_SCREEN_COPY.dietaryRowLabel}
                                    suffix={GUEST_SCREEN_COPY.optionalSuffix}
                                    prompt={GUEST_SCREEN_COPY.dietaryRowPrompt}
                                    summary={dietarySummary}
                                    onOpen={() => setDetailModal('dietary')}
                                />
                            )}
                        </div>

                        {/* ---- What happens: one borderless field. ---- */}
                        <SubFlowModal
                            open={detailModal === 'expect'}
                            title={GUEST_SCREEN_COPY.expectModalTitle}
                            onClose={() => setDetailModal(null)}
                            saveLabel={GUEST_SCREEN_COPY.save}
                        >
                            <div className={fieldWrap}>
                                <textarea
                                    value={whatToExpect}
                                    onChange={(e) => setWhatToExpect(e.target.value)}
                                    rows={4}
                                    placeholder={GUEST_SCREEN_COPY.expectExamples[guestCategory] ?? GUEST_SCREEN_COPY.expectExampleFallback}
                                    className={bigArea}
                                />
                            </div>
                        </SubFlowModal>

                        {/* ---- Dietary (food only): tick what you CAN CATER FOR —
                            a capability, not a promise — with the note always
                            visible beneath, since a chef who caters for none of
                            the listed options still needs somewhere to say what she
                            can do, and that caveat is the one that matters most. ---- */}
                        {isFoodCat && (
                            <SubFlowModal
                                open={detailModal === 'dietary'}
                                title={GUEST_SCREEN_COPY.dietaryModalTitle}
                                onClose={() => setDetailModal(null)}
                                saveLabel={GUEST_SCREEN_COPY.save}
                                note={GUEST_SCREEN_COPY.dietaryModalNote}
                            >
                                <div className="mx-auto w-full max-w-md">
                                    <div role="group" aria-label={GUEST_SCREEN_COPY.dietaryModalTitle} className="space-y-2">
                                        {DIETARY_OPTIONS.map((o) => {
                                            const on = dietaryOptions.includes(o.key);
                                            return (
                                                <button
                                                    key={o.key}
                                                    type="button"
                                                    onClick={() => toggleDietary(o.key)}
                                                    aria-pressed={on}
                                                    className={'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition '
                                                        + (on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-emerald-400')}
                                                >
                                                    <span className={'flex h-6 w-6 flex-none items-center justify-center rounded-md border transition '
                                                        + (on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent')}>
                                                        <Check className="h-4 w-4" strokeWidth={3} />
                                                    </span>
                                                    <span className="font-medium text-slate-900">{o.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {/* The note — always visible, never revealed by a
                                        tick. The ticks are the shape; this is the honesty. */}
                                    <div className="mt-6">
                                        <label className="mb-2 block text-xs font-medium text-slate-500">{GUEST_SCREEN_COPY.dietaryNoteLabel}</label>
                                        <textarea
                                            value={dietaryNote}
                                            onChange={(e) => setDietaryNote(e.target.value)}
                                            rows={3}
                                            placeholder={GUEST_SCREEN_COPY.dietaryPlaceholder}
                                            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                                        />
                                    </div>
                                </div>
                            </SubFlowModal>
                        )}
                    </section>
                    );
                })()}

                {/* PHOTOS — a real, required step, the way Airbnb makes it (they
                    ask for five; we ask for at least one, gated in the footer). A
                    listing without a photo doesn't sell, and until now guest photos
                    were only ever the per-item pictures. These append to `photos`,
                    which already saves, loads and feeds the listing. */}
                {onStep('g_photos') && isGuest && (
                <section className="mb-8">
                    {/* The screen instruction sits under the heading in both states
                        — it asks for three; the Next gate stays at one (they differ
                        on purpose), so this line is NOT wired to the gate. */}
                    <p className="text-center text-base text-slate-600">
                        {GUEST_SCREEN_COPY.photosAsk}
                    </p>

                    {photos.length === 0 ? (
                        <>
                            {/* Empty-state invitation: the two stock photographs as an
                                overlapping, opposing-tilt pair (see EXPERIENCE_PHOTOS),
                                then the Add button close beneath. Only the invitation —
                                the moment a provider adds their own, the pair gives way
                                to the editable grid below (stock photos should not sit
                                alongside someone's own).

                                The composition (size, ±5° tilt, overlap, stagger,
                                outlined button) is the agreed commit-90a3c20 version,
                                reduced ~10–15% via PHOTO_CARD_SIZE. This screen is
                                CENTRED (justify-center) to match Airbnb — the eyebrow,
                                heading, subtitle, photos and button share one axis. The
                                anti-slide fix is kept: the panel centres in the full
                                body width (the right-side spacer mirrors the rail), so
                                the centre axis is the viewport centre in both rail
                                states. overflow-visible so the tilt/shadow never clip.
                                Do not adjust the composition again unless asked. */}
                            <div className="mt-16 mb-6 flex justify-center overflow-visible">
                                <div className="relative flex items-center">
                                    <img
                                        src={EXPERIENCE_PHOTOS[0].src}
                                        alt={EXPERIENCE_PHOTOS[0].alt}
                                        className={PHOTO_CARD_SIZE + ' aspect-[4/5] object-cover rounded-2xl bg-slate-100 ring-4 ring-white shadow-xl -rotate-5'}
                                    />
                                    <img
                                        src={EXPERIENCE_PHOTOS[1].src}
                                        alt={EXPERIENCE_PHOTOS[1].alt}
                                        className={'-ml-8 sm:-ml-12 translate-y-3 ' + PHOTO_CARD_SIZE + ' aspect-[4/5] object-cover rounded-2xl bg-slate-100 ring-4 ring-white shadow-xl rotate-5'}
                                    />
                                </div>
                            </div>

                            <div className="flex justify-center">
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-900 bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                                    <ImagePlus className="h-5 w-5" strokeWidth={1.75} />
                                    <span>{uploadingPhotos ? 'Uploading…' : 'Add photos'}</span>
                                    <input type="file" accept="image/*" multiple className="sr-only"
                                        onChange={uploadGalleryPhotos} disabled={uploadingPhotos} />
                                </label>
                            </div>
                        </>
                    ) : (
                        // Their own photos: the shared editor grid (drag to reorder
                        // on mouse/touch/keyboard, delete, add). Immediate upload is
                        // kept — photos are already stored paths — so the callbacks
                        // just reorder/trim the array. The cover is the first photo,
                        // set by dragging to the front; no separate control.
                        <div className="mt-6">
                            <PhotoEditorGrid
                                items={photos.map((p) => ({ key: p, src: getImageUrl(p) }))}
                                onReorder={(from, to) => setPhotos((prev) => {
                                    const next = [...prev];
                                    const [moved] = next.splice(from, 1);
                                    next.splice(to, 0, moved);
                                    return next;
                                })}
                                onRemove={(i) => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                                onAdd={uploadGalleryPhotos}
                                uploading={uploadingPhotos}
                                instruction={GUEST_SCREEN_COPY.photosReorderHint}
                            />
                        </div>
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
                {/* What you charge — one shape for every trade. Tick "I provide
                    a quote", or give an hourly rate or a flat fee; a call-out fee
                    is optional on top. A row is valid with a quote, an hourly rate
                    or a flat fee. No bedroom or plot-size bands any more.

                    Window cleaning is the one exception: a window cleaner quotes
                    the job (the price turns on the property, which the bands used
                    to stand in for), so it shows only the quote tick and an
                    optional call-out fee — no hourly rate or flat fee. */}
                {onStep('prices') && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">What you charge</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            {trade === 'droplet'
                                ? <>Tick &ldquo;I provide a quote&rdquo;. Add a call-out fee if you charge one.</>
                                : <>Tick &ldquo;I provide a quote&rdquo;, or give an hourly rate or a flat fee. Add a call-out fee if you charge one.</>}
                        </p>

                        <label className="flex items-start gap-2.5 mb-5 text-sm text-slate-800">
                            <input
                                type="checkbox"
                                checked={provideQuote}
                                onChange={(e) => setProvideQuote(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                            />
                            <span>
                                <span className="font-semibold">I provide a quote</span>
                                <span className="block text-slate-500">You&apos;ll price the job after a look, so there&apos;s no set price up front.</span>
                            </span>
                        </label>

                        <div className="grid sm:grid-cols-2 gap-4 md:max-w-xl">
                            {trade !== 'droplet' && (
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1">
                                    Hourly rate <span className="font-normal text-slate-400">(optional)</span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">&pound;</span>
                                    <input type="text" inputMode="decimal" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                                </div>
                                {problemFor('hourly_rate') && (
                                    <p data-problem className="text-xs text-rose-700 mt-1">{problemFor('hourly_rate')!.message}</p>
                                )}
                            </div>
                            )}
                            {trade !== 'droplet' && (
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1">
                                    Flat fee <span className="font-normal text-slate-400">(optional)</span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">&pound;</span>
                                    <input type="text" inputMode="decimal" value={flatFee} onChange={(e) => setFlatFee(e.target.value)}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                                </div>
                                {problemFor('flat_fee') && (
                                    <p data-problem className="text-xs text-rose-700 mt-1">{problemFor('flat_fee')!.message}</p>
                                )}
                            </div>
                            )}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1">
                                    Call-out fee <span className="font-normal text-slate-400">(optional)</span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">&pound;</span>
                                    <input type="text" inputMode="decimal" value={calloutFee} onChange={(e) => setCalloutFee(e.target.value)}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                                </div>
                                {problemFor('callout_fee') && (
                                    <p data-problem className="text-xs text-rose-700 mt-1">{problemFor('callout_fee')!.message}</p>
                                )}
                                {calloutFee.trim() !== '' && (
                                    <label className="flex items-start gap-2.5 mt-2.5 text-sm text-slate-800">
                                        <input type="checkbox" checked={calloutWaived} onChange={(e) => setCalloutWaived(e.target.checked)}
                                            className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0" />
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
                        </div>

                        {problemFor('prices') && (
                            <p data-problem className="text-sm text-rose-700 mt-3">
                                {trade === 'droplet'
                                    ? 'Tick “I provide a quote”.'
                                    : problemFor('prices')!.message}
                            </p>
                        )}
                    </section>
                )}

                {/* Registration — one optional free-text number, no scheme name.
                    Shown only for the trades a number means something for
                    (electricians and plumbers/gas engineers). Never required: an
                    applicant who hasn't got theirs to hand can still finish, and
                    if they enter it hosts see it on the profile. The old "we check
                    this before you go live" line is gone — it read as a gate the
                    field never was. */}
                {onStep('credentials') && (asksAboutFuel(trade) || trade === 'electrician') && (
                    <section className="mb-8">
                        <label htmlFor="reg-number" className="block text-sm font-semibold text-slate-900 mb-1.5">
                            Registration number <span className="font-normal text-slate-400">(optional)</span>
                        </label>
                        <input
                            id="reg-number"
                            type="text"
                            value={registrationNumber}
                            onChange={(e) => setRegistrationNumber(e.target.value)}
                            className="w-full sm:w-72 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                        <p className="text-xs text-slate-500 mt-2">
                            If you add it, hosts can see it on your profile.
                        </p>
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
                {/* The pre-filled per-trade capability checklist has been
                    replaced by the search below, which every trade now gets. */}

                {/* Skills sit UNDER the tick boxes above, not over them.
                    The standard set is the common case for every handyman;
                    the tags are the extra, for the jobs that do not fit a
                    box. Asking the open question first put the unusual
                    thing before the usual one. */}
                {onStep('credentials') && hasSkills && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">
                            What services do you cover?
                        </h2>
                        <p className="text-sm text-slate-500 mb-1.5">
                            The jobs you take on. Start typing and pick from the list, or add your own if
                            it isn&apos;t there.
                        </p>
                        {/* Not small print. "Pick from the list" is the whole
                            anti-fragmentation mechanism: somebody offered
                            "gutter cleaning" takes it, and somebody who reads past
                            this types "gutters" and splits the tag. It is
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
                                        className="inline-flex items-center gap-1.5 rounded-full pl-3 pr-1.5 py-1 text-sm border border-slate-300 bg-slate-50 text-slate-900"
                                    >
                                        {label}
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

                        {/* Search-only: the list appears once something is typed
                            and shows the existing services that match — no
                            browse-everything list on focus, no "Show all". A word
                            that matches nothing offers "add your own" below. */}
                        {skillsListOpen && skillTyped.trim() !== '' && (
                            <div className="mt-3 md:max-w-sm">
                                {tagsToShow.length > 0 && (
                                    <>
                                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                            Matching
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

                                {/* The fallback, for the job that genuinely is not
                                    on the list. Offered ONLY when nothing matched —
                                    when there are matches, taking one of them is the
                                    only offer, so somebody can't split "Electrical
                                    testing" by adding "Eicr" as their own past a list
                                    that already had it. */}
                                {skillIsNew && tagsToShow.length === 0 && skillTyped.trim() !== '' && (
                                    <button
                                        type="button"
                                        onClick={() => addSkill(skillTyped)}
                                        className="block w-full text-left rounded-lg px-3 py-2 text-sm text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                                    >
                                        Add &ldquo;{(skillKey(skillTyped) || { label: skillTyped }).label}&rdquo; as a new one
                                    </button>
                                )}

                                {/* Typed something that matches nothing and isn't a
                                    new tag either (an alias of one already held). */}
                                {tagsToShow.length === 0 && !skillIsNew && skillTyped.trim() !== '' && (
                                    <p className="text-sm text-slate-500">
                                        Nothing matches that.
                                    </p>
                                )}
                            </div>
                        )}

                        {/* No "will not show" warning and nothing about Part P or
                            competent-person schemes: we don't police what a trade
                            lists. They pick the services they do; the search offers
                            every matching one (regulated or not), and the listing
                            shows what they chose. */}
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
                                                                    {entry.quote ? (
                                                                        <span className="text-sm text-slate-500">Priced by quote</span>
                                                                    ) : (
                                                                        <>
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
                                                                                <span className="text-sm text-slate-500 whitespace-nowrap">per job</span>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {/* Each extra can be priced by quote instead of a set figure. */}
                                                            <label className="mt-1.5 ml-0 flex items-center gap-2 text-xs text-slate-600">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={!!entry.quote}
                                                                    onChange={(e) => setExtra(extra.key, 'quote', e.target.checked)}
                                                                    className="w-3.5 h-3.5 rounded border-slate-300"
                                                                />
                                                                I provide a quote for this
                                                            </label>
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


                {(audienceForTrade(trade) === 'guest' ? onStep('g_area') : onStep('b_area')) && (
                <section className={'mb-8'
                    /* Vertically centre the fork (and whatever it reveals below it)
                       in the space between the question and the footer on desktop.
                       No items-center: the cards and pickers keep their left edge
                       and their max width. Mobile is untouched. */
                    + (guestMtoArea ? ' sm:flex-1 sm:flex sm:flex-col sm:justify-center' : '')}>
                    {/* HOST TRADES keep the town-and-radius model — the radius is a
                        live precision filter behind the directory, and five regions
                        would be too coarse for it — but it's captured in the guest
                        flow's craft now: borderless rows, an add row, a sub-flow
                        modal that picks a town from the known list and a radius.
                        Restricting to the known list also fixes the old free-text
                        trap where an off-list town got centre 0,0 and never matched
                        the directory. The data model is unchanged, so existing rows
                        load and re-save exactly as before. */}
                    {!isGuest && (
                        <>
                            {/* Host trades now pick coverage as REGIONS — the same
                                model as the guest experience sign-up ("All of
                                Dumfries and Galloway" or a named region), pick as
                                many as they like. The single town-and-radius picker
                                is gone. Stored the same way as the guest regions:
                                the region label in service_areas with radius 0. */}
                            {/* The "Where do you cover?" heading is the step h1
                                above now (its own screen), so this is just the
                                one-line hint under it. */}
                            <p className="text-sm text-slate-500 mb-4 -mt-4">Pick the areas you work in — as many as you like.</p>

                            <div className="space-y-1 md:max-w-xl">
                                {areas.map((a, i) => (
                                    <HubRow key={i} filled label={a.town} prompt="" summary={regionHintFor(a.town)} onOpen={() => setAreaPickerOpen(true)} />
                                ))}
                                {!areasHasAll && (
                                    <HubRow filled={false} label="Add an area" prompt="Pick the regions you cover" onOpen={() => setAreaPickerOpen(true)} />
                                )}
                            </div>

                            {problemFor('areas') && (
                                <p data-problem className="text-sm text-rose-700 mt-3">{problemFor('areas')!.message}</p>
                            )}

                            <SubFlowModal
                                open={areaPickerOpen}
                                title="Where do you cover?"
                                onClose={() => setAreaPickerOpen(false)}
                                saveLabel={GUEST_SCREEN_COPY.locationPickerDone}
                                saveDisabled={areas.length === 0}
                            >
                                <div className="mx-auto w-full max-w-md space-y-2">
                                    {GUEST_REGIONS.map((r) => {
                                        const on = regionPicked(r.label);
                                        return (
                                            <button key={r.key} type="button" onClick={() => toggleRegion(r)} aria-pressed={on}
                                                className={'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition '
                                                    + (on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-emerald-400')}>
                                                <span className={'flex h-6 w-6 flex-none items-center justify-center rounded-md border transition '
                                                    + (on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent')}>
                                                    <Check className="h-4 w-4" strokeWidth={3} />
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block font-semibold text-slate-900">{r.label}</span>
                                                    <span className="block text-sm text-slate-500">{r.hint}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </SubFlowModal>
                        </>
                    )}

                    {/* GUEST providers pick regions from a fixed list — no radii,
                        no free text, no spelling drift. Coverage is informational
                        now, so this is a signal on the listing rather than a
                        filter. Built in the flow's own craft: each chosen region a
                        quiet borderless row, an add row at the bottom, both opening
                        the same tick-list picker. The slot and made-to-order shapes
                        carry their real "when" (schedule, notice) in their own
                        blocks above; this screen is only the where. */}
                    {isGuest && (() => {
                        // Made-to-order and slot both drive the location off the
                        // fulfilment field now: collection = an address guests come
                        // to, delivery = the host travels (coverage regions). A
                        // comes-to-you traveller always shows regions. So: regions
                        // when a fulfilment provider delivers/travels OR when the
                        // shape is comes-to-you; the address when it collects.
                        const usesFulfilment = shape === 'made_to_order' || shape === 'slot';
                        const collects = fulfilment === 'collection' || fulfilment === 'both';
                        const delivers = fulfilment === 'delivery' || fulfilment === 'both';
                        const showRegions = usesFulfilment ? delivers : true;
                        const showCollection = usesFulfilment && collects;
                        // A 'both' slot shows the two together — the only screen in
                        // the wizard with two answers. Each gets its own sub-heading
                        // and a gap so it reads as two questions, not one form.
                        const bothPlaces = showRegions && showCollection;
                        // Slot copy forks on premises vs meeting point (outdoors,
                        // water) — data identical, wording only.
                        const slotMeeting = shape === 'slot' && slotIsMeetingPoint(guestCategory);
                        // The manual boxes are hidden behind the lookup until they're
                        // wanted: the provider asks to type it by hand, a lookup fills
                        // or fails, or a returning provider already has an address.
                        // Otherwise the screen is just the lookup. The Next gate still
                        // fires in the footer (submitProblems), so an empty required
                        // address is not silently allowed — it just doesn't force the
                        // boxes open before they've chosen how to enter it.
                        const showCollectionFields = collectionManual
                            || collectionStreet.trim() !== ''
                            || collectionTown.trim() !== ''
                            || collectionPostcode.trim() !== '';
                        const forkOptions: [string, string, string][] = [
                            ['delivery', GUEST_SCREEN_COPY.fulfilmentDelivery, GUEST_SCREEN_COPY.fulfilmentDeliveryHint],
                            ['collection', GUEST_SCREEN_COPY.fulfilmentCollection, GUEST_SCREEN_COPY.fulfilmentCollectionHint],
                            ['both', GUEST_SCREEN_COPY.fulfilmentBoth, GUEST_SCREEN_COPY.fulfilmentBothHint],
                        ];
                        return (
                        <>
                            {/* MADE-TO-ORDER: the fulfilment fork. Delivery reveals the
                                region picker; collection reveals a private address;
                                both reveals both. The shared mechanism massage adopts
                                next — kept separate from `shape`. */}
                            {shape === 'made_to_order' && (
                                <div role="radiogroup" aria-label={GUEST_SCREEN_COPY.fulfilmentHeading}
                                    className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:max-w-xl">
                                    {/* Large cards — the shared ChoiceCard, in radiogroup
                                        mode. The only options on the screen, so they use the
                                        space: side by side on a wide screen, tall-but-fitting
                                        stacked on a phone. */}
                                    {forkOptions.map(([val, label, hint]) => (
                                        <ChoiceCard key={val} radio selected={fulfilment === val}
                                            onSelect={() => setFulfilment(val)} title={label} hint={hint} />
                                    ))}
                                </div>
                            )}

                            {/* Coverage regions — shown when the provider travels: a
                                comes-to-you chef, a made-to-order that delivers, or a
                                slot host who goes to the guest's cottage. A slot at a
                                fixed place shows the address block below instead, not
                                this. */}
                            {showRegions && (
                                <div className={shape === 'made_to_order' ? 'mt-8' : ''}>
                                    {shape === 'made_to_order' ? (
                                        <label className="block text-xs font-medium text-slate-500 mb-3">{GUEST_SCREEN_COPY.locationHeadingDeliver}</label>
                                    ) : (
                                        <>
                                            {bothPlaces && (
                                                <h2 className="text-lg font-semibold text-slate-900 mb-1">{GUEST_SCREEN_COPY.slotBothAreasHeading}</h2>
                                            )}
                                            <p className="text-sm text-slate-500 mb-4 md:max-w-xl">{GUEST_SCREEN_COPY.locationSubtextTravel}</p>
                                        </>
                                    )}

                                    <div className="space-y-1 md:max-w-xl">
                                        {areas.map((a, i) => (
                                            <HubRow key={i} filled label={a.town} prompt="" summary={regionHintFor(a.town)} onOpen={() => setAreaPickerOpen(true)} />
                                        ))}
                                        {!areasHasAll && (
                                            <HubRow filled={false} label={GUEST_SCREEN_COPY.locationAddRow}
                                                prompt={shape === 'made_to_order' ? GUEST_SCREEN_COPY.locationAddPromptDeliver : GUEST_SCREEN_COPY.locationAddPrompt}
                                                onOpen={() => setAreaPickerOpen(true)} />
                                        )}
                                    </div>

                                    {problemFor('areas') && (
                                        <p data-problem className="text-sm text-rose-700 mt-3">{GUEST_SCREEN_COPY.locationAreaGate}</p>
                                    )}
                                </div>
                            )}

                            {/* Collection address — three fields, not one blob, so
                                the town can drive the public based_line while the
                                street and postcode stay private, released only on a
                                confirmed order (see the order page). Optional
                                postcode lookup on top; manual entry always works. */}
                            {showCollection && (
                                <div className={(bothPlaces ? 'mt-12' : 'mt-8') + ' md:max-w-xl'}>
                                    {bothPlaces ? (
                                        // The second answer on the 'both' screen: its own
                                        // heading and subtext, matching the areas block, with
                                        // a wider gap above so the two don't run together.
                                        <>
                                            <h2 className="text-lg font-semibold text-slate-900 mb-1">{GUEST_SCREEN_COPY.slotBothAddressHeading}</h2>
                                            <p className="text-sm text-slate-500 mb-4">{GUEST_SCREEN_COPY.slotBothAddressSubtext}</p>
                                        </>
                                    ) : (
                                        <span className="block text-xs font-medium text-slate-500 mb-2">{
                                            shape === 'slot'
                                                ? (slotMeeting ? GUEST_SCREEN_COPY.slotAddressLabelMeeting : GUEST_SCREEN_COPY.slotAddressLabelPremises)
                                                : GUEST_SCREEN_COPY.collectionAddressLabel
                                        }</span>
                                    )}

                                    {showCollectionFields ? (
                                        // FIELDS MODE — a chosen or hand-typed address. The
                                        // lookup is collapsed away (no duplicate postcode, no
                                        // fourth box); a "Search again" link reopens it.
                                        <>
                                            <div className="space-y-3">
                                                <div>
                                                    <label htmlFor="collection-street" className="block text-xs font-medium text-slate-500 mb-1">{GUEST_SCREEN_COPY.collectionStreetLabel}</label>
                                                    <input id="collection-street" type="text"
                                                        value={collectionStreet}
                                                        onChange={(e) => setCollectionStreet(e.target.value)}
                                                        placeholder={GUEST_SCREEN_COPY.collectionStreetPlaceholder}
                                                        className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                                                </div>
                                                <div className="flex gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <label htmlFor="collection-town" className="block text-xs font-medium text-slate-500 mb-1">{GUEST_SCREEN_COPY.collectionTownLabel}</label>
                                                        <input id="collection-town" type="text"
                                                            value={collectionTown}
                                                            onChange={(e) => setCollectionTown(e.target.value)}
                                                            placeholder={GUEST_SCREEN_COPY.collectionTownPlaceholder}
                                                            className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                                                    </div>
                                                    <div className="w-36 flex-none">
                                                        <label htmlFor="collection-postcode" className="block text-xs font-medium text-slate-500 mb-1">{GUEST_SCREEN_COPY.collectionPostcodeLabel}</label>
                                                        <input id="collection-postcode" type="text"
                                                            value={collectionPostcode}
                                                            onChange={(e) => setCollectionPostcode(e.target.value)}
                                                            placeholder={GUEST_SCREEN_COPY.collectionPostcodePlaceholder}
                                                            className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-2 flex items-start justify-between gap-3">
                                                <p className="text-xs text-slate-500">{GUEST_SCREEN_COPY.collectionAddressHint}</p>
                                                <button type="button" onClick={searchCollectionAgain}
                                                    className="flex-none text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800">
                                                    {GUEST_SCREEN_COPY.collectionSearchAgain}
                                                </button>
                                            </div>
                                            {problemFor('collection_address') && (
                                                <p data-problem className="text-sm text-rose-700 mt-2">{problemFor('collection_address')!.message}</p>
                                            )}
                                        </>
                                    ) : (
                                        // LOOKUP MODE — search as you type (debounced, ≥3
                                        // chars, no button); pick fills the fields above.
                                        // "Enter it by hand" is the escape if it can't help.
                                        <>
                                            <input
                                                type="text"
                                                value={collectionLookupQuery}
                                                onChange={(e) => setCollectionLookupQuery(e.target.value)}
                                                placeholder={GUEST_SCREEN_COPY.collectionLookupPrompt}
                                                autoComplete="off"
                                                className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                                            {collectionLookupBusy && collectionLookupResults.length === 0 && (
                                                <p className="mt-2 text-xs text-slate-400">Searching…</p>
                                            )}
                                            {collectionLookupResults.length > 0 && (
                                                // A count under the box says how many there are, since
                                                // a scrollbar — even one that stays visible — is easy to
                                                // miss. "16 addresses" makes the length explicit.
                                                <p className="mt-2 text-xs text-slate-400">
                                                    {collectionLookupResults.length} {collectionLookupResults.length === 1 ? 'address' : 'addresses'}
                                                </p>
                                            )}
                                            {collectionLookupResults.length > 0 && (
                                                <div className="relative mt-1">
                                                    <ul ref={collectionListRef} onScroll={updateCollectionMoreBelow}
                                                        style={collectionListMaxH ? { maxHeight: collectionListMaxH } : undefined}
                                                        className="scroll-always max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 divide-y divide-slate-100">
                                                        {collectionLookupResults.map((s) => (
                                                            <li key={s.id}>
                                                                <button type="button" onClick={() => pickCollectionSuggestion(s.id)}
                                                                    className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-emerald-50">
                                                                    {s.label}
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                    {/* A soft fade over the bottom edge while more of the
                                                        list is below — a scroll cue that doesn't rely on the
                                                        browser drawing (or keeping) the scrollbar. */}
                                                    <div aria-hidden hidden={!collectionMoreBelow}
                                                        className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-xl bg-gradient-to-t from-white to-transparent" />
                                                </div>
                                            )}
                                            {collectionLookupError && (
                                                <p className="mt-2 text-xs text-slate-500">{collectionLookupError}</p>
                                            )}
                                            <button type="button" onClick={() => setCollectionManual(true)}
                                                className="mt-3 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800">
                                                {GUEST_SCREEN_COPY.collectionManualLink}
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* The region picker modal — only when regions can show. */}
                            {showRegions && (
                                <SubFlowModal
                                    open={areaPickerOpen}
                                    title={shape === 'made_to_order' ? GUEST_SCREEN_COPY.locationPickerTitleDeliver : GUEST_SCREEN_COPY.locationPickerTitle}
                                    onClose={() => setAreaPickerOpen(false)}
                                    saveLabel={GUEST_SCREEN_COPY.locationPickerDone}
                                    saveDisabled={areas.length === 0}
                                >
                                    <div className="mx-auto w-full max-w-md space-y-2">
                                        {GUEST_REGIONS.map((r) => {
                                            const on = regionPicked(r.label);
                                            return (
                                                <button key={r.key} type="button" onClick={() => toggleRegion(r)} aria-pressed={on}
                                                    className={'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition '
                                                        + (on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-emerald-400')}>
                                                    <span className={'flex h-6 w-6 flex-none items-center justify-center rounded-md border transition '
                                                        + (on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent')}>
                                                        <Check className="h-4 w-4" strokeWidth={3} />
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block font-semibold text-slate-900">{r.label}</span>
                                                        <span className="block text-sm text-slate-500">{r.key === GUEST_COVERAGE_ALL_KEY ? allRegionHint : r.hint}</span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </SubFlowModal>
                            )}
                        </>
                        );
                    })()}
                </section>
                )}

                {/* Host/trade contact details (email/phone) are their own screen
                    now — b_contact, the last of the three "Your business" screens.
                    A guest experience has no contact step: they
                    signed in up front, so the account address is their contact
                    address (written from the session at submit), the phone lives
                    on their account profile, and the single responsibility
                    confirmation that replaced the old checks is folded onto the
                    finish screen below. So this section is host/trade only. */}
                {audienceForTrade(trade) !== 'guest' && onStep('b_contact') && (
                <section className="mb-8 grid sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-2">
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
                        <label className="block text-xs font-medium text-slate-500 mb-2">
                            Phone <span className="text-slate-400">(optional)</span>
                        </label>
                        <input
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />

                        {/* One short line, not a policy paragraph. The opt-out sits
                            with it so a mobile number isn't removed to avoid texts. */}
                        <p className="text-sm text-slate-500 mt-2">
                            A mobile only gets a text for an owner’s emergency; everything else is email.
                        </p>

                        <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={smsOptOut}
                                onChange={(e) => setSmsOptOut(e.target.checked)}
                                className="mt-1"
                            />
                            <span className="text-sm text-slate-700">
                                Don&rsquo;t text me — email only
                                <span className="block text-xs text-slate-500">
                                    You will still get every enquiry, just not as quickly.
                                </span>
                            </span>
                        </label>
                    </div>

                    <p className="sm:col-span-2 text-sm text-slate-500">
                        Neither goes on your listing — we use them to reach you about your work.
                    </p>
                </section>
                )}
            </fieldset>



            {/* The finish screen for a host trade: a short recap of what they're
                sending, so the last screen is their own listing rather than a blank
                page with a Send button. The old finish carried a logo uploader
                here; that's gone (the About-you headshot is the listing image now),
                which would otherwise have left this screen empty — every applicant
                reaches it signed in, so the signed-out account panel never shows. */}
            {onStep('finish') && !isGuest && !locked && (() => {
                const coverageVal = (areas || []).map((a) => a.town).filter(Boolean).join(', ') || '—';
                const priceVal = provideQuote
                    ? 'Priced per job'
                    : [
                        hourlyRate.trim() ? '£' + hourlyRate.trim() + ' an hour' : '',
                        flatFee.trim() ? '£' + flatFee.trim() + ' a job' : '',
                    ].filter(Boolean).join(' · ') || '—';
                const facts: [string, string][] = [
                    ['Trade', tradeLabel(trade)],
                    ['Covers', coverageVal],
                    ['Charges', priceVal],
                ];
                return (
                    <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                        <div className="flex items-center gap-4">
                            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100 flex items-center justify-center font-semibold text-slate-500">
                                {headshot
                                    ? <img src={getImageUrl(headshot)} alt="" className="h-full w-full object-cover" />
                                    : (initialsFor(businessName) || <User className="h-6 w-6" strokeWidth={1.5} />)}
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-lg font-semibold text-slate-900">{businessName || tradeLabel(trade)}</p>
                                {professionalTitle.trim() && (
                                    <p className="truncate text-[13px] text-slate-500">{professionalTitle.trim()}</p>
                                )}
                            </div>
                        </div>
                        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-3">
                            {facts.map(([k, v]) => (
                                <div key={k}>
                                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{k}</dt>
                                    <dd className="text-sm text-slate-800">{v}</dd>
                                </div>
                            ))}
                        </dl>
                        <p className="mt-4 text-sm text-slate-500">
                            Send it and we will check it over — usually within a day — and email you when
                            you are live. You can change anything until then.
                        </p>
                    </section>
                );
            })()}

            {/* The finish screen for a guest: a full-width PREVIEW of what they're
                submitting — cover photo, name, category, price, coverage, and what
                they wrote — so their last impression after ten screens is their own
                listing, not a wall of terms. Beneath it the terms are ONE line: a
                tickbox with the terms behind a link that opens them in a modal.
                REQUIRED to send — the save() guard and the gated button both hold
                on `termsAgreed`; the acceptance (version + timestamp) is recorded
                in the declarations jsonb (guestProviderFields). */}
            {onStep('finish') && isGuest && !locked && (() => {
                const catLabel = guestCategoryByKey(guestCategory)?.label || GUEST_SCREEN_COPY.finishSummaryCategory;
                const priceVal = (items || [])
                    .filter((i) => String(i.price || '').trim())
                    .map((i) => '£' + String(i.price).trim())
                    .join(', ') || '—';
                // A guest's areas hold the region label in `town` (set from
                // GUEST_REGIONS when a region is picked), so read that directly.
                const areaList = (areas || []).map((a) => a.town).filter(Boolean).join(', ');
                // Coverage reflects the made-to-order fulfilment choice: delivery
                // shows the delivery areas; collection-only has no areas, so it
                // says "Collection only" rather than reading blank; both shows the
                // areas and notes collection is available too. Slot and
                // comes-to-you keep their areas as before.
                const coverageVal = shape === 'made_to_order'
                    ? (fulfilment === 'collection'
                        ? GUEST_SCREEN_COPY.finishCoverageCollectionOnly
                        : fulfilment === 'both'
                            ? (areaList ? areaList + GUEST_SCREEN_COPY.finishCoverageBothSuffix : GUEST_SCREEN_COPY.finishCoverageCollectionAvailable)
                            : (areaList || '—'))
                    // A slot follows its fulfilment: a come-to-me slot has no
                    // regions but a public town (the address they gave); a
                    // travelling slot shows the areas it covers; a 'both' slot
                    // shows the studio town AND the areas it travels to.
                    : shape === 'slot'
                        ? (fulfilment === 'delivery'
                            ? (areaList || '—')
                            : fulfilment === 'both'
                                ? ((collectionTown.trim() || '—') + (areaList ? GUEST_SCREEN_COPY.finishCoverageTravelSuffix + areaList : ''))
                                : (collectionTown.trim() || '—'))
                        : (areaList || '—');
                const whenVal = shape === 'slot'
                    ? `${(schedule || []).length} weekly time${(schedule || []).length === 1 ? '' : 's'}`
                    : shape === 'made_to_order'
                        ? `${String(leadTimeDays || '0').trim()} days’ notice`
                        : 'arranged per booking';
                // Up to THREE photos in the hero space, in listing order so the
                // cover leads. More than three crams; one or two fill the space
                // rather than leaving gaps (see the layout below).
                const shots = (photos || []).slice(0, 3).map((p) => getImageUrl(p));
                const facts: [string, string][] = [
                    [GUEST_SCREEN_COPY.finishSummaryPrice, priceVal],
                    [GUEST_SCREEN_COPY.finishSummaryCoverage, coverageVal],
                    [GUEST_SCREEN_COPY.finishSummaryWhen, whenVal],
                    [GUEST_SCREEN_COPY.finishSummaryPhotos, String((photos || []).length)],
                ];
                const wrote: [string, string][] = ([
                    [GUEST_SCREEN_COPY.finishWroteTitle, professionalTitle.trim()],
                    [GUEST_SCREEN_COPY.finishWroteExpect, whatToExpect.trim()],
                    [GUEST_SCREEN_COPY.finishWroteQuals, qualifications.trim()],
                    [GUEST_SCREEN_COPY.finishWroteDietary, dietaryNote.trim()],
                ] as [string, string][]).filter(([, v]) => v);
                return (
                <section className="mb-8">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
                        {GUEST_SCREEN_COPY.finishSummaryHeading}
                    </h2>

                    {/* The preview card — reads as the listing about to be reviewed,
                        their last chance to spot a mistake before sending. */}
                    <div className="overflow-hidden rounded-3xl border border-slate-200">
                        {/* The hero: up to three photos in one band of fixed height,
                            cover first. One fills it; two split it in half; three put
                            the cover large on the left with the next two stacked on
                            the right (Airbnb-style), so the space is used whatever the
                            count and it's never more than three. */}
                        {shots.length === 0 ? (
                            <div className="flex h-40 w-full items-center justify-center bg-slate-100 text-sm text-slate-400">
                                No cover photo yet
                            </div>
                        ) : shots.length === 1 ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={shots[0]} alt="" className="h-56 w-full object-cover sm:h-72" />
                        ) : shots.length === 2 ? (
                            <div className="grid h-56 grid-cols-2 grid-rows-1 gap-1 sm:h-72">
                                {shots.map((s, i) => (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={i} src={s} alt="" className="h-full w-full object-cover" />
                                ))}
                            </div>
                        ) : (
                            <div className="grid h-56 grid-cols-2 grid-rows-2 gap-1 sm:h-72">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={shots[0]} alt="" className="row-span-2 h-full w-full object-cover" />
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={shots[1]} alt="" className="h-full w-full object-cover" />
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={shots[2]} alt="" className="h-full w-full object-cover" />
                            </div>
                        )}
                        <div className="p-6 sm:p-8">
                            {/* The Title is the listing's display name; the
                                category sits beneath it, and the provider's own
                                photo + first name is the byline (who a guest is
                                booking) — never a surname. */}
                            <h3 className="text-2xl font-bold text-slate-900 [text-wrap:balance] sm:text-3xl">
                                {professionalTitle.trim() || '—'}
                            </h3>
                            <p className="mt-1 text-slate-500">{catLabel}</p>

                            {summaryByline ? (
                                <div className="mt-4 flex items-center gap-2.5">
                                    {headshot ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={getImageUrl(headshot)} alt="" className="h-9 w-9 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                                    ) : (
                                        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                                            {summaryByline.slice(0, 1)}
                                        </span>
                                    )}
                                    <span className="text-sm text-slate-600">{summaryByline}</span>
                                </div>
                            ) : null}

                            <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 lg:grid-cols-4">
                                {facts.map(([label, value]) => (
                                    <div key={label}>
                                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
                                        <dd className="mt-0.5 text-sm text-slate-900 break-words">{value}</dd>
                                    </div>
                                ))}
                            </dl>

                            {/* The one place a 'both' provider is told how a time
                                sells — the basis screen no longer says it, and this
                                is the review where they can still change their mind. */}
                            {shape === 'slot' && slotOffer === 'both' && (
                                <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
                                    {GUEST_SCREEN_COPY.finishBothNote}
                                </p>
                            )}

                            {wrote.length > 0 && (
                                <div className="mt-8 space-y-5 border-t border-slate-100 pt-6">
                                    {wrote.map(([label, value]) => (
                                        <div key={label}>
                                            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
                                            <dd className="mt-1 whitespace-pre-line text-sm text-slate-700 [text-wrap:pretty]">{value}</dd>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* The terms, one line: a tickbox with the terms behind a link.
                        The link is a button INSIDE the label — clicking it opens the
                        modal and does not toggle the box (an interactive descendant
                        doesn't fire the label's control). */}
                    <div className="mt-6">
                        <div className="flex items-start gap-3">
                            <input
                                id="agree-terms"
                                type="checkbox"
                                checked={termsAgreed}
                                onChange={(e) => { setTermsAgreed(e.target.checked); setTermsError(''); }}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                            />
                            <label htmlFor="agree-terms" className="text-sm text-slate-800">
                                {GUEST_SCREEN_COPY.termsAgreePrefix}{' '}
                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); setTermsModalOpen(true); }}
                                    className="font-semibold text-emerald-700 underline hover:text-emerald-800"
                                >
                                    {GUEST_SCREEN_COPY.termsLinkText}
                                </button>.
                                <span className="mt-0.5 block text-xs text-slate-400">
                                    Version {PROVIDER_TERMS.version}
                                </span>
                            </label>
                        </div>
                        {termsError && (
                            <p data-problem className="mt-2 text-sm text-rose-700">{termsError}</p>
                        )}
                    </div>
                </section>
                );
            })()}

            {/* The terms modal: the full terms in a scrollable panel with a close
                button. No scroll-to-bottom gate. Opened from the agree line. */}
            {termsModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6"
                    role="dialog"
                    aria-modal="true"
                    aria-label={PROVIDER_TERMS.title}
                    onClick={() => setTermsModalOpen(false)}
                >
                    <div
                        className="flex max-h-[85vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-2xl sm:rounded-3xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                            <h3 className="text-base font-bold text-slate-900">{PROVIDER_TERMS.title}</h3>
                            <button
                                type="button"
                                onClick={() => setTermsModalOpen(false)}
                                aria-label={GUEST_SCREEN_COPY.termsModalClose}
                                className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="scroll-always space-y-4 overflow-y-auto px-5 py-5 text-sm text-slate-700 sm:px-6">
                            {PROVIDER_TERMS.draftNotice && (
                                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                    {PROVIDER_TERMS.draftNotice}
                                </p>
                            )}
                            {PROVIDER_TERMS.sections.map((sec) => (
                                <div key={sec.heading} className="space-y-1.5">
                                    <h4 className="font-semibold text-slate-900">{sec.heading}</h4>
                                    {sec.body.map((p, i) => <p key={i}>{p}</p>)}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* "Save and finish later" now lives in the footer, on the same line
                as the send button (see the footer below). What stays here is the
                live-business note. The block renders only when it has something
                to say, so an empty divider never shows. */}
            {onStep('finish') && !locked && status === 'approved' && (
                <div className="border-t border-slate-200 pt-6">
                    <p className="text-sm text-slate-600 mb-4">
                        You will stay live while we look. Changing your{' '}
                        <strong className="font-semibold text-slate-800">
                            business name, category, description, logo, or who you sell to
                        </strong>{' '}
                        means we check it again and email you — your listing stays up the whole
                        time. Contact details and the areas you cover change straight away, with
                        nothing to wait for.
                    </p>
                </div>
            )}

            {/* Only a draft, and only one they have actually started. Its own
                block (not nested in the note above), so a signed-in returning
                draft can still remove it. */}
            {onStep('finish') && !locked && status === 'draft' && providerId && (
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

                </div>{/* /the questions */}

                {/* A right-side spacer mirroring the rail's width. The panel
                    centres its content (mx-auto) within the space BETWEEN the rail
                    and this spacer; with the spacer matching the rail, that space
                    is the full body width minus 2×rail, so the content's centre —
                    and therefore its left edge — is independent of the rail width.
                    Without it the panel centres in the rail-left-only space and the
                    whole column slides by half the rail's width change every time
                    the rail collapses/expands. Hidden below lg, like the rail. */}
                {currentSection && flowSections.length > 0 && (
                    <div aria-hidden
                        className={'hidden lg:block shrink-0 transition-[width] duration-300 ease-out '
                            + (railCollapsed ? 'w-16' : 'w-72')} />
                )}
                </div>{/* /the two-column body (rail + questions) */}

                {/* ---- footer: Back, and the way on ----
                    Fixed to the bottom of the modal rather than sitting under
                    the content, so on a phone the way forward is under your
                    thumb instead of below the fold. */}
                <div className="shrink-0 border-t border-slate-200 bg-white px-4 sm:px-6 py-3 flex items-center gap-3">
                    {/* Back keeps everything. It is a state change and never a
                        route change: routing would remount this component and
                        take every field with it, which is the bug that makes
                        people distrust a stepped form. */}
                    {/* For a guest, Back lives top-left in the takeover bar, so
                        the footer carries only the way on. A trade keeps Back here. */}
                    {!isGuest && ((position > 1 || openGroup) ? (
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
                    ))}

                    {/* "Save and finish later" sits at the left of the footer on
                        the finish step, on the same line as the send button, rather
                        than floating in the content where it was easy to miss. Not
                        for a live business re-applying. */}
                    {onStep('finish') && !locked && status !== 'approved' && (
                        <button
                            type="button"
                            onClick={() => save(false)}
                            disabled={saving}
                            className="shrink-0 rounded-full border border-slate-300 px-4 sm:px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500 transition disabled:opacity-60"
                        >
                            Save and finish later
                        </button>
                    )}

                    {/* A required guest step says exactly what is missing beside
                        the greyed Next; a skippable one says so. Either way the
                        Next is never a silent dead end and a skippable screen is
                        never mistaken for one she must fill. */}
                    {stepMissing && (
                        <p className="text-sm font-medium text-amber-700 pr-1">{stepMissing}</p>
                    )}
                    {stepIsOptional && (
                        <p className="text-sm text-slate-400 pr-1">
                            {step === 'g_creds' && isGuest ? GUEST_SCREEN_COPY.expertiseFootnote : 'Optional — you can skip this'}
                        </p>
                    )}

                    <div className="flex-1" />

                    {/* The guest picker screens (group, sub-type) now carry a
                        Next like every other step — select a card, then Next —
                        so the two behave the same. A host's step one still
                        advances on the card itself and has no Next.

                        The last step has no Next either -- it has send, which
                        is already in the panel above with the words about what
                        it does. */}
                    {!lastStep && (step !== 'trade' || isGuest) && (() => {
                        // A host trade now greys Next until the step's required
                        // details are filled, the same as the guest flow (it used
                        // to leave Next live and show errors only after a press).
                        // The shared About-you steps use the same rules as the
                        // guest: g_you never gates (its shown number is the
                        // answer), g_creds gates on the professional title.
                        // Everything else on a host step comes through stepProblems.
                        const disabled =
                            // The years opener gates on a touch, both flows: the
                            // shown 5 is a suggestion, not an answer, so Next stays
                            // greyed until they press + or − (which fills yearsDoing).
                            step === 'g_you' ? !yearsDoing.trim()
                            : !isGuest ? (
                            step === 'g_creds' ? !professionalTitle.trim()
                            : stepProblems.length > 0
                        ) : (
                            step === 'trade' ? !guestGroup
                            : step === 'g_subtype' ? !guestCategory
                            : step === 'g_creds' ? !professionalTitle.trim()
                            // The listing needs a name — it is the h1 and the card.
                            : step === 'g_title' ? !listingTitle.trim()
                            : step === 'g_photos' ? photos.length === 0
                            // The booking-shape fork ('something else') must be
                            // answered — it decides the location screen and the rest.
                            : step === 'g_shape' ? !shape
                            // The pricing basis must be answered before moving on —
                            // it sets the unit and decides the next screen.
                            : step === 'g_slot_basis' ? slotOffer === null
                            // The come-to-me / travel fork sets the location screen.
                            : step === 'g_slot_where' ? !fulfilment
                            // A 'both' slot must have BOTH products priced, or a
                            // host who chose both quietly ships only one.
                            : step === 'g_menu' && shape === 'slot' && slotOffer === 'both'
                                ? !(items.some((r) => String(r.unit) === 'flat' && Number(r.price) > 0)
                                    && items.some((r) => String(r.unit) === 'person' && Number(r.price) > 0))
                            : step === 'g_area' ? (stepProblems.length > 0 || !!whereMissing)
                            : stepProblems.length > 0
                        );
                        const onNext = () => {
                            if (isGuest && step === 'trade') return advanceFromGroup();
                            if (isGuest && step === 'g_subtype') return advanceFromSubtype();
                            // Pass the years screen without touching it: the shown
                            // number is the answer they accepted, so store it now.
                            // Both flows share this step, so it is not gated on isGuest.
                            if (step === 'g_you' && !yearsDoing.trim()) setYearsDoing(String(YEARS_DEFAULT));
                            // Same rule for max guests: an untouched pass stores
                            // the shown default; a loaded value is left as it is.
                            if (isGuest && step === 'g_capacity' && !maxGuests.trim()) setMaxGuests(String(shape === 'comes_to_you' ? CAPACITY_DEFAULT_TRAVEL : CAPACITY_DEFAULT_SLOT));
                            // Same for the notice screen: an untouched pass stores
                            // the shown suggestion (2 days).
                            if (isGuest && step === 'g_notice' && !leadTimeDays.trim()) setLeadTimeDays('2');
                            // Same for session length: an untouched pass stores the
                            // shown suggestion (60 minutes).
                            if (isGuest && step === 'g_slot_length' && !slotLength.trim()) setSlotLength('60');
                            goNext();
                        };
                        return (
                            <button
                                type="button"
                                onClick={onNext}
                                disabled={disabled}
                                className={'inline-flex items-center gap-1.5 rounded-full px-6 py-2.5 text-sm font-semibold transition '
                                    + (disabled
                                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                        : 'bg-emerald-700 hover:bg-emerald-800 text-white')}
                            >
                                Next
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        );
                    })()}

                    {/* The last step's forward action, in the place every other
                        step keeps one: Back on the left, the thing that moves
                        you on to the right. It used to sit in the panel body,
                        which meant the one button somebody had come five steps
                        to press was the only one they had to go looking for.

                        `min-w-0` and the truncating label are what stop it
                        colliding with Back at 375: the two buttons plus
                        their padding do not fit a phone otherwise. */}
                    {lastStep && !locked && (
                        <button
                            type="button"
                            onClick={() => save(true)}
                            // A guest must agree to the terms before send. The
                            // save() guard enforces it too; disabling the button
                            // makes it visible, with the agree box and its gate
                            // line right above on the finish screen.
                            disabled={saving || (isGuest && !termsAgreed)}
                            className="min-w-0 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-5 sm:px-6 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                        >
                            <span className="block truncate">
                                {status === 'approved'
                                    ? (saving ? 'Saving…' : 'Save changes')
                                    : saving
                                        ? 'Sending…'
                                        : 'Send for review'}
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
