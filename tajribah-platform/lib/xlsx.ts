/**
 * The first sheet of an Excel workbook (.xlsx) as rows of text — enough to import a product sheet,
 * with no dependency: an .xlsx file is a zip of XML parts, and the runtime unzips (DecompressionStream
 * 'deflate-raw', in Workers and Node alike). Read: the zip's central directory, the workbook's first
 * sheet, its shared strings, and each cell's value (shared, inline or plain). Formulas give their last
 * computed value, as Excel saved it. Anything else (styles, other sheets, charts) is ignored.
 */
import { decodeXml } from './product-feed';

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

type Entry = { method: number; size: number; offset: number };

/** The zip's files by name, from its central directory. */
function entries(zip: Uint8Array): Map<string, Entry> {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_558); i--) if (u32(zip, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not an Excel file (.xlsx)');
  const count = u16(zip, end + 10);
  let at = u32(zip, end + 16);
  const found = new Map<string, Entry>();
  for (let n = 0; n < count && u32(zip, at) === 0x02014b50; n++) {
    const nameLength = u16(zip, at + 28), extra = u16(zip, at + 30), comment = u16(zip, at + 32);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    found.set(name, { method: u16(zip, at + 10), size: u32(zip, at + 20), offset: u32(zip, at + 42) });
    at += 46 + nameLength + extra + comment;
  }
  return found;
}

async function read(zip: Uint8Array, entry: Entry): Promise<string> {
  if (u32(zip, entry.offset) !== 0x04034b50) throw new Error('the Excel file is damaged');
  const start = entry.offset + 30 + u16(zip, entry.offset + 26) + u16(zip, entry.offset + 28);
  const data = zip.subarray(start, start + entry.size);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error('the Excel file uses a compression this reader does not know');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** "BC12" → 54 (zero-based column). */
function columnOf(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Every text run (<t>) of a string item, joined — rich text splits one value into several runs. */
const textOf = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('');

export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = entries(bytes);
  const part = async (name: string) => { const e = files.get(name); return e ? read(bytes, e) : null; };
  // The first sheet in the workbook's order (not necessarily sheet1.xml).
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = await part('xl/workbook.xml');
  const rels = await part('xl/_rels/workbook.xml.rels');
  const firstId = workbook ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1] : undefined;
  const target = firstId && rels ? new RegExp(`<Relationship\\b[^>]*Id="${firstId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstId}"`).exec(rels)?.[1] : undefined;
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = await part(sheetPath);
  if (!sheet) throw new Error('the Excel file has no sheet');
  const shared = [...((await part('xl/sharedStrings.xml')) ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!, body = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? textOf(body) : v !== undefined ? decodeXml(v) : '';
      const at = ref ? columnOf(ref) : row.length;
      while (row.length < at) row.push('');
      row[at] = value;
    }
    if (row.some((v) => v !== '')) rows.push(row);
  }
  return rows;
}
