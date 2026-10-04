/**
 * Test fixtures for product feeds: a Merchant feed in the shape Salla publishes (test products), and a
 * real .xlsx workbook built from rows.
 */
/** The shape Salla's "Google Merchant" app publishes (RSS 2.0, `g:` attributes), with test products. */
export const RSS = `<?xml version='1.0' encoding='UTF-8'?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel><title>Product Feed</title>
  <item><g:id>101</g:id><g:title>ساعة فولاذية</g:title><g:description><![CDATA[قطر 38 مم <b>فولاذ</b>]]></g:description>
    <g:link>https://shop.example.sa/ar/p101?a=1&amp;b=2</g:link><g:image_link>https://cdn.example.sa/101.jpg</g:image_link>
    <g:additional_image_link>https://cdn.example.sa/101-b.jpg</g:additional_image_link>
    <g:price>1,250.00 SAR</g:price><g:sale_price>990.00 SAR</g:sale_price><g:item_group_id>W-1</g:item_group_id></item>
  <item><g:id>102</g:id><g:title>ساعة فولاذية — أسود</g:title><g:price>1250.00 SAR</g:price><g:item_group_id>W-1</g:item_group_id></item>
  <item><g:id>200</g:id><g:title>Arc lamp</g:title><g:price>60 SAR</g:price><g:image_link>http://insecure.example/x.jpg</g:image_link><g:mpn>ARC-1</g:mpn></item>
  <item><g:title>no id</g:title></item>
</channel></rss>`;


/** A minimal .xlsx: the parts Excel writes, zipped — one part deflated, the rest stored, as real files mix. */
export async function workbook(rows: (string | number)[][]): Promise<Uint8Array> {
  const shared: string[] = [];
  const cell = (v: string | number, ref: string) => typeof v === 'number'
    ? `<c r="${ref}"><v>${v}</v></c>`
    : `<c r="${ref}" t="s"><v>${shared.push(v) - 1}</v></c>`;
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet = `<worksheet><sheetData>${rows.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => cell(v, `${col(x)}${y + 1}`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const parts: [string, string, boolean][] = [
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Products" sheetId="1" r:id="rId7"/></sheets></workbook>', false],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/products.xml"/></Relationships>', false],
    ['xl/worksheets/products.xml', sheet, true],
    ['xl/sharedStrings.xml', `<sst>${shared.map((s) => `<si><r><t>${s.slice(0, 2)}</t></r><r><t xml:space="preserve">${s.slice(2).replace(/&/g, '&amp;')}</t></r></si>`).join('')}</sst>`, false],
  ];
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text, deflate] of parts) {
    const raw = enc.encode(text);
    const data = deflate ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()) : raw;
    const n = enc.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(8, deflate ? 8 : 0, true); local.setUint32(18, data.length, true); local.setUint32(22, raw.length, true); local.setUint16(26, n.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(10, deflate ? 8 : 0, true); dir.setUint32(20, data.length, true); dir.setUint32(24, raw.length, true); dir.setUint16(28, n.length, true); dir.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), n, data);
    central.push(new Uint8Array(dir.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, parts.length, true); end.setUint16(10, parts.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[]).arrayBuffer());
}

