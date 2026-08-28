// Deciding on a queue of things, once, for both queues.
//
// WHY THIS IS SHARED RATHER THAN COPIED
//
// There are two review queues now — service providers and host listings — and
// they ask the same questions of a batch: which of these ids may I decide on,
// what happens when one of them fails halfway through, and what do I tell the
// person who pressed the button.
//
// The provider route already answered those for one item at a time. Doing the
// same again for listings would have been the third copy of a decision loop in
// this repo, and the second screen written twice. It lives here instead, and
// both routes call it.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not know what approving *means*. That is different for the two —
// a provider gets a status and a digest, a listing gets a status and a
// published date — so each route passes in a function that decides one item and
// this walks the list. The shared part is the walking, the partial-failure
// rule, and the shape of the answer.

/** What happened to one id in a batch. */
export interface ItemOutcome {
    id: string;
    ok: boolean;
    /** Present when ok is false. Shown next to that row, not as a whole-page error. */
    error?: string;
    /** Whether the person was told. False is not a failure of the decision. */
    emailed?: boolean;
}

export interface BatchResult {
    ok: boolean;
    decided: number;
    failed: number;
    /** How many of the decided ones could not be emailed. */
    unemailed: number;
    outcomes: ItemOutcome[];
    /** One line fit to put in front of a person. */
    summary: string;
}

/** The most a single press may decide. Not a page size — a blast radius. */
export const MAX_BATCH = 50;

/**
 * Read a batch of ids off a request body that may name one or many.
 *
 * Both shapes are accepted on purpose: the existing provider screen posts a
 * single `id`, and the new bulk controls post `ids`. Accepting both means the
 * one-at-a-time buttons keep working unchanged while the same route gains bulk,
 * rather than there being two routes that must not disagree.
 *
 * Duplicates are collapsed, because a checkbox and a row button can both be
 * pressed for the same thing and deciding it twice is how a second email goes
 * out.
 */
export function idsFrom(body: any): string[] {
    const raw: any[] = Array.isArray(body && body.ids)
        ? body.ids
        : (body && body.id ? [body.id] : []);

    const seen: Record<string, true> = {};
    const out: string[] = [];

    for (const value of raw) {
        const id = String(value || '').trim();
        if (!id || seen[id]) continue;
        seen[id] = true;
        out.push(id);
    }

    return out;
}

/**
 * Decide each id in turn, and report on every one of them.
 *
 * ONE AT A TIME, NOT IN PARALLEL. Each decision reads a row, checks its status
 * and writes it back. Running them together would let two decisions on the same
 * underlying host or provider interleave, and the whole point of the status
 * check is that a click made against a stale screen is refused. Fifty of these
 * is a second or two; correctness is worth more than that here.
 *
 * A FAILURE DOES NOT STOP THE REST. Approving ten listings where the third has
 * already been approved by somebody else should approve the other nine and say
 * so. Stopping would leave the operator guessing which ones landed, which on a
 * launch morning is worse than a partial answer.
 */
export async function decideBatch(
    ids: string[],
    decideOne: (id: string) => Promise<{ ok: boolean; error?: string; emailed?: boolean }>
): Promise<BatchResult> {
    const outcomes: ItemOutcome[] = [];

    for (const id of ids) {
        try {
            const result = await decideOne(id);
            outcomes.push({ id, ok: result.ok !== false, error: result.error, emailed: result.emailed });
        } catch (err: any) {
            // A thrown error is one row's problem, not the batch's.
            outcomes.push({ id, ok: false, error: (err && err.message) || 'Something went wrong.' });
        }
    }

    const decided = outcomes.filter((o) => o.ok).length;
    const failed = outcomes.length - decided;
    const unemailed = outcomes.filter((o) => o.ok && o.emailed === false).length;

    return {
        // The batch succeeded if anything in it did. A caller wanting "all of
        // them" reads `failed`.
        ok: decided > 0,
        decided,
        failed,
        unemailed,
        outcomes,
        summary: summarise(decided, failed, unemailed),
    };
}

/**
 * The sentence an operator reads after pressing the button.
 *
 * Written here rather than in each screen so the two queues cannot describe the
 * same outcome differently — and because "9 approved, 1 failed" is the answer
 * that matters on a launch morning, not a green tick that hides the one.
 */
export function summarise(decided: number, failed: number, unemailed: number): string {
    if (decided === 0 && failed === 0) return 'Nothing to do.';

    const parts: string[] = [];

    if (decided > 0) parts.push(decided === 1 ? '1 done' : decided + ' done');
    if (failed > 0) parts.push(failed === 1 ? '1 failed' : failed + ' failed');

    let line = parts.join(', ') + '.';

    // Never folded into the counts. An approval that nobody was told about has
    // happened, and the person is still waiting to hear — that is worth its own
    // clause rather than a number nobody reads.
    if (unemailed > 0) {
        line += unemailed === 1
            ? ' 1 could not be emailed — they have not been told.'
            : ' ' + unemailed + ' could not be emailed — they have not been told.';
    }

    return line;
}
