// Are the two databases actually the same shape?
//
// WHY THIS EXISTS
//
// Every migration on this project is applied by hand, across a dozen sessions,
// to two databases. Nothing compared them until 1 September 2026, and the
// honest position before that was "probably" — which is not a thing to find out
// during a launch.
//
// They were identical: 4,334 facts in `public` and every storage bucket and
// policy. This is the tool that said so, kept rather than thrown away, because
// the answer is only true until the next hand-applied migration.
//
//   node scripts/schema-diff.mjs
//
// Read-only on both. It runs everything through scripts/migrate.mjs, which is
// the only file allowed to hold a database URL and the only one that refuses
// to point at the wrong project.
//
// WHAT IT COMPARES
//
//   public   columns (type, nullability, default), indexes, constraints, RLS
//            flags, policies including USING and WITH CHECK, table grants,
//            COLUMN grants, functions and their SECURITY DEFINER flag,
//            triggers, views, extensions
//   storage  buckets with their size limit and MIME allowlist, and policies
//
// WHAT IT DOES NOT
//
//   auth and the other Supabase-managed schemas, which are theirs to keep in
//   step; data of any kind; and project SETTINGS — SMTP, auth rate limits,
//   the email allowance — which live in the dashboard rather than the database
//   and are the one place a real difference has actually been found.

import { execFileSync } from 'node:child_process';

const PUBLIC_SQL = `
select kind, ident, detail from (
  select 'column' as kind,
         table_name || '.' || column_name as ident,
         data_type || ' | null=' || is_nullable || ' | default=' || coalesce(column_default,'-') as detail
    from information_schema.columns where table_schema='public'
  union all
  select 'index', indexname, indexdef from pg_indexes where schemaname='public'
  union all
  select 'constraint', c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid)
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace where n.nspname='public'
  union all
  select 'rls', c.relname, c.relrowsecurity::text
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'
  union all
  select 'policy', tablename || '.' || policyname,
         cmd || ' roles=' || roles::text || ' using=' || coalesce(qual,'-') || ' check=' || coalesce(with_check,'-')
    from pg_policies where schemaname='public'
  union all
  select 'grant', table_name || ' ' || grantee || ' ' || privilege_type, ''
    from information_schema.role_table_grants
   where table_schema='public' and grantee in ('anon','authenticated','service_role')
  union all
  select 'colgrant', table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type, ''
    from information_schema.role_column_grants
   where table_schema='public' and grantee in ('anon','authenticated')
  union all
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'security_definer=' || p.prosecdef::text
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all
  select 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and not t.tgisinternal
  union all
  select 'view', table_name, '' from information_schema.views where table_schema='public'
  union all
  select 'extension', extname, extversion from pg_extension
  union all
  select 'bucket', id,
         'public=' || public::text || ' | limit=' || coalesce(file_size_limit::text,'-')
         || ' | mime=' || coalesce(array_to_string(allowed_mime_types, ','),'-')
    from storage.buckets
  union all
  select 'storage_policy', tablename || '.' || policyname,
         cmd || ' roles=' || roles::text || ' using=' || coalesce(qual,'-') || ' check=' || coalesce(with_check,'-')
    from pg_policies where schemaname='storage'
) f order by kind, ident
`;

function snapshot(targetName) {
    const out = execFileSync(
        process.execPath,
        ['scripts/migrate.mjs', '--target', targetName, '--sql', PUBLIC_SQL],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    // migrate.mjs prints a banner before the JSON.
    const start = out.indexOf('[');
    if (start < 0) throw new Error('no rows came back for ' + targetName + ':\n' + out.slice(0, 400));
    return JSON.parse(out.slice(start, out.lastIndexOf(']') + 1));
}

const key = (r) => r.kind + ' :: ' + r.ident;

console.log('\n  reading production…');
const prod = snapshot('prod');
console.log('  reading test…');
const test = snapshot('test');

const P = new Map(prod.map((r) => [key(r), r.detail]));
const T = new Map(test.map((r) => [key(r), r.detail]));

const onlyProd = [...P.keys()].filter((k) => !T.has(k)).sort();
const onlyTest = [...T.keys()].filter((k) => !P.has(k)).sort();
const differ = [...P.keys()].filter((k) => T.has(k) && String(P.get(k)) !== String(T.get(k))).sort();

const perKind = {};
prod.forEach((r) => { perKind[r.kind] = (perKind[r.kind] || 0) + 1; });

const rule = '  ' + '-'.repeat(68);
console.log('\n' + rule);
console.log('  COMPARED — ' + prod.length + ' facts on production, ' + test.length + ' on test');
console.log(rule);
Object.keys(perKind).sort().forEach((k) => console.log('    ' + k.padEnd(16) + perKind[k]));

function report(title, keys, detail) {
    if (!keys.length) return;
    console.log('\n  ' + title + ' (' + keys.length + ')');
    keys.slice(0, 40).forEach((k) => {
        console.log('      ' + k);
        if (detail) {
            console.log('          production: ' + String(P.get(k)).slice(0, 120));
            console.log('          test:       ' + String(T.get(k)).slice(0, 120));
        }
    });
    if (keys.length > 40) console.log('      …and ' + (keys.length - 40) + ' more');
}

report('ONLY ON PRODUCTION', onlyProd, false);
report('ONLY ON TEST', onlyTest, false);
report('DIFFERENT DEFINITION', differ, true);

const total = onlyProd.length + onlyTest.length + differ.length;

console.log('\n' + rule);
if (total === 0) {
    console.log('  IDENTICAL. Nothing only on one, nothing defined differently.');
} else {
    console.log('  ' + total + ' difference' + (total === 1 ? '' : 's') + '.'
        + ' Decide which database is right before the next migration.');
}
console.log(rule + '\n');

process.exit(total === 0 ? 0 : 1);
