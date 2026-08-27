// Free-text skills, and the four-tags-for-one-job problem.
//
// The point of the whole feature is that "bricklaying", "brick laying",
// "brickwork" and "bricks" must not become four tags, because a host searching
// one of them then misses three tradesmen who do exactly that work. Two of
// those four are caught automatically and two are a judgement — the tests
// below are as much about drawing that line honestly as about the code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    skillSlug,
    skillCompact,
    skillKey,
    regulatedConceptFor,
    schemesSatisfying,
    skillIsPublic,
    blockedSkills,
    blockedSkillReason,
    suggestSkills,
    wouldCreateNew,
} = require('@/lib/serviceSkills');

// --- what collides, and what honestly does not -----------------------------

test('capitals and punctuation are the same tag', () => {
    const forms = ['Bricklaying', 'bricklaying', 'BRICKLAYING', ' bricklaying '];
    for (const form of forms) {
        assert.equal(skillSlug(form), 'bricklaying', form + ' is bricklaying');
    }
});

test('a space is not a new tag', () => {
    // The common split, and the one the compact form exists to catch.
    assert.equal(skillCompact('brick laying'), 'bricklaying');
    assert.equal(skillCompact('brick-laying'), 'bricklaying');
    assert.equal(skillCompact('Bricklaying'), 'bricklaying');
});

test('accents fold, so facade and façade are one tag', () => {
    assert.equal(skillSlug('façade'), 'facade');
});

// Being straight about the limit rather than pretending otherwise. These are
// what the merge tool is for, and no amount of normalising makes them safe to
// collapse automatically — "bricks" and "brickwork" could as easily be a
// supplier and a trade.
test('different words are still different tags, and that is the merge tool', () => {
    assert.notEqual(skillSlug('brickwork'), skillSlug('bricklaying'));
    assert.notEqual(skillCompact('bricks'), skillCompact('bricklaying'));
});

test('a tag that is only punctuation is not a tag', () => {
    assert.equal(skillKey('***'), null);
    assert.equal(skillKey('   '), null);
    assert.equal(skillKey(''), null);
    assert.equal(skillKey(null), null);
});

test('a label reads as words, not as a slug', () => {
    const key = skillKey('DRY STONE dyking');
    assert.equal(key.label, 'Dry stone dyking');
    assert.equal(key.slug, 'dry stone dyking');
    assert.equal(key.compact, 'drystonedyking');
});

test('a tag nobody could read is refused rather than stored', () => {
    assert.equal(skillKey('a'.repeat(200)), null);
});

// --- regulated work --------------------------------------------------------

test('gas work is spotted however it is worded', () => {
    for (const text of ['boiler repair', 'Gas fitting', 'combi swap', 'flue cleaning', 'LPG']) {
        assert.equal(regulatedConceptFor(text), 'gas', text + ' is Gas Safe territory');
    }
});

test('oil is oil, not gas, even though it says boiler', () => {
    // Most of Galloway is off the gas grid, so this is the common case rather
    // than the exception — and OFTEC rather than Gas Safe is the honest answer.
    assert.equal(regulatedConceptFor('oil boiler servicing'), 'oil');
    assert.equal(regulatedConceptFor('oil tank replacement'), 'oil');
});

test('electrical work is spotted', () => {
    for (const text of ['rewiring', 'consumer unit upgrades', 'fuse board', 'electrical testing']) {
        assert.equal(regulatedConceptFor(text), 'electrical', text + ' is Part P territory');
    }
});

test('ordinary trades are not regulated', () => {
    for (const text of ['bricklaying', 'fencing', 'laying slabs', 'wallpapering', 'dry stone dyking']) {
        assert.equal(regulatedConceptFor(text), null, text + ' needs no certificate');
    }
});

test('Part P is four bodies, so a concept maps to a list', () => {
    assert.deepEqual(schemesSatisfying('gas'), ['gas_safe']);
    assert.deepEqual(schemesSatisfying('oil'), ['oftec']);
    assert.equal(schemesSatisfying('electrical').length, 4);
});

// --- who may show what -----------------------------------------------------

const gasTag = { id: '1', label: 'Boiler repair', regulated_concept: 'gas' };
const plainTag = { id: '2', label: 'Bricklaying', regulated_concept: null };

test('an ordinary tag is always public', () => {
    assert.equal(skillIsPublic(plainTag, []), true);
    assert.equal(skillIsPublic(plainTag, null), true);
});

test('a regulated tag with no registration is not public', () => {
    assert.equal(skillIsPublic(gasTag, []), false);
});

test('a regulated tag with an UNVERIFIED registration is not public', () => {
    // The number being typed in is not the gate. Somebody checking it is.
    assert.equal(skillIsPublic(gasTag, [{ scheme: 'gas_safe', verified: false }]), false);
});

test('a regulated tag with the right verified registration is public', () => {
    assert.equal(skillIsPublic(gasTag, [{ scheme: 'gas_safe', verified: true }]), true);
});

test('the wrong registration does not unlock it', () => {
    // An OFTEC number says nothing about mains gas.
    assert.equal(skillIsPublic(gasTag, [{ scheme: 'oftec', verified: true }]), false);
});

test('any Part P scheme unlocks electrical work', () => {
    const tag = { id: '3', label: 'Rewiring', regulated_concept: 'electrical' };
    for (const scheme of ['part_p_niceic', 'part_p_napit', 'part_p_elecsa', 'part_p_stroma']) {
        assert.equal(skillIsPublic(tag, [{ scheme, verified: true }]), true, scheme + ' is enough');
    }
});

test('blockedSkills lists only what cannot be shown', () => {
    const blocked = blockedSkills([plainTag, gasTag], [{ scheme: 'gas_safe', verified: false }]);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].label, 'Boiler repair');
});

// --- what the provider is told ---------------------------------------------

test('a plumber is told to add their number', () => {
    const message = blockedSkillReason(gasTag, 'plumber', true);
    assert.match(message, /Gas Safe/);
    assert.match(message, /Add your number/i);
});

test('a handyman is routed, not refused', () => {
    // The handyman form never asks about gas, so "add your number above" would
    // send them looking for a field that is not there.
    const message = blockedSkillReason(gasTag, 'handyman', false);
    assert.match(message, /Plumber/);
    assert.equal(/Add your number/i.test(message), false);
});

test('electrical work routes to the electrician', () => {
    const tag = { id: '3', label: 'Rewiring', regulated_concept: 'electrical' };
    assert.match(blockedSkillReason(tag, 'handyman', false), /Electrician/);
});

test('oil routes to the plumber, like gas', () => {
    const tag = { id: '4', label: 'Oil boiler servicing', regulated_concept: 'oil' };
    const message = blockedSkillReason(tag, 'handyman', false);
    assert.match(message, /OFTEC/);
    assert.match(message, /Plumber/);
});

// "Needs proof" was the first wording, and it tells somebody nothing: not what
// proof, not why, and not what to do instead. Every version of this message
// has to carry all three.
test('every routed message names the registration, the trade, and where to list it', () => {
    const cases = [
        { concept: 'gas', body: /Gas Safe/, where: /Plumber/ },
        { concept: 'oil', body: /OFTEC/, where: /Plumber/ },
        { concept: 'electrical', body: /Part P/, where: /Electrician/ },
    ];

    for (const c of cases) {
        const message = blockedSkillReason(
            { id: 'x', label: 'Something', regulated_concept: c.concept },
            'handyman',
            false
        );

        assert.match(message, c.body, c.concept + ' names the registration');
        assert.match(message, c.where, c.concept + ' says where to list it');
        assert.match(message, /handyman/, c.concept + ' says who is not asked for it');
        assert.equal(/needs proof/i.test(message), false, c.concept + ' does not just say "needs proof"');
    }
});

// --- the type-ahead, which IS the mechanism --------------------------------

const POOL = [
    { id: 'a', label: 'Bricklaying', slug: 'bricklaying' },
    { id: 'b', label: 'Block paving', slug: 'block paving' },
    { id: 'c', label: 'Fencing', slug: 'fencing' },
    { id: 'd', label: 'Brickwork', slug: 'brickwork', merged_into: 'a' },
];

test('typing a space-separated version finds the joined-up tag', () => {
    // The single most important case: without this, "brick laying" becomes its
    // own tag and the fragmentation has already happened.
    const found = suggestSkills(POOL, 'brick laying', []).map((s: any) => s.label);
    assert.equal(found.indexOf('Bricklaying') !== -1, true);
});

test('a merged tag is never offered back', () => {
    // Offering both halves of a merge would undo the tidying.
    const found = suggestSkills(POOL, 'brick', []).map((s: any) => s.label);
    assert.equal(found.indexOf('Brickwork'), -1);
});

test('a tag they already hold is not offered again', () => {
    const found = suggestSkills(POOL, 'brick', ['Bricklaying']).map((s: any) => s.label);
    assert.equal(found.indexOf('Bricklaying'), -1);
});

test('the closest match comes first', () => {
    const found = suggestSkills(POOL, 'block', []).map((s: any) => s.label);
    assert.equal(found[0], 'Block paving');
});

test('nothing typed offers nothing', () => {
    assert.deepEqual(suggestSkills(POOL, '', []), []);
});

test('a new tag is only new when nothing matches', () => {
    assert.equal(wouldCreateNew(POOL, 'bricklaying'), false);
    assert.equal(wouldCreateNew(POOL, 'brick laying'), false, 'the space is not a new tag');
    assert.equal(wouldCreateNew(POOL, 'Bricklaying'), false);
    assert.equal(wouldCreateNew(POOL, 'dry stone dyking'), true);
});

// --- who is asked at all ---------------------------------------------------

const { asksAboutSkills } = require('@/lib/serviceProviders');

test('only the handyman is asked for skills', () => {
    // A roofer's work is a roof and a joiner's is joinery — both already said
    // by the trade and the offerings, so a tag box there is a blank field to
    // fill in for no gain. This was briefly on all six maintenance trades and
    // was friction on five of them.
    assert.equal(asksAboutSkills('handyman'), true);

    for (const trade of ['electrician', 'joiner', 'plumber', 'roofer', 'painter']) {
        assert.equal(asksAboutSkills(trade), false, trade + ' is not asked for skills');
    }
});

test('the trades outside maintenance are not asked either', () => {
    for (const trade of ['sponge', 'bin', 'trees', 'droplet', 'cake', 'chef']) {
        assert.equal(asksAboutSkills(trade), false, trade + ' is not asked for skills');
    }
});
