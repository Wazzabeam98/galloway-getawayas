import { Feather, Sparkles, Users, Gem, MapPin, Maximize2 } from 'lucide-react';

// The highlight chips Airbnb offers under a listing's description — pick up to
// two and a suggested line is added to the text. One list, shared by the
// become-a-host wizard and the listing editor's Description, so the two can
// never offer different chips.
export const HIGHLIGHTS: { label: string; icon: any; phrase: string }[] = [
    { label: 'Peaceful', icon: Feather, phrase: 'a peaceful retreat' },
    { label: 'Unique', icon: Sparkles, phrase: 'a truly unique stay' },
    { label: 'Family-friendly', icon: Users, phrase: 'perfect for families' },
    { label: 'Stylish', icon: Gem, phrase: 'a stylish space' },
    { label: 'Central', icon: MapPin, phrase: 'in a central location' },
    { label: 'Spacious', icon: Maximize2, phrase: 'with plenty of space' },
];

export const MAX_HIGHLIGHTS = 2;

// "This is a peaceful retreat and perfect for families."
export function highlightSentence(selected: string[]): string {
    const phrases = HIGHLIGHTS.filter((h) => selected.includes(h.label)).map((h) => h.phrase);
    return phrases.length ? `This is ${phrases.join(' and ')}.` : '';
}
