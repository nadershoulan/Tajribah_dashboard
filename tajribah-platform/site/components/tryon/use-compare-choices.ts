'use client';

/**
 * T140.1 — the store's other try-on products of this one's kind, for "compare on your photo": the store's shelf read
 * from the config host once the product is shown (the shop's try-on window and the product's own page). `where` is
 * read inside the effect — the address exists only in the browser.
 */
import { useEffect, useState } from 'react';
import { configBase, configUrl, isLocalHost, validRefs } from '@site/lib/tryon-config';
import { SHELF_REF, compareChoices, shelfFrom, type Choice } from '@site/lib/shelf';
import type { TryOnProduct } from '@site/lib/demo-product';

export function useCompareChoices(current: TryOnProduct | null, where: () => { store: string; ref: string | null; base: string | null } | null): Choice[] {
  const [choices, setChoices] = useState<Choice[]>([]);
  useEffect(() => {
    const at = current ? where() : null;
    if (!current || !at || !validRefs(at.store, SHELF_REF)) return;
    const local = isLocalHost(location.hostname);
    const url = configUrl(configBase(at.base ?? (local ? `${location.origin}/v1` : null), local), at.store, SHELF_REF);
    let live = true;
    fetch(url, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (live) setChoices(compareChoices(shelfFrom(json, local), current, at.ref)); })
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  return choices;
}
