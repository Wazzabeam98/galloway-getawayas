'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { DateRangePicker, Range, RangeKeyDict } from 'react-date-range';
import { format, addMonths, isSameDay } from 'date-fns';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

// Imported rather than referenced by path so that next/image gets the real
// dimensions at build time and can bake in a blurred placeholder. That
// placeholder is what a guest sees for the first fraction of a second,
// instead of the black box that used to sit there.
import hero1 from '@/public/images/hero-1.jpg';
import hero2 from '@/public/images/hero-2.jpg';
// hero-3 is the stonework one, and stone texture is the worst case for an
// image codec — there is no flat area to throw away, so every wall costs
// bytes. At the full 4928px source it came out of the optimiser at 1.4MB
// against 0.5–0.9MB for the other three.
//
// Quality is the wrong lever for it: dropping to 72 only reached 1.1MB, and
// softening is exactly what ruins stonework. Resolution is what costs the
// bytes, so this points at a 2560px-wide copy instead. next/image cannot
// serve wider than its source, so the 3840 variant a retina screen asks for
// is capped there — 0.57MB, in line with hero-1, still at quality 80.
//
// hero-3.jpg is the original and stays on disk untouched. Regenerate this
// copy from it with:
//   cp hero-3.jpg hero-3-web.jpg
//   sips --resampleWidth 2560 -s formatOptions 90 hero-3-web.jpg
import hero3 from '@/public/images/hero-3-web.jpg';
import hero4 from '@/public/images/hero-4.jpg';

const durations = ['weekend', 'week', 'month'];
const futureMonths = [...Array(12)].map((_, i) => addMonths(new Date(), i));

const HERO_IMAGES = [hero1, hero2, hero3, hero4];

// One list, used for the dropdown on both layouts and for naming the chosen
// place back to the guest in the collapsed mobile pill. The values are what
// travel in the `where` search param, and the home page matches them against
// `townKey(listing.location)` — see lib/places.ts.
const LOCATIONS: { value: string; label: string }[] = [
  { value: '', label: 'Search destinations' },
  { value: 'all', label: 'All Dumfries & Galloway' },
  { value: 'kirkcudbright', label: 'Kirkcudbright' },
  { value: 'castle-douglas', label: 'Castle Douglas' },
  { value: 'gatehouse-of-fleet', label: 'Gatehouse of Fleet' },
  { value: 'dumfries', label: 'Dumfries' },
  { value: 'dalbeattie', label: 'Dalbeattie' },
  { value: 'newton-stewart', label: 'Newton Stewart' },
  { value: 'moffat', label: 'Moffat' },
  { value: 'stranraer', label: 'Stranraer' },
];

// The four guest rows are identical apart from their wording and what they do
// on the way up, and they now appear in two places — the desktop popover and
// the mobile panel. One component so the two cannot drift apart. `size` is the
// only thing that differs between them: 28px is fine for a mouse and too small
// for a thumb.
function GuestCounter({
  label,
  hint,
  value,
  onDecrement,
  onIncrement,
  size = 'desktop',
  divider = true,
}: {
  label: string;
  hint: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  size?: 'desktop' | 'mobile';
  divider?: boolean;
}) {
  const button =
    size === 'mobile'
      ? 'w-10 h-10 text-lg'
      : 'w-7 h-7';

  return (
    <div
      className={`flex items-center justify-between ${
        size === 'mobile' ? 'py-3.5' : 'py-2.5'
      } ${divider ? 'border-b border-stone-100' : ''}`}
    >
      <div>
        <p className="font-semibold text-sm">{label}</p>
        <p className="text-xs text-stone-500">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Remove one ${label.toLowerCase().replace(/s$/, '')}`}
          onClick={onDecrement}
          className={`${button} rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30`}
        >
          −
        </button>
        <span className="w-4 text-center text-sm font-medium">{value}</span>
        <button
          type="button"
          aria-label={`Add one ${label.toLowerCase().replace(/s$/, '')}`}
          onClick={onIncrement}
          className={`${button} rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function Hero() {
  const router = useRouter();
  const [activePopover, setActivePopover] = useState<'where' | 'when' | 'who' | null>(null);

  // Search State
  const [location, setLocation] = useState('');
  const [dateTab, setDateTab] = useState<'dates' | 'flexible'>('dates');
  
  const today = new Date();
  const [dateRange, setDateRange] = useState<Range>({
    startDate: today,
    endDate: today,
    key: 'selection',
  });

  const [stayDuration, setStayDuration] = useState('week');
  const [selectedMonths, setSelectedMonths] = useState<Date[]>([]);

  // Guest State
  const [adults, setAdults] = useState(0);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [pets, setPets] = useState(0);

  const heroRef = useRef<HTMLDivElement>(null);

  // Rotating hero images
  const [heroIndex, setHeroIndex] = useState(0);

  // The first photo loads on its own; the other three only start once it has
  // arrived, so nothing competes with the image the guest is actually looking
  // at. The timer is a backstop — if the first one never reports back, the
  // slideshow still has something to rotate to.
  const [firstLoaded, setFirstLoaded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFirstLoaded(true), 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // Respect the system setting — auto-moving content makes some people
    // genuinely unwell, so hold on the first image if they've asked for
    // reduced motion.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % HERO_IMAGES.length);
    }, 4500);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (heroRef.current && !heroRef.current.contains(event.target as Node)) {
        setActivePopover(null);
      }
    };
    // touchstart as well as mousedown: on a phone a mousedown only arrives
    // after the tap has finished, so tapping away never dismissed these.
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  const handleSelectDates = (ranges: RangeKeyDict) => {
    setDateRange(ranges.selection);
    if (
      ranges.selection.startDate &&
      ranges.selection.endDate &&
      !isSameDay(ranges.selection.startDate, ranges.selection.endDate)
    ) {
      setActivePopover(null);
    }
  };

  const toggleMonth = (month: Date) => {
    if (selectedMonths.some((m) => isSameDay(m, month))) {
      setSelectedMonths(selectedMonths.filter((m) => !isSameDay(m, month)));
    } else {
      setSelectedMonths([...selectedMonths, month]);
    }
  };

  const totalGuests = adults + children;
  let guestSummary = 'Add guests';
  if (totalGuests > 0 || infants > 0 || pets > 0) {
    const parts = [];
    if (totalGuests > 0) parts.push(`${totalGuests} guest${totalGuests > 1 ? 's' : ''}`);
    if (infants > 0) parts.push(`${infants} infant${infants > 1 ? 's' : ''}`);
    if (pets > 0) parts.push(`${pets} pet${pets > 1 ? 's' : ''}`);
    guestSummary = parts.join(', ');
  }

  const hasRealDateRange =
    dateTab === 'dates' &&
    !!dateRange.startDate &&
    !!dateRange.endDate &&
    !isSameDay(dateRange.startDate, dateRange.endDate);

  let whenSummary = 'Add dates';
  if (hasRealDateRange) {
    whenSummary = `${format(dateRange.startDate!, 'd MMM')} - ${format(dateRange.endDate!, 'd MMM')}`;
  } else if (dateTab === 'flexible') {
    if (selectedMonths.length > 0) {
      const sortedMonths = [...selectedMonths].sort((a, b) => a.getTime() - b.getTime());
      whenSummary = `A ${stayDuration} in ${format(sortedMonths[0], 'MMM')}${sortedMonths.length > 1 ? '...' : ''}`;
    } else {
      whenSummary = `Any ${stayDuration}`;
    }
  }

  const whereSummary =
    LOCATIONS.find((l) => l.value === location && l.value !== '')?.label || 'Where to?';

  // What the guest has actually picked, or nothing — the card falls back to
  // its own quiet hint ("Anywhere", "Any week", "Add guests") when a slot is
  // empty, so no cell reads as unfinished. Deliberately not the desktop bar's
  // wording: that bar has no labels above its fields, so its prompts have to
  // name the field as well as invite a value.
  const whereChosen = whereSummary === 'Where to?' ? '' : whereSummary;
  const whenChosen = whenSummary === 'Add dates' ? '' : whenSummary;
  const guestChosen = guestSummary === 'Add guests' ? '' : guestSummary;

  // One search, run from both layouts. Anything the guest left alone is left
  // out of the URL entirely, so a bare `/` still means "show me everything".
  const runSearch = () => {
    const params = new URLSearchParams();

    if (location && location !== 'all') params.set('where', location);

    // Flexible dates deliberately do not become a from/to filter — a month
    // hint is not a stay. The rest of the search still runs; better that than
    // silently returning nothing.
    if (hasRealDateRange) {
      params.set('from', format(dateRange.startDate!, 'yyyy-MM-dd'));
      params.set('to', format(dateRange.endDate!, 'yyyy-MM-dd'));
    }

    if (totalGuests > 0) params.set('guests', String(totalGuests));
    if (pets > 0) params.set('pets', '1');

    setActivePopover(null);

    const query = params.toString();
    router.push(query ? `/?${query}` : '/');
  };

  const searchIcon = (className: string) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );

  // The Dates/Flexible content, shared by the desktop popover and the mobile
  // panel. Only the calendar itself differs: two months side by side is about
  // 430px wide, which does not fit a phone, so the mobile one shows a single
  // month and scrolls.
  const whenContent = (variant: 'desktop' | 'mobile') => (
    <>
      <div className="flex justify-center mb-3">
        <div className="bg-stone-100 p-1 rounded-full flex gap-1 border border-stone-200">
          <button
            type="button"
            onClick={() => setDateTab('dates')}
            className={`px-6 py-1.5 rounded-full text-xs font-semibold transition ${
              dateTab === 'dates' ? 'bg-white shadow text-stone-900' : 'text-stone-600'
            }`}
          >
            Dates
          </button>
          <button
            type="button"
            onClick={() => setDateTab('flexible')}
            className={`px-6 py-1.5 rounded-full text-xs font-semibold transition ${
              dateTab === 'flexible' ? 'bg-white shadow text-stone-900' : 'text-stone-600'
            }`}
          >
            Flexible
          </button>
        </div>
      </div>

      {dateTab === 'dates' && (
        <div
          className={`airbnb-compact-calendar ${
            variant === 'mobile' ? 'airbnb-mobile-calendar' : ''
          } flex justify-center`}
        >
          <DateRangePicker
            ranges={[dateRange]}
            onChange={handleSelectDates}
            // One month on a phone. Two side by side is about 430px wide,
            // which does not fit; and react-date-range hides the extra month
            // itself once the direction is vertical, so asking for two would
            // only pretend to give two.
            months={variant === 'mobile' ? 1 : 2}
            direction={variant === 'mobile' ? 'vertical' : 'horizontal'}
            showDateDisplay={false}
            moveRangeOnFirstSelection={false}
            // The desktop styling hides these and labels each month with
            // .rdrMonthName instead. Stacked vertically there is no such
            // label on the first month, so the phone gets the real
            // month/year pickers back — which are a better control on a
            // touchscreen anyway. See .airbnb-mobile-calendar in globals.css.
            showMonthAndYearPickers={variant === 'mobile'}
            minDate={new Date()}
            rangeColors={['#047857']}
            weekStartsOn={1}
            className="text-xs"
          />
        </div>
      )}

      {dateTab === 'flexible' && (
        <div className="space-y-4 text-center max-w-md mx-auto">
          <div>
            <h4 className="text-sm font-bold text-stone-900 mb-2">
              How long would you like to stay?
            </h4>
            <div className="flex justify-center gap-2">
              {durations.map((duration) => (
                <button
                  key={duration}
                  type="button"
                  onClick={() => setStayDuration(duration)}
                  className={`px-4 py-1.5 rounded-full border text-xs font-medium capitalize transition ${
                    stayDuration === duration
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-300 text-stone-700 hover:border-stone-900'
                  }`}
                >
                  {duration}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-stone-900 mb-2">When do you want to go?</h4>
            <div
              className={`grid grid-cols-3 sm:grid-cols-4 gap-2 ${
                variant === 'mobile' ? '' : 'max-h-48 overflow-y-auto'
              } p-1`}
            >
              {futureMonths.map((month, i) => {
                const isSelected = selectedMonths.some((m) => isSameDay(m, month));
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleMonth(month)}
                    className={`p-2 rounded-xl border transition flex flex-col items-center justify-center ${
                      isSelected
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-700'
                        : 'border-stone-200 hover:border-stone-400'
                    }`}
                  >
                    <svg
                      className="w-4 h-4 text-emerald-600 mb-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <p className="text-[11px] font-bold">{format(month, 'MMMM')}</p>
                    <p className="text-[9px] text-stone-500">{format(month, 'yyyy')}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Every counter updates from the previous value rather than from the one
  // captured when this rendered. Two taps in quick succession used to count as
  // one, because both read the same stale number.
  const guestContent = (variant: 'desktop' | 'mobile') => (
    <>
      <GuestCounter
        label="Adults"
        hint="Ages 13 or above"
        value={adults}
        size={variant}
        onDecrement={() => setAdults((n) => Math.max(0, n - 1))}
        onIncrement={() => setAdults((n) => n + 1)}
      />
      <GuestCounter
        label="Children"
        hint="Ages 2–12"
        value={children}
        size={variant}
        onDecrement={() => setChildren((n) => Math.max(0, n - 1))}
        onIncrement={() => {
          setChildren((n) => n + 1);
          setAdults((a) => (a === 0 ? 1 : a));
        }}
      />
      <GuestCounter
        label="Infants"
        hint="Under 2"
        value={infants}
        size={variant}
        onDecrement={() => setInfants((n) => Math.max(0, n - 1))}
        onIncrement={() => {
          setInfants((n) => n + 1);
          setAdults((a) => (a === 0 ? 1 : a));
        }}
      />
      <GuestCounter
        label="Pets"
        hint="Bringing a service animal?"
        value={pets}
        size={variant}
        divider={false}
        onDecrement={() => setPets((n) => Math.max(0, n - 1))}
        onIncrement={() => {
          setPets((n) => n + 1);
          setAdults((a) => (a === 0 ? 1 : a));
        }}
      />
    </>
  );

  // One cell of the 2x2 grid. Label and value share a line, so a cell is a
  // single line tall whatever is in it — the card cannot grow as choices are
  // made. A value too long for half the card width is cut with an ellipsis
  // rather than wrapping, which is what `truncate` plus `min-w-0` buys: the
  // flex child is allowed to be narrower than its text, so the ellipsis is
  // reachable. Without `min-w-0` a flex child refuses to shrink below its
  // content and the cell would push the grid wider instead.
  const gridCell = (
    key: 'where' | 'when' | 'who',
    label: string,
    chosen: string,
    hint: string,
    edges: string,
  ) => {
    const open = activePopover === key;
    return (
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setActivePopover(open ? null : key)}
        className={`min-h-[52px] min-w-0 px-4 py-3 flex items-baseline gap-2 text-left transition ${edges} ${
          open ? 'bg-white/[0.45]' : 'bg-transparent'
        }`}
      >
        <span className="shrink-0 text-[10px] font-bold tracking-wider uppercase text-stone-700">
          {label}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            chosen ? 'font-medium text-stone-900' : 'font-normal text-stone-500'
          }`}
        >
          {chosen || hint}
        </span>
      </button>
    );
  };

  // Whichever cell is open, its control opens underneath the grid across the
  // full width of the card. Putting it inside a cell would stretch that cell
  // and pull the grid out of shape.
  const openContent =
    activePopover === 'where' ? (
      <select
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        aria-label="Where"
        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base font-medium text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
      >
        {LOCATIONS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    ) : activePopover === 'when' ? (
      whenContent('mobile')
    ) : activePopover === 'who' ? (
      guestContent('mobile')
    ) : null;

  return (
    <div
      className="relative z-40 w-full min-h-[68svh] md:h-[500px] py-10 md:py-0 flex items-stretch md:items-center justify-center bg-stone-600 text-white overflow-visible"
      ref={heroRef}
    >
      {/* Rotating background images */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {HERO_IMAGES.map((src, i) => (
          <div
            key={src.src}
            aria-hidden="true"
            className="absolute inset-0 transition-opacity duration-1000 ease-in-out"
            style={{ opacity: i === heroIndex ? 1 : 0 }}
          >
            {/* quality 80 rather than the default 75: at 70 the bare
                branches and the water go visibly soft on a large screen,
                and these are photos we paid for. */}
            {(i === 0 || firstLoaded) && (
              <Image
                src={src}
                alt=""
                fill
                sizes="100vw"
                quality={80}
                priority={i === 0}
                placeholder="blur"
                className="object-cover object-center"
                onLoadingComplete={i === 0 ? () => setFirstLoaded(true) : undefined}
              />
            )}
          </div>
        ))}
        {/* There used to be a bottom-up scrim here meant to shade the search
            card and the dots. It never rendered: it was built with
            `from-stone-950/45`, and 45 is not on Tailwind 3's opacity scale,
            so the class was never generated, `--tw-gradient-from` stayed
            unset, and the whole linear-gradient() was invalid — the element
            computed to `background-image: none` on every screen. Removed
            rather than repaired, because switching it on now is a visible
            change to the foot of the photo that nobody asked for. To bring it
            back, use an arbitrary value so the opacity scale cannot swallow
            it again:
              bg-gradient-to-t from-[rgba(12,10,9,0.45)] via-transparent to-transparent
            The frosted search card already carries its own contrast. */}
        {/* Phone only. The heading and subtitle are top-aligned on a phone, so
            they sit on this rather than on bare sky: heaviest at the very top,
            holding until just past the foot of the subtitle at ~27% down, and
            gone by 58%. That leaves the middle of the photo — where the
            subject usually is — untouched. Worst-case contrast for the
            subtitle, measured over all four photos: 4.8:1, against 1.2:1 for
            the mint that used to sit here. Note the colour was not the whole
            problem — pure white under the old overlays still only reached
            1.4:1, so the scrim is the part doing the work. */}
        <div className="md:hidden absolute inset-0 bg-[linear-gradient(to_bottom,rgba(12,10,9,0.62)_0%,rgba(12,10,9,0.56)_24%,rgba(12,10,9,0.47)_32%,rgba(12,10,9,0.18)_44%,transparent_58%)]" />
        {/* md and up only. The text is vertically centred at this width, which
            is below where the top scrim has faded out, so the centred pool is
            still the thing carrying it. Unchanged from before. */}
        <div className="hidden md:block absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.35)_0%,rgba(0,0,0,0.12)_45%,transparent_75%)]" />
      </div>

      {/* Which image you're on — also lets people skip ahead */}
      {HERO_IMAGES.length > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-0 flex items-center gap-2">
          {HERO_IMAGES.map((src, i) => (
            <button
              key={src.src}
              type="button"
              onClick={() => setHeroIndex(i)}
              aria-label={`Show image ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === heroIndex ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'
              }`}
            />
          ))}
        </div>
      )}

      {/* Hero Content */}
      <div className="relative z-30 text-center max-w-5xl px-4 flex flex-col items-center w-full">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-3 drop-shadow-lg">
          Galloway Getaways
        </h1>
        <p className="text-lg md:text-xl font-medium mb-8 drop-shadow-md text-white">
          Book direct for our best rate guarantee & lower booking fees
        </p>

        {/* Compact search — small screens only. Two by two: Where and When
            across the top, Who and Search underneath. `mt-auto` drops it to
            the bottom of the hero so the photo is clear above it. Same three
            controls as the desktop bar, and nothing about how they work
            changes. */}
        <div className="md:hidden mt-auto mb-8 md:mb-0 w-full max-w-md text-stone-800">
          <div className="bg-white/[0.85] backdrop-blur-md rounded-3xl shadow-2xl border border-white/60 overflow-hidden">
            <div className="grid grid-cols-2">
              {gridCell('where', 'Where', whereChosen, 'Anywhere', 'border-r border-b border-stone-200')}
              {gridCell('when', 'When', whenChosen, 'Any week', 'border-b border-stone-200')}
              {gridCell('who', 'Who', guestChosen, 'Add guests', 'border-r border-stone-200')}
              <button
                type="button"
                onClick={runSearch}
                className="min-h-[52px] bg-emerald-700 hover:bg-emerald-800 text-white flex items-center justify-center gap-2 font-semibold transition"
              >
                {searchIcon('w-4 h-4')}
                Search
              </button>
            </div>

            {openContent && (
              <div className="border-t border-stone-200 px-4 py-4">{openContent}</div>
            )}
          </div>
        </div>

        {/* Search Bar — desktop. Unchanged apart from being hidden on phones. */}
        <div className="hidden md:flex w-full max-w-3xl bg-white rounded-full p-1.5 shadow-2xl text-stone-800 items-center relative border border-stone-100">
          
          {/* WHERE */}
          <div
            onClick={() => setActivePopover('where')}
            className={`flex-grow px-6 py-2.5 text-left rounded-full transition cursor-pointer ${
              activePopover === 'where' ? 'bg-white shadow-md' : 'hover:bg-stone-100'
            }`}
          >
            <label className="block text-[10px] font-bold tracking-wider uppercase text-stone-700 cursor-pointer">
              Where
            </label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-transparent text-sm font-medium text-stone-900 focus:outline-none cursor-pointer border-none p-0 focus:ring-0 truncate"
            >
              {LOCATIONS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div className="h-8 w-[1px] bg-stone-200"></div>

          {/* WHEN */}
          <div
            onClick={() => setActivePopover('when')}
            className={`flex-grow px-6 py-2.5 text-left rounded-full transition cursor-pointer ${
              activePopover === 'when' ? 'bg-white shadow-md' : 'hover:bg-stone-100'
            }`}
          >
            <label className="block text-[10px] font-bold tracking-wider uppercase text-stone-700 cursor-pointer">
              When
            </label>
            <p
              className={`text-sm font-medium truncate ${
                whenSummary === 'Add dates' ? 'text-stone-400' : 'text-stone-900'
              }`}
            >
              {whenSummary}
            </p>
          </div>

          <div className="h-8 w-[1px] bg-stone-200"></div>

          {/* WHO */}
          <div
            onClick={() => setActivePopover('who')}
            className={`flex-grow px-6 py-2.5 text-left rounded-full transition cursor-pointer ${
              activePopover === 'who' ? 'bg-white shadow-md' : 'hover:bg-stone-100'
            }`}
          >
            <label className="block text-[10px] font-bold tracking-wider uppercase text-stone-700 cursor-pointer">
              Who
            </label>
            <p
              className={`text-sm font-medium truncate ${
                guestSummary === 'Add guests' ? 'text-stone-400' : 'text-stone-900'
              }`}
            >
              {guestSummary}
            </p>
          </div>

          {/* Search Button */}
          <div className="flex justify-end p-0.5">
            <button
              type="button"
              onClick={runSearch}
              aria-label="Search"
              className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full p-3.5 flex items-center justify-center transition shadow-md"
            >
              {searchIcon('w-5 h-5')}
            </button>
          </div>

          {/* WHEN POPOVER */}
          {activePopover === 'when' && (
            <div className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+10px)] bg-white rounded-3xl p-4 shadow-2xl border border-stone-200 text-stone-900 z-50 w-[min(92vw,600px)] max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain">
              {whenContent('desktop')}
            </div>
          )}

          {/* WHO POPOVER */}
          {activePopover === 'who' && (
            <div className="absolute right-0 top-[calc(100%+10px)] w-[min(92vw,20rem)] bg-white rounded-3xl p-5 shadow-2xl border border-stone-200 text-stone-900 z-50 max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain">
              {guestContent('desktop')}
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
