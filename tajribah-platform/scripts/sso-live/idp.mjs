/**
 * P8 — a real OpenID Connect provider for trying single sign-on end to end on this machine:
 * panva's `oidc-provider` (certified by the OpenID Foundation), with its development sign-in pages.
 * Anyone may sign in as any address — it is a throwaway local provider, never a real one.
 *
 *   pnpm add oidc-provider            (in a scratch folder)
 *   node scripts/sso-live/idp.mjs     (from that folder's node_modules: NODE_PATH or a copy)
 *
 * See docs/SSO-LIVE.md for the whole recipe and the live test that drives it.
 */
import Provider from 'oidc-provider';

const port = Number(process.env.PORT ?? 9500);
const issuer = `http://localhost:${port}`;

const provider = new Provider(issuer, {
  clients: [{
    client_id: 'tajribah', client_secret: 'idp-client-secret',
    redirect_uris: ['https://app.tajribah.sa/login/sso'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'client_secret_basic',
  }],
  pkce: { required: () => true },
  claims: { openid: ['sub'], email: ['email', 'email_verified'], profile: ['name'] },
  // The email in the ID token itself, as Entra, Google and Okta put it there.
  conformIdTokenClaims: false,
  // The development sign-in page's login becomes the account id, which the provider uses as the subject.
  async findAccount(_ctx, id) {
    return { accountId: id, async claims() { return { sub: id, email: id, email_verified: true, name: id.split('@')[0] }; } };
  },
  features: { devInteractions: { enabled: true } },
});

provider.listen(port, () => console.log(`oidc-provider ready at ${issuer}`));
