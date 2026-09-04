import { loadEnv, assertTestEnvironment, sessionCookieViaApp } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';
const env = loadEnv(); assertTestEnvironment(env);
const SITE = process.env.SITE || LOCAL_URL;
const ME = 'liamworrall18@hotmail.com';
const cookie = await sessionCookieViaApp(env, ME, SITE);
const res = await fetch(SITE + '/', { headers: { Cookie: cookie }, redirect: 'manual' });
const html = await res.text();
const has = (s) => html.includes(s);
console.log('GET / (home card) as ' + ME + '  status ' + res.status + '\n');
console.log('what3words on card        :', has('///daisy.harbour.lantern') ? 'YES' : 'NO');
console.log('real cottage photo        :', has('mkt-cottage') ? 'YES (mkt-cottage.png)' : 'NO');
console.log('square photo frame        :', has('md:aspect-square') ? 'YES (md:aspect-square)' : 'NO');
console.log('quarter-width photo column:', has('md:w-1/4') ? 'YES (md:w-1/4)' : 'NO');
console.log('details take the rest     :', has('md:w-3/4') ? 'YES (md:w-3/4)' : 'NO');
console.log('old tall-slab class gone  :', !has('md:min-h-[26rem]') ? 'YES' : 'STILL THERE');
console.log('Get directions            :', has('Get directions') ? 'YES' : 'no');
// The invite sheet lives in TripGroup on the card. Its collapsed row carries the
// "You" chip and one of these labels.
console.log('invite/group row on card  :', (has('Manage the group') || has('to fill') || has('coming with you')) ? 'YES' : 'NO');
