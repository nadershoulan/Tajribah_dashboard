'use client';

import { useLang } from '@/lib/i18n';
import type { StoreBrand } from '@/lib/tryon-config';

/** T61 — white-label: the store's logo, or its name when it has none, where Tajribah's would be. */
export function StoreMark({ brand, className = '' }: { brand: StoreBrand; className?: string }) {
  const { t } = useLang();
  const name = t(brand.name.ar, brand.name.en);
  return (
    <span className={'store-mark ' + className}>
      {brand.logo ? <img src={brand.logo} alt={name} /> : name}
    </span>
  );
}
