'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
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

export default function Hero() {
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
    const handleClickOutside = (event: MouseEvent) => {
      if (heroRef.current && !heroRef.current.contains(event.target as Node)) {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  let whenSummary = 'Add dates';
  if (
    dateTab === 'dates' &&
    dateRange.startDate &&
    dateRange.endDate &&
    !isSameDay(dateRange.startDate, dateRange.endDate)
  ) {
    whenSummary = `${format(dateRange.startDate, 'd MMM')} - ${format(dateRange.endDate, 'd MMM')}`;
  } else if (dateTab === 'flexible') {
    if (selectedMonths.length > 0) {
      const sortedMonths = [...selectedMonths].sort((a, b) => a.getTime() - b.getTime());
      whenSummary = `A ${stayDuration} in ${format(sortedMonths[0], 'MMM')}${sortedMonths.length > 1 ? '...' : ''}`;
    } else {
      whenSummary = `Any ${stayDuration}`;
    }
  }

  return (
    <div
      className="relative z-40 w-full h-[460px] md:h-[500px] flex items-center justify-center bg-stone-600 text-white overflow-visible"
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
        {/* Soft Vignette Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950/45 via-stone-900/5 to-stone-950/20" />
        {/* A soft pool of shade behind the heading only, so the photo stays
            bright at the edges but the white text still holds up. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.35)_0%,rgba(0,0,0,0.12)_45%,transparent_75%)]" />
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
      <div className="relative z-30 text-center max-w-5xl px-4 flex flex-col items-center">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-3 drop-shadow-lg">
          Galloway Getaways
        </h1>
        <p className="text-lg md:text-xl font-medium mb-8 drop-shadow text-emerald-100">
          Book direct for our best rate guarantee & lower booking fees
        </p>

        {/* Search Bar */}
        <div className="w-full max-w-3xl bg-white rounded-full p-1.5 shadow-2xl text-stone-800 flex items-center relative border border-stone-100">
          
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
              <option value="">Search destinations</option>
              <option value="all">All Dumfries & Galloway</option>
              <option value="kirkcudbright">Kirkcudbright</option>
              <option value="castle-douglas">Castle Douglas</option>
              <option value="gatehouse-of-fleet">Gatehouse of Fleet</option>
              <option value="dumfries">Dumfries</option>
              <option value="dalbeattie">Dalbeattie</option>
              <option value="newton-stewart">Newton Stewart</option>
              <option value="moffat">Moffat</option>
              <option value="stranraer">Stranraer</option>
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
            <button className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full p-3.5 flex items-center justify-center transition shadow-md">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </button>
          </div>

          {/* WHEN POPOVER */}
          {activePopover === 'when' && (
            <div className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+10px)] bg-white rounded-3xl p-4 shadow-2xl border border-stone-200 text-stone-900 z-50 w-[min(92vw,600px)] max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain">
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
                <div className="airbnb-compact-calendar flex justify-center">
                  <DateRangePicker
                    ranges={[dateRange]}
                    onChange={handleSelectDates}
                    months={2}
                    direction="horizontal"
                    showDateDisplay={false}
                    moveRangeOnFirstSelection={false}
                    showMonthAndYearPickers={false}
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
                    <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1">
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
            </div>
          )}

          {/* WHO POPOVER */}
          {activePopover === 'who' && (
            <div className="absolute right-0 top-[calc(100%+10px)] w-[min(92vw,20rem)] bg-white rounded-3xl p-5 shadow-2xl border border-stone-200 text-stone-900 z-50 max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between py-2.5 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-sm">Adults</p>
                  <p className="text-xs text-stone-500">Ages 13 or above</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAdults(Math.max(0, adults - 1))}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm font-medium">{adults}</span>
                  <button
                    type="button"
                    onClick={() => setAdults(adults + 1)}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-2.5 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-sm">Children</p>
                  <p className="text-xs text-stone-500">Ages 2–12</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setChildren(Math.max(0, children - 1))}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm font-medium">{children}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setChildren(children + 1);
                      if (adults === 0) setAdults(1);
                    }}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-2.5 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-sm">Infants</p>
                  <p className="text-xs text-stone-500">Under 2</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setInfants(Math.max(0, infants - 1))}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm font-medium">{infants}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setInfants(infants + 1);
                      if (adults === 0) setAdults(1);
                    }}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <div>
                  <p className="font-semibold text-sm">Pets</p>
                  <p className="text-xs text-stone-500">Bringing a service animal?</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPets(Math.max(0, pets - 1))}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm font-medium">{pets}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPets(pets + 1);
                      if (adults === 0) setAdults(1);
                    }}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
