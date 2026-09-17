/**
 * The one ecosystem session this app runs on.
 *
 * MoneyOS used to hold its own login token in localStorage. Now it shares the
 * ecosystem's session: the access token lives in memory, the refresh token is an
 * HttpOnly cookie on `.dileepadari.dev`, and signing in on any app in the
 * ecosystem signs you in here too.
 *
 * The gateway base comes from VITE_GATEWAY_URL, defaulting to the live API. The
 * app still calls MoneyOS's own edge function for its data - that function now
 * accepts these tokens - so only where the token comes from has changed, not
 * where the data lives.
 *
 * @module session
 */
import { createSessionClient } from '@completeos/auth-client';

const GATEWAY = import.meta.env.VITE_GATEWAY_URL ?? 'https://api.dileepadari.dev';

export const session = createSessionClient({ baseUrl: GATEWAY });

/** The gateway root, for the shared ecosystem assistant. */
export const GATEWAY_URL = GATEWAY;
