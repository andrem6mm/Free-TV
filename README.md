# Free TV

Watch thousands of free, publicly available TV channels on your phone or PC. Free TV is a lightweight, installable web app (PWA) built on the community-maintained [iptv-org/iptv](https://github.com/iptv-org/iptv) playlist.

## Features

- **Big channel list**: loads the full iptv-org playlist (thousands of channels).
- **Fast switching**: ▲/▼ buttons, arrow keys or Page Up/Down on PC, swipe left/right on the video on a phone, or type a channel number.
- **Filters**: search by name, filter by country (with flags) and category (News, Sports, Kids, Movies…).
- **TV guide**: for selected Estonian and US sports and movie channels, shows what's on now, what's next and when, plus the rest of the schedule.
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

## TV guide (now / next)

When you pick a channel that has a schedule, a panel under the player shows the current programme (with a progress bar), what's next and at what time, and a *Full schedule* list. Channels without a schedule just don't show the panel.

Schedules come from TV listings sites (Telia TV for Estonia; beIN SPORTS, tvtv.us, TV Guide, Pluto TV and others for the US), downloaded with the [iptv-org/epg](https://github.com/iptv-org/epg) grabber:

- The channels are listed in `epg/channels.xml`. To add one, find it in a `sites/<site>/*.channels.xml` file of iptv-org/epg and copy the line. Set `xmltv_id` to the channel's `tvg-id` in the playlist. A channel can be listed under two sites, and the one that returns more programmes is used.
- The Pages workflow downloads the schedules every 6 hours, or when you run it by hand (**Actions → Deploy to GitHub Pages → Run workflow**). `scripts/build-guide.mjs` turns them into small JSON files under `guide/`. A push to the default branch redeploys the app and keeps the guide that's already live.
- If a listings site fails, channels keep their last schedule while it still covers the next couple of hours.
- GitHub pauses scheduled workflows in repositories with no activity for 60 days. Re-enable it on the Actions tab if the guide stops updating.

## Run locally

It's a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Notes and limits

- Free TV doesn't host any streams. It plays links from the public iptv-org playlist, so some channels will be offline, slow, or blocked in your country.
- Browsers block plain `http://` streams on secure (`https://`) pages, so those channels are hidden by default (Settings → uncheck to show them with a link you can open in VLC).
- A few channels that are free but only stream in the broadcaster's own player (for now Kanal 2 and the Duo channels on duoplay.ee) are listed with a *Watch on …* button that opens their site. They may need a free account there and usually only work in Estonia. The list is `WEB_CHANNELS` in `app.js`.
- Some streams don't allow playback from other websites (CORS). These usually work in Safari on iPhone/Mac, or in VLC.
- You can point the app at any other M3U playlist in **Settings → Playlist URL**, for example a single country: `https://iptv-org.github.io/iptv/countries/us.m3u`.

Video playback uses [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0), bundled in `vendor/`.
