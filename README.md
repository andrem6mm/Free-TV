# Free TV

Watch thousands of free, publicly available TV channels on your phone or PC. Free TV is a lightweight, installable web app (PWA) built on the community-maintained [iptv-org/iptv](https://github.com/iptv-org/iptv) playlist.

## Features

- **Big channel list**: loads the full iptv-org playlist (thousands of channels).
- **Fast switching**: ▲/▼ buttons, arrow keys or Page Up/Down on PC, swipe left/right on the video on a phone, or type a channel number.
- **Filters**: search by name, filter by country (with flags) and category (News, Sports, Kids, Movies…).
- **Favorites and recently watched**, saved on your device.
- **Installable**: add it to your home screen (phone) or install it from the browser (PC). It then opens like a normal app.
- Remembers your last channel and filters.

## Use it

Open the published site (GitHub Pages, see below), then:

- **Android / Chrome**: menu ⋮ → *Add to Home screen* / *Install app*.
- **iPhone / iPad (Safari)**: Share → *Add to Home Screen*.
- **PC (Chrome / Edge)**: click the *Install app* button in the top bar, or the install icon in the address bar.

### Keyboard shortcuts (PC)

| Key | Action |
| --- | --- |
| ↑ / ↓ (or PgUp / PgDn) | Previous / next channel |
| 0–9 | Jump to a channel number |
| F | Fullscreen |
| M | Mute |
| / | Search |

## Publish with GitHub Pages

1. In the repository go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to the default branch. The `Deploy to GitHub Pages` workflow publishes the site to `https://<your-username>.github.io/<repo-name>/`.

## Run locally

It's a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Notes and limits

- Free TV doesn't host any streams. It plays links from the public iptv-org playlist, so some channels will be offline, slow, or blocked in your country.
- Browsers block plain `http://` streams on secure (`https://`) pages, so those channels are hidden by default (Settings → uncheck to show them with a link you can open in VLC).
- Some streams don't allow playback from other websites (CORS). These usually work in Safari on iPhone/Mac, or in VLC.
- You can point the app at any other M3U playlist in **Settings → Playlist URL**, for example a single country: `https://iptv-org.github.io/iptv/countries/us.m3u`.

Video playback uses [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0), bundled in `vendor/`.
