// Lets a test load a route module with its dependencies replaced.
//
// Two problems to solve. TypeScript leaves the '@/...' import paths alone when
// it emits, so they have to be resolved at require time; and a route reaches
// for Supabase, Stripe and email, none of which should be touched by a test.

import Module from 'node:module';
import path from 'node:path';

const BUILD_ROOT = path.resolve(__dirname, '..', '..');

const original = (Module as any)._resolveFilename;
let installed = false;

// Map '@/lib/thing' onto the compiled file, the way Next's bundler would.
export function installAliases(): void {
    if (installed) return;
    installed = true;
    (Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
        if (request.startsWith('@/')) {
            return original.call(this, path.join(BUILD_ROOT, request.slice(2)), ...rest);
        }
        return original.call(this, request, ...rest);
    };
}

// Force `require(request)` to hand back these exports instead of the real ones.
export function stubModule(request: string, exports: any): void {
    installAliases();
    const resolved = request.startsWith('@/')
        ? require.resolve(path.join(BUILD_ROOT, request.slice(2)))
        : require.resolve(request);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as any;
}

export function clearModule(request: string): void {
    const resolved = request.startsWith('@/')
        ? require.resolve(path.join(BUILD_ROOT, request.slice(2)))
        : require.resolve(request);
    delete require.cache[resolved];
}

// A stand-in for the Supabase client. Every query builder method chains, and
// awaiting the chain gives back whatever `result` says — so a test can make a
// particular table's read fail without a database anywhere near it.
export function fakeSupabase(handlers: Record<string, any>) {
    const calls: any[] = [];

    function builder(table: string) {
        const state: any = { table, ops: [] };
        const chain: any = new Proxy(
            {},
            {
                get(_t, prop: string) {
                    if (prop === 'then') {
                        const result = handlers[table] ?? { data: [], error: null };
                        const value = typeof result === 'function' ? result(state) : result;
                        return (resolve: any) => resolve(value);
                    }
                    return (...args: any[]) => {
                        state.ops.push({ op: prop, args });
                        return chain;
                    };
                },
            }
        );
        return chain;
    }

    return {
        calls,
        client: {
            from(table: string) {
                calls.push(table);
                return builder(table);
            },
        },
    };
}

// A stand-in for `admin.from(t).update(patch)` that behaves like the real
// builder: the write happens once, on the first `.eq`, and the result can be
// awaited straight away or narrowed further with more `.eq`s and a
// `.select(...)`. `run` is the fake write; with `.select` and no error, the
// written row comes back (as `[{ id }]`) unless `run` gave data of its own —
// which is how a compare-and-set that matched nothing is simulated
// (`data: []`).
// `run` also receives every further `.eq(column, value)` filter, so a fake can
// honour a guard only when the code under test actually asks for it.
export function updateChain(run: (id: any, filters: Array<[string, any]>) => Promise<{ data: any; error: any }>) {
    return {
        eq(_column: string, id: any) {
            const filters: Array<[string, any]> = [];
            let pending: Promise<{ data: any; error: any }> | null = null;
            const once = () => (pending = pending || Promise.resolve().then(() => run(id, filters)));
            const chain: any = {
                eq: (column: string, value: any) => { filters.push([column, value]); return chain; },
                in: () => chain,
                is: () => chain,
                select: () => ({
                    then(resolve: any, reject: any) {
                        return once().then(
                            (r) => ({ ...r, data: r.error ? null : (r.data ?? [{ id }]) }),
                        ).then(resolve, reject);
                    },
                }),
                then(resolve: any, reject: any) {
                    return once().then(resolve, reject);
                },
            };
            return chain;
        },
    };
}
