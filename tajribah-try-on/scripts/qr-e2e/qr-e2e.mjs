// How to run (README "Phone hand-off on this machine"): build, start the built worker with a SHORT
// --persist-to path, then `node scripts/qr-e2e/qr-e2e.mjs` from the site's folder.
// The phone hand-off end to end on the built site: the computer opens the QR in "On me", a phone page
// (/capture/{id}, phone-sized) sends a real wrist photo, and the computer's studio receives it.
// Records security-policy violations on both pages.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SP = process.env.OUT ?? path.join(process.cwd(), '.qr-e2e'); // screenshots and a throwaway Chrome profile
const site = 'http://127.0.0.1:8798';
const wrist = path.join(process.cwd(), 'public/assets/model-wrist.webp'); // the studio's own real wrist photo
const port = 9397;
const profile = path.join(SP, 'chrome-qr');
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tab() {
  let target;
  for (let i = 0; i < 50 && !target; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const errors = []; const responses = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/pair')) responses.push({ id: m.params.requestId, url: m.params.response.url, status: m.params.response.status });
  });
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('DOM.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ← ' + (e.blockedURI || 'inline')));` });
  const press = async (re, sel = 'button, [role=tab]') => {
    const box = await evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => ${re}.test(x.textContent || x.getAttribute('aria-label') || '')); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!box) return false;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(1200);
    return true;
  };
  const shot = async (name) => { const png = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SP, 'shots', `${name}.png`), Buffer.from(png.result.data, 'base64')); };
  return { send, evaluate, press, shot, errors, responses, ws };
}

fs.mkdirSync(path.join(SP, 'shots'), { recursive: true });
const computer = await tab();
await computer.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
await computer.send('Page.navigate', { url: `${site}/demo` }); await sleep(7000);
await computer.press(/^عليّ|On me/);
await computer.press(/جوال|phone|QR/i, '.studio-root button');
await sleep(5000);
const created = computer.responses.find((r) => r.status === 201);
const body = created ? JSON.parse((await computer.send('Network.getResponseBody', { requestId: created.id })).result.body) : null;
const qr = await computer.evaluate(`document.querySelector('img[alt*="امسح"], img[alt*="Scan"]')?.src?.slice(0, 22) ?? null`);
await computer.shot('qr-1-computer');

const phone = await tab();
await phone.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await phone.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
await phone.send('Page.navigate', { url: `${site}/capture/${body?.id}` }); await sleep(5000);
const { root } = (await phone.send('DOM.getDocument', { depth: -1 })).result;
const inputs = (await phone.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' })).result.nodeIds;
await phone.send('DOM.setFileInputFiles', { nodeId: inputs[inputs.length - 1], files: [wrist] });
await sleep(2500);
await phone.shot('qr-2-phone-chosen');
await phone.press(/أرسل|Send/);
await sleep(4000);
const phoneText = await phone.evaluate(`document.body.innerText.slice(0, 300)`);
await phone.shot('qr-3-phone-sent');

await sleep(8000); // the computer polls, receives the photo, hand detection places the watch
await computer.shot('qr-4-computer-received');
const computerText = await computer.evaluate(`document.querySelector('.studio-root')?.innerText.slice(0, 200)`);
const photoTaken = await computer.responses.some((r) => /\/api\/pair\/[a-f0-9]{32}\?image=1/.test(r.url) && r.status === 200);
console.log(JSON.stringify({
  session: body?.id ?? null, qrShown: qr, phoneText, photoReceivedByComputer: photoTaken, pairCalls: computer.responses.map((r) => `${r.status} ${r.url.replace(site, '')}`),
  phonePairCalls: phone.responses.map((r) => `${r.status} ${r.url.replace(site, '')}`),
  violations: { computer: await computer.evaluate('window.__csp'), phone: await phone.evaluate('window.__csp') },
  errors: { computer: computer.errors, phone: phone.errors }, computerText,
}, null, 1));
computer.ws.close(); phone.ws.close(); chrome.kill(); process.exit(0);
