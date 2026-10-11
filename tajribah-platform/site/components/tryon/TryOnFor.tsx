'use client';

/**
 * T135 — the try-on a product opens: the studio (model photos, size comparison, the shopper's own photo), or — set to
 * "on the phone only" — the camera try-on on a phone and a QR code to continue on the phone on a computer.
 */
import { useSyncExternalStore } from 'react';
import Studio from '@site/components/studio/Studio';
import type { TryOnProduct } from '@site/lib/demo-product';
import type { StoreBrand } from '@site/lib/tryon-config';
import { kindOf, pairProductOf } from '@site/lib/pair-product';
import CameraTryOn from './CameraTryOn';
import PhoneQr from './PhoneQr';

const never = () => () => {};
const onAPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export default function TryOnFor({ product, brand = null, onClose, stageExtras = null, helpExtra = null, topbarExtra = null }: {
  product: TryOnProduct; brand?: StoreBrand | null; onClose?: () => void; stageExtras?: React.ReactNode; helpExtra?: React.ReactNode; topbarExtra?: React.ReactNode;
}) {
  const phone = useSyncExternalStore(never, onAPhone, () => false);
  if (!product.phoneOnly) return <Studio product={product} stageExtras={stageExtras} helpExtra={helpExtra} topbarExtra={topbarExtra} />;
  return phone ? <CameraTryOn product={pairProductOf(product)} brand={brand} kind={kindOf(product)} onClose={onClose} /> : <PhoneQr product={product} />;
}
