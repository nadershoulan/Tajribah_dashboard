# One domain and its subdomains — and testing the QR on your Wi-Fi

Tajribah runs on **one domain, `tajribah.org`**, with a few subdomains for the parts that must live
apart. This page says what each address serves, how to set them up, and how to test everything —
including scanning QR codes with your phone — on your own computer first.

## 1. What each address serves

| Address | What it serves | Why it is separate |
|---|---|---|
| **`tajribah.org`** | Everything a person opens: the website (`/`), sign-in (`/login`), the dashboard (`/dashboard`), the staff console (`/admin`), products' own pages (`/p/{store}/{product}`), the try-on that opens over a shop (`/embed/try-on`), the phone page for "try it on me" (`/capture/…`), and the API (`/api/…`) | — one Worker, one deploy |
| **`cdn.tajribah.org`** | Files: 3D models, try-on pictures, the shop script (`/w/v1/widget.js`) | Cached for a long time, close to shoppers; no cookies |
| **`cfg.tajribah.org`** | Each published product's settings (`/v1/{store}/{product}.json`), read by shops millions of times | Must never wait on the database; a tiny Worker reading KV |
| **`ev.tajribah.org`** | Shop visits and clicks (`/v1/e`) | Shops send to it from every page; kept off the main domain |
| **`domains.tajribah.org`** | Nothing to open — the name an Enterprise store points its own domain at (CNAME) | The target for stores' own addresses (T62) |
| a store's own domain (Enterprise) | That store's try-on and products' pages only, e.g. `ar.oud.sa/p/…` | Its own name on its own pages |

One Worker serves `tajribah.org`. `cfg.` is its own small Worker, `cdn.` is the storage bucket, and `ev.`
is a route to the main Worker. The code's defaults already use these names, so nothing needs setting
for them unless you choose others.

### Setting it up (when the domain is bought)

The step-by-step with checks is `docs/GO-LIVE.md`. In short:
1. `tajribah.org` is already a Cloudflare zone (bought through Cloudflare's registrar, 2026-10-07): nothing to add.
2. Point **`tajribah.org`** at the main Worker. Set `APP_URL=https://tajribah.org` and
   `SITE_HOSTS=tajribah.org`.
3. Give the storage bucket the custom domain **`cdn.tajribah.org`**. Set `CDN_BASE_URL` to it.
4. Deploy the config Worker on **`cfg.tajribah.org`**, bound to the same KV namespace (`CONFIGS`).
5. Route **`ev.tajribah.org/v1/e`** to the main Worker.
6. Products' own pages: `HOSTED_PAGE_BASE=https://tajribah.org/p` (the default). If you later buy a
   short domain for QR codes, point it at the main Worker and set `HOSTED_PAGE_BASE` to it **before**
   any code is printed. A printed code never changes, which is why the dashboard only offers codes to
   print once the address is final.

## 2. Everything on your own computer

`~/tajribah-local` has the start scripts (see its README):

```sh
bash start-storage.sh        # pictures and 3D models — first, in its own window
bash start-dashboard.sh      # then the platform: http://127.0.0.1:8799
bash start-worker.sh         # and the worker: checks try-on pictures, optimises 3D models
```

On this computer, the one domain is `http://127.0.0.1:8799`. The subdomains are stood in for so that
everything works with no Cloudflare account:

| Live | On your computer |
|---|---|
| `tajribah.org` | `http://127.0.0.1:8799` (the same Worker, built the same way) |
| `cdn.tajribah.org` | `http://127.0.0.1:8333/tajribah-local` (SeaweedFS, an S3 server) |
| `cfg.tajribah.org` | `http://127.0.0.1:8799/v1/…`: the main Worker answers it, **on a local address only** |
| `ev.tajribah.org` | `http://127.0.0.1:8799/v1/e` (the same route) |

These local stand-ins switch on only for addresses that can't be a public site: `localhost`,
`127.0.0.1`, and private Wi-Fi addresses (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`). On
`tajribah.org` none of them exist.

## 3. Testing the QR with your phone

A phone can't open `127.0.0.1` (that is the phone itself). So the computer serves on its **Wi-Fi
address** instead, and the phone opens that, on the same Wi-Fi.

1. Connect the computer and the phone to the **same Wi-Fi**.
2. Start both in Wi-Fi mode:
   ```sh
   bash start-storage.sh lan
   bash start-dashboard.sh lan
   ```
   The dashboard prints the address to use, for example `Open http://192.168.100.8:8799`. The first
   time, Windows may ask whether to allow Node (and `weed.exe`) on the network: allow **private
   networks**.
3. On the computer, open that address, **not** `127.0.0.1`. The QR codes carry the address the page was
   opened at.
4. **A product's own page.** Sign in, publish a product (AR settings → "انشر في المتجر"), then open
   **رموز QR**. It says "للتجربة على شبكتك فقط" (for testing on your network only): the codes point at
   this computer, so they can be scanned but not printed or downloaded. Scan one with the phone's camera.
   The product page opens on the phone, and the visit counts as "from a QR code".
   - A product published while the dashboard ran on `127.0.0.1` keeps its pictures' `127.0.0.1`
     address, which the phone can't reach. Press "انشر في المتجر" again in Wi-Fi mode.
5. **"Try it on me" (the studio's phone QR).** Open `/demo` on the computer (or a published product's
   page), choose **عليّ** ("on me"), and scan the code it shows. The phone opens `/capture/…`; take or
   choose a photo, and it appears on the computer. This works over plain http because the phone page
   uses the phone's own camera picker.

**Seen on 2026-10-05** (computer at `192.168.100.8`): a product page opened at that address with its
pictures; the QR page showed scannable test codes with no download; the phone-to-computer photo
went through whole (52,501 of 52,501 bytes).

When you're done, start the scripts without `lan` again. Then nothing listens on the network.
