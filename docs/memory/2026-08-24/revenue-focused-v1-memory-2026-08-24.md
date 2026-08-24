# Revenue-Focused Website V1 Memory - 2026-08-24

## Session summary

Reworked the existing Basic Beny one-page static site into a revenue-focused V1 centered on bookable production sessions. Preserved the cyber/green visual identity while replacing the placeholder storefront structure with a clear customer journey.

## Decisions made

- Basic Beny is the customer-facing creative-tools brand operated by Rhodes Resonance LLC.
- The initial commercial wedge is electronic music producers, especially Ableton users; drum and bass is the strongest specialty.
- The primary homepage conversion is booking a session.
- V1 offers are Track Feedback ($75), Production Deep Dive ($100), and Project Intensive (starting at $300).
- The nonfunctional digital-product placeholder was removed until a named product and real purchase/waitlist path exist.
- Changes use a feature branch and pull request before production merge.

## Files created or changed

- `index.html`: complete revenue-focused page structure and copy.
- `css/style.css`: responsive visual system and section layouts.
- `js/matrix.js`: lower-impact animation with reduced-motion and visibility handling.
- `images/ben.webp`: optimized, auto-oriented, metadata-stripped portrait.
- `robots.txt`, `sitemap.xml`, `404.html`, `favicon.svg`: technical foundation.
- `.agents/product-marketing.md`: reusable positioning context.
- `README.md`: local preview and Cloudflare Pages deployment details.
- Removed `images/ben.jpg` from the current tree because it was 1.8 MB and retained iPhone EXIF/GPS metadata.

## Commands and verification

- Local preview: `python3 -m http.server 4173 --bind 127.0.0.1`
- Internal audit: `/tmp/basicbeny-review/audit_site.py`
- Lighthouse final: 100 Performance, 100 Accessibility, 100 Best Practices, 100 SEO.
- Local lab metrics: FCP 0.8s, LCP 0.9s, Speed Index 0.8s, TBT 10ms, CLS 0.
- All internal assets, fragment links, and three Cal.com booking URLs returned HTTP 200.
- Desktop hero, desktop offer cards, and mobile hero/sessions/process/about/FAQ were captured and visually inspected.

## Gotchas and constraints

- The GitHub repository already existed at `benjaminrhodes/basicbeny-site` and was public. Repository visibility was not changed without explicit approval.
- The old JPEG remains available in prior public Git history even after deletion from the current tree. A history purge and force-push would require a separate explicit decision.
- Session copy intentionally avoids promising recordings, written notes, turnaround times, cancellation terms, or unverified testimonials because those facts were not confirmed.
- Cloudflare preview/production behavior must be verified after the branch is pushed and the PR is opened.

## Recommended next work

- Review and approve the session names, prices, and exact deliverables in the PR preview.
- Confirm cancellation/rescheduling terms and whether sessions include recordings or written notes.
- Decide whether the GitHub repository should remain public and whether old image history should be purged.
- Name and validate the first digital product before restoring a Tools section.
- Add only verifiable audio samples and testimonials with permission.
