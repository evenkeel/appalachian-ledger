# The website

The public site for appalachianbitcoin.com: four plain pages and a demo of the app that runs
entirely in the visitor's browser. It is a static site. There is no server-side code, no
analytics, no cookies, and no third-party scripts or fonts.

| Address | What it is | Source |
| --- | --- | --- |
| `/` | Home | `pages/index.html` |
| `/demo/` | The real app on the fictional demo ledger, no server and no sign-in | `frontend/` built with `--mode demo` |
| `/download/` | Install guide for Mac and Windows | `pages/download.html` |
| `/how-it-thinks-about-money/` | The app's money ideas, adapted from its Learn screen | `pages/how-it-thinks-about-money.html` |
| `/privacy/` | What the app and this site do and do not send | `pages/privacy.html` |

`pages/site.css` is the whole look: black ink on paper, a serif, no decoration; the logo is the
only colour. `site.json` holds the few addresses the pages use.

## Build it

From the repository root, with the project's Python environment and Node installed:

```sh
make website        # refresh prices, rebuild the browser demo, build the pages -> website/dist
make site-preview   # look at it at http://127.0.0.1:5214/
```

`make website` does everything a release needs, in order:

1. `scripts/demo_prices.py` fetches the newest real Coinbase BTC-USD daily closes and moves the
   demo's five-year window forward. It also takes one real current quote for the demo to show.
2. `scripts/web_demo.py` loads the fictional demo person into a throwaway ledger, asks the real
   server everything the interface asks, and saves the answers.
3. The front-end tests check that the browser adds saved months up to exactly what the server
   says for longer spans. If they disagree, the build stops.
4. `npm run build:demo` packs the interface and the saved answers into `website/dist/demo`.
5. `scripts/build_site.py` builds the four pages around it.

So the website demo is always the current app, on the same made-up person and the same real
prices as the in-app demo, and it cannot drift from the app without the build failing.

`make site-shots` retakes the pictures on the home page from the built demo (needs Google
Chrome, and `make site-preview` running in another terminal). The two pictures in the install
guide (`install-create-account.png`, `install-first-dashboard.png`) were taken from a new, empty
installation; retake them by hand when those screens change.

## Before it goes live

- **Signal chat link.** Put the invitation address in `site.json` as `signal_url` and rebuild.
  Until then the help sections point to GitHub issues.
- **Email.** `contact_email` in `site.json` is empty, so no address appears anywhere. If one is
  added it shows only as a small link in the footer.
- **Try the install guide.** The steps on `/download/` come from the project's own Docker
  notes. They have not been run start to finish on a clean Mac and a clean Windows PC by the
  person who wrote the page. Do that once before pointing people at it.
- **The Download button** links to GitHub's ZIP of the `main` branch. Whatever is on `main` is
  what visitors get, so merge the release there first.

## Put it on Cloudflare Pages

The domain is already on Cloudflare. Nothing below is done automatically: each step is a click
by the owner. Steps 1 to 3 do not touch the live domain. **Step 4 replaces the site that is at
appalachianbitcoin.com today**, so do it only when the preview address looks right.

1. Build: `make website`. The folder to publish is `website/dist`.
2. In the Cloudflare dashboard open **Workers & Pages**, choose **Create**, then **Pages**, then
   **Upload assets** (the wording has changed over time; it is the option for uploading a
   folder, not for connecting to Git). Name the project, for example `appalachian-bitcoin`.
3. Drag the `website/dist` folder onto the upload box and choose **Deploy site**. Cloudflare
   gives it a preview address ending in `.pages.dev`. Open it and check the home page, the
   demo, the download guide and the privacy page.
4. To make it the real site: in the project, open **Custom domains**, choose **Set up a custom
   domain**, and enter `appalachianbitcoin.com`. Cloudflare shows the DNS record it will create
   or replace. Confirm it. Repeat for `www.appalachianbitcoin.com` if that should work too. The
   old site stops being served at that point.
5. To publish a later version: `make website`, then in the project choose **Create
   deployment** and upload `website/dist` again.

The same upload can be done from a terminal with Cloudflare's own tool, once signed in:
`npx wrangler pages deploy website/dist --project-name appalachian-bitcoin`.

`website/dist/_headers` sets a few plain security headers and tells browsers they may keep the
demo's program files for a long time and its saved answers for five minutes.

## What the browser demo can and cannot do

It is the real interface. Every figure is the real server's answer about the fictional ledger
on the day the demo was built, and that day is the demo's "today". The bitcoin price in its
header is one real Coinbase quote, shown with the time it was taken.

Nothing is saved. Switching theme, switching between dollars and bitcoin, and marking alerts
seen work until the page is reloaded. Anything that would change the ledger (adding an entry,
paying a bill) is declined with a sentence saying so, because making those work would mean
rebuilding the ledger's arithmetic in the browser. Markets and Retirement need the app's own
server and say so.
