# Design QA — synchronized analysis dashboard

## Evidence

- Source reference: user-provided screenshot `截圖 2026-10-31 清晨6.49.34.png`.
- Implementation reviewed in the in-app browser at `http://127.0.0.1:4174/` after a production build.
- Desktop review viewport: approximately 1280 × 720.

## Visual comparison

- Layout: pass. Video is on the left; summary, live values, both charts, rep table and exports are on the right in one desktop view.
- Hierarchy: pass. The right panel follows the reference order: summary, Bar height, rounded-style visualization and per-rep rows.
- Motion overlay: pass. Only Trunk, Hip and Thigh are drawn, with a separate bar line and plate circle.
- Chart styling: pass. Dark panels, blue Bar height path, red/green rounded-style regions and per-rep color bands reproduce the reference visual language without copying its branding.
- Playback synchronization: pass by code and event wiring. Both charts share a video-time playhead and current-value updates on `timeupdate` and `seeked`.
- Copy/semantic safety: pass. The rounded display is labeled as an unvalidated visual proxy rather than a diagnosis or true probability.

## Functional checks

- `pnpm test`: pass (2/2).
- `pnpm build`: pass.
- Empty state, guide dialog, video picker and disabled pre-analysis controls: present.
- Real-video pose accuracy and physical-device playback: not verified in this QA because no representative test clip was supplied.
- Mobile/tablet visual QA: responsive rules are implemented; physical-device verification remains pending.

## Result

Passed for desktop delivery. No open P0, P1 or P2 visual defects were observed in the final desktop comparison.
