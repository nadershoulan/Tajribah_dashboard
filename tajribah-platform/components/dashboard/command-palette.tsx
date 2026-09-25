'use client';

/**
 * P1.23 — the command palette: Ctrl/⌘+K (or the search button) to jump to any screen the
 * role may open, or to a product by name, Arabic name or SKU.
 *
 * `cmdk` does the filtering, arrow keys and listbox semantics; a native `<dialog>` does the
 * modal part (focus trap, Escape, backdrop) without a second dialog library. Product search
 * goes to the server (P1.9's search), a quarter-second after typing stops.
 */
import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Package, Search } from 'lucide-react';
import { useEnv } from '@/lib/app-env';
import { currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useLang } from '@/lib/i18n';
import { visibleNav } from '@/lib/nav';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import type { ProductRow } from '@/lib/view-models';

/**
 * Plain "contains", case-insensitive. cmdk's default is fuzzy: "rose" matched "Store
 * connections" (r…o…s…e in order) and Enter opened the wrong thing.
 */
export function containsFilter(value: string, search: string): number {
  const needle = search.trim().toLowerCase();
  return !needle || value.toLowerCase().includes(needle) ? 1 : 0;
}

export function CommandPalette() {
  const { t, pick, lang } = useLang();
  const env = useEnv();
  const source = useData();
  const { me } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ q: string; rows: ProductRow[] }>({ q: '', rows: [] });

  const role = currentStore(me)?.role ?? 'viewer';
  const screens = visibleNav(ROLE_PERMISSIONS[role] ?? []);

  const open = () => { setQuery(''); dialog.current?.showModal(); };
  const close = () => dialog.current?.close();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      source.products({ q, limit: 6 }).then((page) => setFound({ q, rows: page.rows })).catch(() => setFound({ q, rows: [] }));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, source]);

  const go = (href: string) => { close(); env.navigate(href); };
  const products = found.q === query.trim() && query.trim().length >= 2 ? found.rows : [];

  return (
    <>
      <button type="button" className="icon-btn" onClick={open} aria-label={t('بحث سريع (Ctrl+K)', 'Quick search (Ctrl+K)')}>
        <Search size={17} />
      </button>
      <dialog ref={dialog} className="palette" aria-label={t('بحث سريع', 'Quick search')} onClick={(e) => { if (e.target === dialog.current) close(); }}>
        <Command label={t('بحث سريع', 'Quick search')} loop filter={containsFilter}>
          <Command.Input value={query} onValueChange={setQuery} autoFocus
            placeholder={t('اذهب إلى صفحة أو ابحث عن منتج…', 'Go to a screen, or find a product…')} />
          <Command.List>
            <Command.Empty>{t('لا نتائج.', 'No results.')}</Command.Empty>
            <Command.Group heading={t('الصفحات', 'Screens')}>
              {screens.map((item) => (
                <Command.Item key={item.id} value={`${item.label.ar} ${item.label.en}`} onSelect={() => go(item.href)}>
                  {pick(item.label)}
                </Command.Item>
              ))}
            </Command.Group>
            {products.length > 0 && (
              <Command.Group heading={t('المنتجات', 'Products')}>
                {products.map((p) => (
                  // The server already matched these; keep them whatever cmdk's own filter thinks.
                  <Command.Item key={p.id} value={`${query} ${p.name} ${p.nameAr ?? ''} ${p.sku ?? ''} ${p.id}`} onSelect={() => go(`/dashboard/products/${p.id}`)}>
                    <Package size={14} aria-hidden />
                    <span>{lang === 'ar' ? p.nameAr ?? p.name : p.name}</span>
                    {p.sku && <span className="palette-sku">{p.sku}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </dialog>
    </>
  );
}
