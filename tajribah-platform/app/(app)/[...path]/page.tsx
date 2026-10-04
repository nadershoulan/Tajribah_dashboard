// Every dashboard and sign-in screen. The screen for a path comes from components/routes.tsx,
// shared with the static preview; `app/api/**` route handlers take precedence over this.
// The session and language providers live in app/layout.tsx, which survives navigation.
import { NextScreen } from '@/components/next-shell';

export default function Page() {
  return <NextScreen />;
}
