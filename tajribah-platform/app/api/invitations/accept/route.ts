// API-075 — POST /api/invitations/accept
import { withBoot } from '@/server/boot';
import { acceptInvitationHandler } from '@/server/modules/team/http';

export const POST = withBoot(acceptInvitationHandler);
