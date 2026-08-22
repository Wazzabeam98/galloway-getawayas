// Secrets that must never reach the browser.
//
// `config/Env.ts` is imported by client components — addhome, edit-listing,
// account, DeleteHomebtn, lib/utils — so everything in it is compiled into the
// JavaScript the browser downloads. That is correct for the NEXT_PUBLIC_
// values it holds and fatal for anything else.
//
// This is the server-side half of the same pattern. Only ever import it from a
// route handler or another server-only module. If a client component imports
// it, the value silently becomes an empty string in the bundle rather than
// leaking — but that is a broken feature, not a design.
export default class ServerEnv {
    // getAddress.io puts the key in the query string, so a browser-side call
    // would show it in the network tab to anyone who opened dev tools.
    static GETADDRESS_API_KEY: string = process.env.GETADDRESS_API_KEY || "";
}
