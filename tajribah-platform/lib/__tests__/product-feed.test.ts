/**
 * Products from a Google Merchant feed or a sheet: the attributes Merchant Center reads, variants as one
 * product, prices to minor units, quoting in CSV, and the first sheet of a real .xlsx workbook.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedProblem, parseDelimited, parseFeedText, parseLength, parsePrice, parseXmlFeed } from '@/lib/product-feed';
import { readXlsx } from '@/lib/xlsx';
import { RSS, workbook } from '@/server/testing/feed-fixtures';

test('a Google Merchant feed: variants are one product, the regular price, https pictures, Arabic kept', () => {
  const r = parseXmlFeed(RSS);
  assert.equal(r.rows, 4);
  assert.deepEqual(r.skipped, [{ row: 4, reason: 'no id' }]);
  assert.deepEqual(r.products.map((p) => [p.externalId, p.name, p.priceMinor, p.currency]), [
    ['W-1', 'ساعة فولاذية', 125000, 'SAR'],
    ['200', 'Arc lamp', 6000, 'SAR'],
  ], 'the group is one product, named by its first row; the sale price is not the price');
  const [watch, lamp] = r.products;
  assert.equal(watch!.nameAr, 'ساعة فولاذية');
  assert.equal(lamp!.nameAr, null);
  assert.equal(watch!.description, 'قطر 38 مم <b>فولاذ</b>', 'CDATA read as text');
  assert.equal(watch!.link, 'https://shop.example.sa/ar/p101?a=1&b=2', 'entities decoded');
  assert.deepEqual(watch!.images.map((i) => i.url), ['https://cdn.example.sa/101.jpg', 'https://cdn.example.sa/101-b.jpg']);
  assert.deepEqual(lamp!.images, [], 'a picture over plain http is not taken');
  assert.equal(lamp!.sku, 'ARC-1');
  assert.equal(feedProblem(r), null);
});

test('an Atom feed reads the same', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0">
    <entry><g:id>7</g:id><title>Ring</title><link href="https://shop.example.sa/r7"/><g:price>14.5 USD</g:price></entry></feed>`;
  const [ring] = parseFeedText(atom).products;
  assert.deepEqual([ring!.externalId, ring!.name, ring!.link, ring!.priceMinor, ring!.currency], ['7', 'Ring', 'https://shop.example.sa/r7', 1450, 'USD']);
});

test('prices: thousands and decimal commas, Arabic digits and the riyal sign; nonsense is no price', () => {
  assert.deepEqual(parsePrice('60.00 SAR'), { minor: 6000, currency: 'SAR' });
  assert.deepEqual(parsePrice('SAR 1,250'), { minor: 125000, currency: 'SAR' });
  assert.deepEqual(parsePrice('60,5'), { minor: 6050, currency: 'SAR' });
  assert.deepEqual(parsePrice('٣٥٠ ر.س'), { minor: 35000, currency: 'SAR' });
  assert.deepEqual(parsePrice('12.5 KWD'), { minor: 12500, currency: 'KWD' }, 'three minor digits');
  assert.equal(parsePrice('call us'), null);
  assert.equal(parsePrice(''), null);
});

test('a sheet: CSV with quotes and line breaks, TSV, Arabic or plain column names', () => {
  const csv = '﻿id,title,price,image_link,description\r\n1,"Lamp, brass",99.00 SAR,https://cdn.example.sa/1.jpg,"two\nlines ""quoted"""\r\n2,,10 SAR,,\r\n';
  const r = parseDelimited(csv);
  assert.deepEqual(r.products.map((p) => [p.externalId, p.name, p.priceMinor, p.description]), [['1', 'Lamp, brass', 9900, 'two\nlines "quoted"']]);
  assert.deepEqual(r.skipped, [{ row: 3, reason: 'no title' }], 'rows are numbered as the sheet shows them');
  const tsv = 'رقم المنتج\tاسم المنتج\tالسعر\n5\tخاتم فضة\t120\n';
  assert.deepEqual(parseFeedText(tsv).products.map((p) => [p.externalId, p.name, p.nameAr, p.priceMinor]), [['5', 'خاتم فضة', 'خاتم فضة', 12000]]);
  assert.match(feedProblem(parseFeedText('hello world'))!, /none of its|no products/);
  assert.match(feedProblem(parseFeedText(''))!, /no products found/);
});

test('an Excel workbook: its first sheet (whatever its file is called), shared and rich text, numbers, gaps', async () => {
  const rows = await readXlsx(await workbook([['id', 'title', 'price'], [11, 'Lamp & shade', 99.5], ['12', 'Bowl']]));
  assert.deepEqual(rows, [['id', 'title', 'price'], ['11', 'Lamp & shade', '99.5'], ['12', 'Bowl']]);
  await assert.rejects(() => readXlsx(new TextEncoder().encode('id,title\n1,x')), /not an Excel file/);
});


test('T72 sizes, when a feed has them: units to millimetres, a plain number is millimetres, nonsense is no size', () => {
  assert.equal(parseLength('20 cm'), 200);
  assert.equal(parseLength('8 in'), 203.2);
  assert.equal(parseLength('45'), 45);
  assert.equal(parseLength('0.3 m'), 300);
  assert.equal(parseLength('12,5 سم'), 125);
  assert.equal(parseLength('large'), null);
  assert.equal(parseLength('9 m'), null, 'over 3 metres is a unit mistake');
  const feed = `<rss xmlns:g="http://base.google.com/ns/1.0"><channel><item><g:id>1</g:id><g:title>Lamp</g:title><g:product_width>42 cm</g:product_width><g:product_height>165 cm</g:product_height></item><item><g:id>2</g:id><g:title>Vase</g:title></item></channel></rss>`;
  assert.deepEqual(parseFeedText(feed).products.map((p) => p.dimensions), [{ widthMm: 420, heightMm: 1650 }, null]);
  assert.deepEqual(parseDelimited('id,title,width,height'+String.fromCharCode(10)+'7,Bowl,120,80').products[0]!.dimensions, { widthMm: 120, heightMm: 80 }, 'a sheet: plain numbers in mm');
});
