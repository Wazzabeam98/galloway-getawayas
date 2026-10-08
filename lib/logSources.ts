// The source an information entry is written under in error_log (lib/logError's
// logInfo). The /admin/errors list, the morning digest and the export leave
// these rows out, so something that happened on purpose (an admin assigned a
// category, a sign-in ran its normal course) is still recorded without reading
// as a failure. "Information" on /admin/errors shows them.
//
// Its own module so readers can import it without loading the logger.
export const INFO_SOURCE = 'info';
