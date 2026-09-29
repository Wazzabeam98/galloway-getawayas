// The company's legal details, in one place.
//
// Every email footer, the site footers, /terms, /privacy, /contact and the
// provider terms read from here. They used to carry their own copies — the
// email footer said "Dumfries & Galloway, Scotland" where /terms gave the
// registered office, and the site footer gave no number at all — so a change
// (a new registered office, say) would have been made in one place and missed
// in the rest.

export const COMPANY = {
    name: 'Galloway Getaways Ltd',
    number: 'SC899385',
    registeredIn: 'Scotland',
    registeredOffice: ['17b King Street', 'Castle Douglas', 'DG7 1AA'],
    email: 'hello@gallowaygetaways.co.uk',
} as const;

// "17b King Street, Castle Douglas, DG7 1AA"
export const REGISTERED_OFFICE = COMPANY.registeredOffice.join(', ');

// "Galloway Getaways Ltd, registered in Scotland (company number SC899385),
// registered office 17b King Street, Castle Douglas, DG7 1AA" — for running text.
export const COMPANY_SENTENCE =
    `${COMPANY.name}, a company registered in ${COMPANY.registeredIn} `
    + `(company number ${COMPANY.number}), registered office ${REGISTERED_OFFICE}`;

// The short legal line under a footer.
export const COMPANY_LINE =
    `${COMPANY.name} · Registered in ${COMPANY.registeredIn}, company number ${COMPANY.number} · `
    + `Registered office: ${REGISTERED_OFFICE}`;
