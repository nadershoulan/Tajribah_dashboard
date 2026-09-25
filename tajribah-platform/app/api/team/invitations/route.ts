// API-071 — POST /api/team/invitations
import { withBoot } from '@/server/boot';
import { inviteHandler } from '@/server/modules/team/http';

export const POST = withBoot(inviteHandler);
