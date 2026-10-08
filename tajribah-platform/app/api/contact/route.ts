// API-200 — POST /api/contact: the website's contact form (T115)
import { withBoot } from '@/server/boot';
import { contactHandler } from '@/server/modules/contact/http';

export const POST = withBoot(contactHandler);
