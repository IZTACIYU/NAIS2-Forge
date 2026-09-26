# Mobile remote test deployment

This is a separate Worker. Do not attach it to an existing R2/upload Worker.
It holds only live WebSocket connections and forwards opaque ciphertext. It
does not use Durable Object storage, KV, R2, or application logs. The provider
may still process connection metadata.

1. In the new Cloudflare account, connect the R2 bucket `dev` to the custom
   domain `ciyu.us` for the static mobile page. Publish only the separate
   `C:\Users\admin\Desktop\Forge Web\dist` build
   assets at the bucket root; never publish app data or pairing secrets.
2. Deploy this Worker in the same account. `wrangler.toml` binds its custom
   domain to `relay.ciyu.us` and disables `workers.dev` and preview URLs.
   Only the exact static entry path `ciyu.us/forge.web` is also routed here;
   it internally fetches the bucket's `/index.html` without a browser redirect.
   Do not route the entire static domain or attach it to the image-upload Worker.
   The committed public endpoints are:

   `VITE_REMOTE_WEB_URL=https://ciyu.us/forge.web`

   `VITE_REMOTE_RELAY_URL=wss://relay.ciyu.us`

3. In `C:\Users\admin\Desktop\Forge Web`, run `npm install` and `npm run build`
   to create `dist` for the `dev` bucket. In the app repository, `npm run build`
   embeds the same public endpoints in the desktop app.
   Override either URL with the Vite environment variables above only if the
   hostnames change, and update the mobile CSP and `WEB_ORIGIN` together.

The bucket stores HTML; the Worker aliases only `/forge.web`. Existing
`/index.html` links and `/assets/` remain available. Verify HTTPS for `ciyu.us` and
WSS for `relay.ciyu.us` before displaying a QR in a release build. This repo
does not contain Cloudflare account credentials or an automatic deployment.

The QR secret is in the URL fragment and is removed by the mobile page on load.
Do not put it in query strings, analytics, logs, bug reports, or screenshots.
The QR is valid for five minutes; the approved phone expires after the selected
number of hours. Revoking in the desktop dialog removes the local key.
The static page and its JavaScript are part of the trust boundary: whoever can
replace them can see a QR secret as the phone opens the link. The Worker does
not authenticate room creation, so configure Cloudflare abuse/rate limits
before opening the relay to other users. A matching confirmation code on both
devices is required before approving a phone.
