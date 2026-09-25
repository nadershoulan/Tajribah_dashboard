/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setEmailSender } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb } from '@/server/testing/harness';
import { meHandler, registerHandler } from '@/server/modules/auth/http';
import { acceptInvitationHandler, changeRoleHandler, inviteHandler, listTeamHandler, removeMemberHandler } from '@/server/modules/team/http';

setLogLevel('error');
const APP = 'http://localhost:5173';
const sent: any[] = [];

async function signUp(email: string, storeName: string) {
  const response = await registerHandler(new Request(`${APP}/api/auth/register`, {
    method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'a-long-enough-password', fullName: email.split('@')[0], storeName }),
  }));
  const body = await response.json() as any;
  return { auth: { authorization: `Bearer ${body.accessToken}`, origin: APP }, tenantId: body.tenant.id };
}
const call = (handler: any, path: string, auth: any, method = 'GET', body?: unknown) =>
  handler(new Request(`${APP}${path}`, { method, headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));

test('over HTTP: invite by email, accept into the store, change the role, remove — and the refusals', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  setEmailSender({ async send(message: any) { sent.push(message); } } as any);
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  const original = console.log;
  try {
    console.log = () => {};
    const owner = await signUp('owner@example.test', 'Oud');
    const sara = await signUp('sara@example.test', 'Sara own store');
    console.log = original;

    const invited = await call(inviteHandler, '/api/team/invitations', owner.auth, 'POST', { email: 'sara@example.test', role: 'editor', lang: 'en' });
    assert.equal(invited.status, 201);
    assert.match(sent.at(-1).subject, /You are invited/, 'the language travels through the endpoint');
    assert.ok(!JSON.stringify(await invited.json()).includes('token'), 'the token travels only in the email');
    const token = sent.find((m) => m.to === 'sara@example.test' && m.text.includes('/invite/'))!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];
    assert.ok(sent.at(-1).text.includes(`${APP}/invite/`));
    assert.equal((await call(inviteHandler, '/api/team/invitations', owner.auth, 'POST', { email: 'kim@example.test', role: 'viewer', lang: 'fr' })).status, 422);

    const accepted = await call(acceptInvitationHandler, '/api/invitations/accept', sara.auth, 'POST', { token });
    assert.equal(accepted.status, 200);
    const switched = await accepted.json() as any;
    assert.equal(switched.tenantId, owner.tenantId, 'the session now acts for the joined store');
    const saraInOud = { authorization: `Bearer ${switched.accessToken}`, origin: APP };
    assert.equal((await meHandler(new Request(`${APP}/api/auth/me`, { headers: saraInOud }))).status, 200);

    const team = (await (await call(listTeamHandler, '/api/team', owner.auth)).json() as any).members;
    const saraRow = team.find((m: any) => m.email === 'sara@example.test');
    assert.deepEqual([saraRow.role, saraRow.status], ['editor', 'active']);

    assert.equal((await call(changeRoleHandler, `/api/team/members/${saraRow.id}`, saraInOud, 'PATCH', { role: 'viewer' })).status, 403, 'an editor cannot manage the team');
    assert.equal((await call(changeRoleHandler, `/api/team/members/${saraRow.id}`, owner.auth, 'PATCH', { role: 'analyst' })).status, 204);
    assert.equal((await call(removeMemberHandler, `/api/team/members/${saraRow.id}`, owner.auth, 'DELETE')).status, 204);
    assert.equal((await call(listTeamHandler, '/api/team', saraInOud)).status, 404, 'removed: the store no longer exists for her');

    assert.equal((await call(acceptInvitationHandler, '/api/invitations/accept', sara.auth, 'POST', { token })).status, 404, 'the link was used');
    assert.equal((await call(listTeamHandler, '/api/team', {})).status, 401);
    assert.equal((await call(inviteHandler, '/api/team/invitations', { ...owner.auth, origin: 'https://evil.example' }, 'POST', { email: 'x@example.test', role: 'viewer' })).status, 403);
    assert.equal((await call(removeMemberHandler, '/api/team/members/not-a-uuid', owner.auth, 'DELETE')).status, 404);
  } finally { console.log = original; await harness.close(); resetEnv(); }
});
