/** The viewer config every widget test starts from (a plain module, so importing it registers no tests). */
export const GOOD = {
  v: 1,
  product: { name: 'Oyster 41', nameAr: 'أويستر 41', widthMm: 41, heightMm: 48 },
  model: { glb: 'https://cdn.example.test/m/v1/optimized.glb', usdz: null },
  button: { labelAr: 'شاهدها في مكانك', labelEn: 'View in your space', color: '#0B7A75', radius: 12, variant: 'solid', icon: true },
  placement: 'wrist', scale: 1, autoRotate: true, shadow: 1,
};
