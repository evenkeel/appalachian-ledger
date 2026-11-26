"""Build the website's pages into `website/dist`.

    python3 scripts/build_site.py

The pages are plain HTML in `website/pages`, one file each, holding only what is particular to
that page. This wraps each in the shared header and footer, fills in the few addresses kept in
`website/site.json`, and copies the stylesheet and pictures. No analytics, no third-party
scripts or fonts, and every link is relative, so the site works from any address.

The browser demo is built separately into `website/dist/demo` (`make web-demo`) and is left in
place here. `make website` does both.
"""

import json
import re
import shutil
import sys
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "website"
PAGES = SITE / "pages"
DIST = SITE / "dist"

NAV = [
    ("demo/", "Demo"),
    ("download/", "Download"),
    ("how-it-thinks-about-money/", "How it thinks about money"),
    ("privacy/", "Privacy"),
]

# The logo: three gentle layered hills over the name, the same drawing the app uses.
LOGO = """<svg class="logo" viewBox="0 0 200 49" role="img" aria-label="Appalachian Bitcoin">
  <g transform="scale(0.90909)">
    <path fill="#a9c1cf" d="M0,19.5C1.67,18.67 6.33,16.15 10,14.5C13.67,12.85 18,10.72 22,9.6C26,8.48 30,8.4 34,7.8C38,7.2 42,6.97 46,6C50,5.03 54.17,2.97 58,2C61.83,1.03 65.33,0.23 69,0.2C72.67,0.17 75.5,1 80,1.8C84.5,2.6 90.67,3.97 96,5C101.33,6.03 104.67,6.58 112,8C119.33,9.42 130.33,11.5 140,13.5C149.67,15.5 160,17.58 170,20C180,22.42 195,26.67 200,28V28H0Z"/>
    <path fill="#db8046" d="M60,24C64,22.58 77.33,17.58 84,15.5C90.67,13.42 94.33,13.08 100,11.5C105.67,9.92 113.5,7.3 118,6C122.5,4.7 124.42,4.18 127,3.7C129.58,3.22 131.33,3.1 133.5,3.1C135.67,3.1 136.92,3.13 140,3.7C143.08,4.27 147.67,5.37 152,6.5C156.33,7.63 161.67,9.45 166,10.5C170.33,11.55 174,12.23 178,12.8C182,13.37 186.33,13.28 190,13.9C193.67,14.52 196.67,15.57 200,16.5C203.33,17.43 206.67,18.42 210,19.5C213.33,20.58 218.33,22.42 220,23V28H60Z"/>
    <path fill="#304e5d" d="M0,23.6C2.33,23.08 9.33,21.52 14,20.5C18.67,19.48 23.67,18.53 28,17.5C32.33,16.47 36.83,15.1 40,14.3C43.17,13.5 44.83,13.05 47,12.7C49.17,12.35 50.83,12.2 53,12.2C55.17,12.2 56.83,12.32 60,12.7C63.17,13.08 67.33,13.7 72,14.5C76.67,15.3 83,16.72 88,17.5C93,18.28 97.33,19.2 102,19.2C106.67,19.2 111.67,18.2 116,17.5C120.33,16.8 124.5,15.63 128,15C131.5,14.37 134.33,13.98 137,13.7C139.67,13.42 141.5,13.28 144,13.3C146.5,13.32 148.67,13.27 152,13.8C155.33,14.33 159.67,15.93 164,16.5C168.33,17.07 173.67,17 178,17.2C182.33,17.4 186.33,17.23 190,17.7C193.67,18.17 196.67,19.2 200,20C203.33,20.8 206.67,21.77 210,22.5C213.33,23.23 218.33,24.08 220,24.4V28H0Z"/>
  </g>
  <text x="0" y="44" textLength="200" lengthAdjust="spacing" fill="currentColor" font-family="Georgia, 'Times New Roman', serif" font-size="19.2" font-weight="700">Appalachian Bitcoin</text>
</svg>"""

LAYOUT = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<meta name="theme-color" content="#fcfbf7">
<link rel="icon" type="image/svg+xml" href="{root}mark.svg">
<link rel="stylesheet" href="{root}site.css">
</head>
<body>
<div class="sheet">
  <header class="top">
    <a href="{root}" aria-label="Appalachian Bitcoin, home">{logo}</a>
    <nav aria-label="Site">{nav}</nav>
  </header>
  <main>
{body}
  </main>
  <footer class="end">
    <p>Appalachian Bitcoin is free software. No accounts, no tracking.</p>
    <nav aria-label="More">{footer}</nav>
  </footer>
</div>
</body>
</html>
"""

HEADERS = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: SAMEORIGIN

/demo/assets/*
  Cache-Control: public, max-age=31536000, immutable

/demo/demo-data/*
  Cache-Control: public, max-age=300
"""


def picture_sizes(body):
    """Give every picture its true width and height, so the page does not jump as pictures load."""

    def sized(match):
        tag, name = match.group(0), match.group(1)
        data = (PAGES / "img" / name).read_bytes()[:24] if (PAGES / "img" / name).exists() else b""
        if data[1:4] != b"PNG":
            return tag
        width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        tag = re.sub(r'\s(width|height)="\d+"', "", tag)
        return tag.replace("<img ", f'<img width="{width}" height="{height}" ', 1)

    return re.sub(r'<img [^>]*src="(?:\.\./)?img/([^"]+)"[^>]*>', sized, body)


def meta(text, key, default=""):
    found = re.search(rf"<!--\s*{key}:\s*(.*?)\s*-->", text)
    return found.group(1) if found else default


def main() -> int:
    site = json.loads((SITE / "site.json").read_text())
    signal, email, repo = site.get("signal_url", ""), site.get("contact_email", ""), site["repo_url"]
    if signal:
        help_sentence = f'For help and questions, join the <a href="{escape(signal)}">Signal chat</a>.'
    else:
        help_sentence = f'For help and questions, <a href="{repo}/issues">open an issue on GitHub</a>.'
        print("Note: website/site.json has no signal_url yet, so the pages point to GitHub issues for help.")
    DIST.mkdir(parents=True, exist_ok=True)
    built = []
    for page in sorted(PAGES.glob("*.html")):
        text = page.read_text()
        path = meta(text, "path")
        root = "../" if path else "./"
        body = re.sub(r"<!--\s*(title|description|path):.*?-->\n?", "", text)
        for key, value in {"repo_url": repo, "zip_url": site["zip_url"], "mac_url": site["mac_url"], "help_sentence": help_sentence}.items():
            body = body.replace("{{" + key + "}}", value)
        body = picture_sizes(body)
        left = re.findall(r"\{\{.*?\}\}", body)
        if left:
            print(f"{page.name}: unknown placeholder {left[0]}", file=sys.stderr)
            return 1
        nav = "".join(
            '<a href="{}{}"{}>{}</a>'.format(
                root, href, ' aria-current="page"' if path and href == path + "/" else "", label
            )
            for href, label in NAV
        )
        footer = nav + f'<a href="{repo}">Source code</a>'
        if signal:
            footer += f'<a href="{escape(signal)}">Signal chat</a>'
        if email:
            footer += f'<a href="mailto:{escape(email)}">{escape(email)}</a>'
        target = DIST / path / "index.html" if path else DIST / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            LAYOUT.format(
                title=escape(meta(text, "title", site["name"])),
                description=escape(meta(text, "description")),
                root=root,
                logo=LOGO,
                nav=nav,
                footer=footer,
                body=body.rstrip(),
            )
        )
        built.append(str(target.relative_to(DIST)))
    shutil.copyfile(PAGES / "site.css", DIST / "site.css")
    shutil.copyfile(ROOT / "frontend" / "public" / "mark.svg", DIST / "mark.svg")
    if (DIST / "img").exists():
        shutil.rmtree(DIST / "img")
    shutil.copytree(PAGES / "img", DIST / "img")
    (DIST / "_headers").write_text(HEADERS)
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {site['address']}/sitemap.txt\n")
    (DIST / "sitemap.txt").write_text(
        "\n".join(f"{site['address']}/{href}" for href in ["", *[href for href, _ in NAV]]) + "\n"
    )
    # A wrong address can be any depth, so this one page uses addresses from the top of the site.
    lost = '<h1>That page is not here</h1>\n<p class="lede">The address may be mistyped, or the page may have moved.</p>\n<div class="actions"><a class="btn primary" href="/">Go to the home page</a></div>'
    top_nav = "".join(f'<a href="/{href}">{label}</a>' for href, label in NAV)
    (DIST / "404.html").write_text(
        LAYOUT.format(
            title="Page not found · Appalachian Bitcoin",
            description="",
            root="/",
            logo=LOGO,
            nav=top_nav,
            footer=top_nav,
            body=lost,
        )
    )
    missing = [
        name
        for name in re.findall(r'src="(?:\.\./)?img/([^"]+)"', "".join(p.read_text() for p in PAGES.glob("*.html")))
        if not (PAGES / "img" / name).exists()
    ]
    if missing:
        print(
            f"Missing pictures in website/pages/img: {', '.join(sorted(set(missing)))}. Run: make site-shots",
            file=sys.stderr,
        )
    if not (DIST / "demo" / "index.html").exists():
        print("Note: the browser demo is not built yet (website/dist/demo). Run: make web-demo")
    print(f"Built {len(built)} pages into website/dist: {', '.join(built)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
