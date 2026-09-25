// API-072 — DELETE /api/team/invitations/[id]
import { withBoot } from '@/server/boot';
import { revokeInvitationHandler } from '@/server/modules/team/http';

export const DELETE = withBoot(revokeInvitationHandler);
