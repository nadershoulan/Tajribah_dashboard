# Trying single sign-on against a real OpenID Connect provider

The everyday tests use a stand-in provider (`server/testing/oidc-provider.ts`, real ES256 keys). This is
how to sign in through a real one instead — panva's `oidc-provider`, certified by the OpenID
Foundation — on this machine, with no account anywhere.

```sh
# 1. A real provider on http://localhost:9500, with one client (tajribah / idp-client-secret), PKCE
#    required, and development sign-in pages where any address may sign in (a throwaway provider).
mkdir oidc && cd oidc && pnpm add oidc-provider
cp ../scripts/sso-live/idp.mjs . && node idp.mjs

# 2. The live test (skipped whenever SSO_LIVE_ISSUER is not set):
SSO_LIVE_ISSUER=http://localhost:9500 node scripts/test.mjs --modules node_modules sso-live
```

The test plays the browser at the provider (its sign-in and consent pages, over HTTP) and runs the
real server code on both sides of it: the store's settings (discovery must answer), the start (a
flow cookie, PKCE, a nonce), and the return (the code exchanged once, the ID token verified against the
provider's published keys). Plain http is accepted only here, for a provider on this machine, through
an option nothing in the app sets.

## Last run (2026-09-30)

oidc-provider 9.12.2 (RS256 development keys). Passed: a member of the store signed in at the
provider's pages and came back with a session for that store only, linked by the provider's subject;
the same code a second time was refused (the provider had spent it); someone the provider vouched for
who is not a member of the store was refused.
