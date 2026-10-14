# Third-party notices

The photographs and everything else in this repository are © Martin Porter, all rights reserved
(see `LICENSE`). The components below are not, and keep their own licenses.

## Distributed with the public site

| Component | Version | License | Where |
|---|---|---|---|
| [Inter](https://github.com/rsms/inter) typeface, © 2016 The Inter Project Authors | 4.001 | SIL Open Font License 1.1 | `site/fonts/`, copied to `docs/assets/fonts/`; full text in `site/fonts/OFL.txt` |

## Used by the local admin (installed by `npm`, not part of the repository or the site)

| Component | Version | License |
|---|---|---|
| [sharp](https://sharp.pixelplumbing.com) | 0.35.4 | Apache-2.0 |
| @img/sharp-* (prebuilt sharp binaries for the platform) | 0.35.4 | Apache-2.0 |
| @img/sharp-libvips-* ([libvips](https://www.libvips.org) and the libraries it bundles) | 1.3.3 | LGPL-3.0-or-later |
| @img/colour | 1.1.0 | MIT |
| [exifr](https://github.com/MikeKovarik/exifr) | 7.1.3 | MIT |

The site itself loads no third-party scripts except the optional Cloudflare Web Analytics beacon,
which is served by Cloudflare under its own terms.
