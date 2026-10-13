import 'server-only';

/**
 * Server-side database access for the app.
 *
 * This is the import the app uses (`@/lib/db`) and it is guarded: pulling it
 * into a client component fails the build rather than leaking queries to the
 * browser.
 *
 * CLI scripts (seed, reset, tests) import `./db/core` directly, because they
 * run outside Next's server bundle and the guard would reject them.
 */
export * from './core';
