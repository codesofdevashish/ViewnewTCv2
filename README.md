# Tropical cyclones in 3D, updated daily

A GitHub Pages site that shows a 3D flow animation for every active tropical cyclone on Earth,
rebuilt every morning by GitHub Actions. It also serves as a portfolio page (edit `site/config.js`).

**What happens each day** (`.github/workflows/update.yml`, 06:40 UTC)

1. `scripts/storms.py` reads NCEP TCVitals from the last 8 days of GFS cycles. TCVitals carries the
   operational position and intensity of every active storm (NHC, CPHC, JTWC, ...), so this covers
   all basins and gives each storm's official track. Invest areas (90–99) are skipped.
2. `scripts/run_daily.py` downloads GFS 0.25° analyses (u, v, omega, vorticity, 900–500 hPa) for each
   storm's region, renders the video with `tc3d/render.py`, and deletes the data and frames at once.
3. Videos of storms that have ended are copied forward from the live site into the archive.
4. Only `public/` (web page, MP4s, posters, `storms.json`) is uploaded to GitHub Pages.
   No data or video is ever committed to the repository.

## The website

- **Cinematic opening**: every day the strongest active storm is also rendered as a clean 1920×1080
  film (flow, vortex core and day/night floor only, slow orbiting camera) that plays full screen
  behind the title.
- **3D Earth (WebGL, three.js)**: NASA Blue Marble by day and Black Marble city lights by night,
  blended along the real terminator, with ocean sun glint, atmosphere and stars. Storm tracks glow
  in Saffir–Simpson colours, storms spin in their hemisphere's direction; drag to turn, click a
  storm to open it. Falls back to a flat d3 globe on devices without WebGL.
- **Storm viewer**: the official intensity curve *is* the video timeline. Drag along it to scrub,
  step ±1 h, change speed. Live cards show frame time, wind, stage and centre, and a regional map
  moves the storm (and the night side) with the video. Tabs: written overview, structure gauges,
  facts and downloads. Keys: space, ← →, [ ].
- **Compare**: two storms side by side in sync (defaults to an RI storm vs a non-RI storm).
- **Season at a glance**: ACE by basin, storms by peak category, strongest storms.
- **Environment, hour by hour**: 850–200 and 850–500 hPa shear, 500–700 hPa humidity, SST under the
  core, vortex tilt, RMW and maximum wind, all linked to the video, with a checklist of conditions often
  associated with intensification at the current frame. Each storm also links to NASA Worldview at the
  frame's time for satellite imagery and IMERG rain.
- **Archive**, **interactive guide** to a frame, **About**. Light by default, dark on request.
- Everything the page needs (d3, topojson, Natural Earth land) is in `site/vendor/`, and each
  daily build stamps the script and stylesheet URLs so browsers never run an old copy.

## Notes

- Rapid intensification is flagged only from the official intensities (increase of at least
  30 kt in 24 h), never from GFS winds.
- Southern Hemisphere storms are handled (vorticity sign flipped), and so are storms crossing 180°.
- GitHub Pages sites are limited to about 1 GB; each video is roughly 5–15 MB, which is why the
  archive is capped.
- This is a research visualisation, not a forecast.
