import { Fragment, type ReactNode } from 'react';
import { Users, BedDouble, Bath, PawPrint } from 'lucide-react';

// The small grey row of counts under a listing card's location: how many it
// sleeps, bedrooms, bathrooms, and pets. Numbers only, no words, thin dividers
// between — the same shape Airbnb and Booking.com use on a card. One row at
// phone width (nothing wraps), and every item carries an accessible label so a
// screen reader reads "Sleeps 20" rather than a lone "20".
//
// Colour follows the text colour set by `className`, so the row matches the
// location line of whichever card it sits in (stone on the public card, slate
// on the host card) — including the dividers and the "no pets" strike, which
// use the current colour.

type Count = number | string | null | undefined;

type Props = {
    maxGuests?: Count;
    bedrooms?: Count;
    bathrooms?: Count;
    // Whether the listing allows pets (the 'Pets allowed' amenity).
    petsAllowed?: boolean;
    // How many pets, when we store a number. Null/undefined → the paw shows
    // alone (pets allowed, count unknown).
    maxPets?: Count;
    className?: string;
};

function Divider() {
    return <span aria-hidden className="h-3 w-px flex-none bg-current opacity-30" />;
}

export default function ListingStats({
    maxGuests, bedrooms, bathrooms, petsAllowed, maxPets, className = 'text-stone-500',
}: Props) {
    const items: ReactNode[] = [];

    const g = Number(maxGuests);
    if (Number.isFinite(g) && g > 0) {
        items.push(
            <span key="guests" className="inline-flex items-center gap-1" aria-label={`Sleeps ${g}`}>
                <Users aria-hidden className="h-3.5 w-3.5" />
                <span>{g}</span>
            </span>,
        );
    }

    const bd = Number(bedrooms);
    if (Number.isFinite(bd) && bd > 0) {
        items.push(
            <span key="bedrooms" className="inline-flex items-center gap-1" aria-label={`${bd} ${bd === 1 ? 'bedroom' : 'bedrooms'}`}>
                <BedDouble aria-hidden className="h-3.5 w-3.5" />
                <span>{bd}</span>
            </span>,
        );
    }

    const ba = Number(bathrooms);
    if (Number.isFinite(ba) && ba > 0) {
        items.push(
            <span key="bathrooms" className="inline-flex items-center gap-1" aria-label={`${ba} ${ba === 1 ? 'bathroom' : 'bathrooms'}`}>
                <Bath aria-hidden className="h-3.5 w-3.5" />
                <span>{ba}</span>
            </span>,
        );
    }

    // Pets: only listings that accept pets show a paw — with the number when we
    // have it, the paw alone when we don't. A listing that doesn't take pets
    // shows no pet icon at all, so the row is just guests, bedrooms, bathrooms.
    const pets = Number(maxPets);
    const haveCount = Number.isFinite(pets) && pets > 0;
    if (petsAllowed) {
        items.push(
            <span key="pets" className="inline-flex items-center gap-1" aria-label={haveCount ? `${pets} ${pets === 1 ? 'pet' : 'pets'}` : 'Pets allowed'}>
                <PawPrint aria-hidden className="h-3.5 w-3.5" />
                {haveCount && <span>{pets}</span>}
            </span>,
        );
    }

    return (
        <div className={`flex items-center gap-2 whitespace-nowrap text-xs ${className}`}>
            {items.map((item, i) => (
                <Fragment key={i}>
                    {i > 0 && <Divider />}
                    {item}
                </Fragment>
            ))}
        </div>
    );
}
