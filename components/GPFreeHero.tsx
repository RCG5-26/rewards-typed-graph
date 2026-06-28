"use client";

import { useEffect, useRef } from "react";

/**
 * GPFree — landing page.
 *
 * Faithful port of the design handoff (`GPFree Landing.dc.html`): a static hero
 * with a pointer/gyro-driven 3D card tilt, floating points, an animated
 * "how it works" stepper, and a closing CTA. Both "start optimizing" CTAs link
 * to the Test Wallets comparison (`/test-wallets`), the demo entry point.
 *
 * The visual markup is injected verbatim (so it stays pixel-faithful to the
 * handoff) and the original interaction script is ported into a single effect
 * scoped to this component's root.
 */

const SIGN_IN_URL = "/test-wallets";

const STYLE = `
:root{
  --bg:#06070a; --bg2:#0b0d12; --bg3:#10131a;
  --panel:rgba(255,255,255,0.038); --panel-2:rgba(255,255,255,0.055);
  --brd:rgba(255,255,255,0.09); --brd-2:rgba(255,255,255,0.14);
  --tx1:#F4F4F7; --tx2:#A6A7B0; --tx3:#6a6b74;
  --iris:oklch(80% 0.11 265); --iris-bright:oklch(87% 0.10 265); --iris-deep:oklch(64% 0.15 265);
  --gold1:#efdca5; --gold2:#a9823f;
  --card1:#dcdee2; --card2:#a4a7af; --card3:#6c6f77; --card-sheen:rgba(255,255,255,0.6); --card-edge:oklch(85% 0.02 265 / 0.45);
  --card-ink:#16161b; --card-ink-soft:#2e2f36; --card-ink-faint:rgba(0,0,0,0.6); --card-mono:rgba(0,0,0,0.08);
  --fd:-apple-system,'SF Pro Display','Helvetica Neue',system-ui,sans-serif;
  --fs:-apple-system,'SF Pro Text','Helvetica Neue',system-ui,sans-serif;
  --fm:'SF Mono','Fira Code','Cascadia Code',ui-monospace,monospace;
  --rc:18px;
  --soft:cubic-bezier(0.4,0,0.2,1); --settle:cubic-bezier(0.25,0.46,0.45,0.94);
}
#gpx-hero *{box-sizing:border-box}
@keyframes gpxFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
@keyframes gpxGlint{0%{transform:translateX(-170%) rotate(13deg)}100%{transform:translateX(280%) rotate(13deg)}}
@keyframes gpxPts{0%{transform:translateY(16px);opacity:0}22%{opacity:.95}68%{opacity:.62}100%{transform:translateY(-30px);opacity:0}}
@keyframes gpxCaret{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes gpxHint{0%,100%{transform:translateY(0);opacity:.45}50%{transform:translateY(7px);opacity:1}}
@keyframes gpxRise{from{transform:translateY(16px)}to{transform:translateY(0)}}
@keyframes gpxPulse{0%,100%{opacity:.45}50%{opacity:1}}
#gpx-hero .cta{transition:filter .2s var(--soft)}
#gpx-hero .cta:hover{filter:brightness(1.08)}
#gpx-hero .seehow:hover{color:var(--tx1);border-color:var(--brd-2)}
/* Branded cursor: hollow iris ring (hotspot centered). Applied to children too
   so it stays consistent over links/CTAs instead of reverting to the pointer. */
#gpx-hero, #gpx-hero *{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Ccircle cx='14' cy='14' r='9' fill='none' stroke='%238E96F2' stroke-width='2'/%3E%3C/svg%3E") 14 14, auto}
@media (max-width:980px){
  #gpx-hero [data-herogrid]{grid-template-columns:1fr !important;gap:48px !important;text-align:center;justify-items:center}
  #gpx-hero [data-herocopy]{align-items:center !important;max-width:560px}
  #gpx-hero [data-howgrid]{grid-template-columns:1fr !important;gap:44px !important}
  #gpx-hero [data-stage]{height:420px !important}
  #gpx-how{min-height:auto !important;padding:96px 7vw !important}
}
@media (max-width:560px){
  #gpx-hero [data-stage]{height:340px !important}
}
@media (prefers-reduced-motion:reduce){
  #gpx-hero, #gpx-hero *{animation-duration:.001ms !important;animation-iteration-count:1 !important}
}
`;

const MARKUP = `
  <!-- ambient background layers -->
  <div style="position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(120% 90% at 72% 18%, #14171f 0%, var(--bg2) 38%, var(--bg) 78%)"></div>
  <div data-bgglow style="position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.6;background:radial-gradient(540px circle at var(--bgx,72%) var(--bgy,30%), color-mix(in srgb, var(--iris) 16%, transparent), transparent 60%);transition:opacity .4s var(--soft)"></div>
  <div style="position:fixed;inset:0;z-index:0;pointer-events:none;box-shadow:inset 0 -160px 220px -80px #000, inset 0 120px 180px -90px rgba(0,0,0,.6)"></div>
  <div data-grain style="position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.05;mix-blend-mode:overlay;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E&quot;);background-size:200px 200px"></div>

  <!-- ░░░░░░░░░ TOP BAR ░░░░░░░░░ -->
  <header style="position:relative;z-index:30;display:flex;align-items:center;justify-content:space-between;padding:30px 7vw;animation:gpxRise .9s var(--soft) .2s both">
    <div style="display:flex;align-items:center;gap:9px">
      <span style="font-family:var(--fd);font-weight:600;font-size:17px;letter-spacing:.13em;text-transform:uppercase;padding-left:.13em;color:var(--tx1)">gpfree</span>
      <span style="width:5px;height:5px;border-radius:50%;background:var(--iris);box-shadow:0 0 12px color-mix(in srgb, var(--iris) 75%, transparent)"></span>
    </div>
  </header>

  <!-- ░░░░░░░░░ HERO ░░░░░░░░░ -->
  <section style="position:relative;z-index:10;min-height:calc(100vh - 96px);display:flex;align-items:center;padding:0 7vw 80px">
    <div data-herogrid style="width:100%;max-width:1320px;margin:0 auto;display:grid;grid-template-columns:1.02fr 1.18fr;gap:60px;align-items:center">

      <!-- LEFT: copy -->
      <div data-herocopy style="display:flex;flex-direction:column;align-items:flex-start">
        <h1 style="margin:0;font-family:var(--fd);font-weight:300;font-size:clamp(40px,5.6vw,82px);line-height:1.04;letter-spacing:-0.04em;color:var(--tx1);animation:gpxRise 1s var(--settle) .35s both">
          Your points are<br>worth <em style="font-style:italic;font-weight:300;color:var(--iris-bright)">more</em><br>than you think
        </h1>
        <div style="display:flex;align-items:center;gap:22px;margin-top:38px;animation:gpxRise 1s var(--settle) .65s both">
          <a href="${SIGN_IN_URL}" class="cta" style="text-decoration:none;display:inline-flex;align-items:center;gap:9px;font-family:var(--fs);font-size:14px;font-weight:600;letter-spacing:.03em;color:#0a0b0e;background:var(--iris-bright);padding:16px 30px;border-radius:999px;box-shadow:0 10px 34px color-mix(in srgb, var(--iris) 40%, transparent), 0 0 0 1px color-mix(in srgb, var(--iris-bright) 60%, transparent)">
            start optimizing <span style="font-size:14px">&rarr;</span>
          </a>
          <a href="#gpx-how" class="seehow" style="font-family:var(--fs);font-size:14px;letter-spacing:.02em;color:var(--tx2);text-decoration:none;border-bottom:1px solid var(--brd);padding-bottom:3px;transition:color .2s var(--soft),border-color .2s var(--soft)">see how it works</a>
        </div>

        <div style="display:flex;align-items:center;gap:18px;margin-top:46px;animation:gpxRise 1s var(--settle) .8s both">
          <div style="font-family:var(--fm);font-size:12px;letter-spacing:.04em;color:var(--tx3);line-height:1.7">
            <span style="color:var(--tx2)">tracking 240,000 pts</span><br>
            <span data-count style="color:var(--iris-bright);font-size:15px">&asymp; $0</span><span style="color:var(--tx3)"> in travel value</span>
          </div>
        </div>
      </div>

      <!-- RIGHT: 3D card stage -->
      <div data-stage style="position:relative;width:100%;height:520px;perspective:1500px;perspective-origin:50% 42%;cursor:grab">
        <!-- floating points -->
        <div data-points style="position:absolute;inset:-8% -4%;pointer-events:none;z-index:1">
          <span style="position:absolute;top:14%;left:62%;font-family:var(--fm);font-weight:600;font-size:22px;color:var(--iris-bright);text-shadow:0 0 18px color-mix(in srgb,var(--iris) 80%,transparent);animation:gpxPts 4.6s var(--soft) 0s infinite">+100,000</span>
          <span style="position:absolute;top:30%;left:82%;font-family:var(--fm);font-weight:600;font-size:16px;color:var(--iris-bright);text-shadow:0 0 14px color-mix(in srgb,var(--iris) 75%,transparent);animation:gpxPts 5.4s var(--soft) .8s infinite">+100,000</span>
          <span style="position:absolute;top:60%;left:74%;font-family:var(--fm);font-weight:600;font-size:19px;color:var(--iris-bright);text-shadow:0 0 16px color-mix(in srgb,var(--iris) 78%,transparent);animation:gpxPts 4.2s var(--soft) 1.7s infinite">+100,000</span>
          <span style="position:absolute;top:74%;left:50%;font-family:var(--fm);font-weight:600;font-size:14px;color:var(--iris);text-shadow:0 0 12px color-mix(in srgb,var(--iris) 70%,transparent);animation:gpxPts 5.8s var(--soft) .4s infinite">+100,000</span>
          <span style="position:absolute;top:20%;left:14%;font-family:var(--fm);font-weight:600;font-size:15px;color:var(--iris);text-shadow:0 0 12px color-mix(in srgb,var(--iris) 70%,transparent);animation:gpxPts 5.2s var(--soft) 2.3s infinite">+100,000</span>
          <span style="position:absolute;top:52%;left:6%;font-family:var(--fm);font-weight:600;font-size:17px;color:var(--iris-bright);text-shadow:0 0 14px color-mix(in srgb,var(--iris) 74%,transparent);animation:gpxPts 4.8s var(--soft) 1.2s infinite">+100,000</span>
          <span style="position:absolute;top:84%;left:24%;font-family:var(--fm);font-weight:600;font-size:14px;color:var(--iris);text-shadow:0 0 10px color-mix(in srgb,var(--iris) 66%,transparent);animation:gpxPts 5s var(--soft) 3s infinite">+100,000</span>
        </div>

        <!-- floor reflection / glow -->
        <div data-shadow style="position:absolute;left:50%;bottom:6%;width:62%;height:60px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse at center, color-mix(in srgb,var(--iris) 30%,transparent), rgba(0,0,0,.55) 42%, transparent 72%);filter:blur(14px);z-index:1"></div>

        <!-- the card -->
        <div data-cardwrap style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:2">
          <div data-card style="width:min(82%,430px);aspect-ratio:1.585/1;transform-style:preserve-3d;transform:rotateX(6deg) rotateY(-14deg);will-change:transform">
            <div data-cardinner style="position:relative;width:100%;height:100%;transform-style:preserve-3d;animation:gpxFloat 6s ease-in-out infinite">
              <!-- metal surface -->
              <div style="position:absolute;inset:0;border-radius:var(--rc);overflow:hidden;background:linear-gradient(135deg, var(--card1) 0%, var(--card2) 62%, var(--card3) 100%);box-shadow:0 30px 60px -20px rgba(0,0,0,.8), 0 2px 0 0 rgba(255,255,255,.06) inset, 0 -2px 0 0 rgba(0,0,0,.5) inset, 0 0 0 1px rgba(255,255,255,.07) inset">
                <!-- brushed texture -->
                <div style="position:absolute;inset:0;opacity:.5;background:repeating-linear-gradient(115deg, rgba(255,255,255,.035) 0px, rgba(255,255,255,.035) 1px, transparent 2px, transparent 4px)"></div>
                <!-- diagonal sheen sweep -->
                <div style="position:absolute;top:-30%;left:0;width:34%;height:160%;pointer-events:none;mix-blend-mode:overlay;background:linear-gradient(90deg, transparent, var(--card-sheen), transparent);filter:blur(5px);animation:gpxGlint 7.5s ease-in-out 2.4s infinite"></div>
                <!-- iris edge glow -->
                <div style="position:absolute;inset:0;border-radius:var(--rc);box-shadow:0 0 38px color-mix(in srgb, var(--card-edge) 60%, transparent) inset;pointer-events:none"></div>
                <!-- pointer glare -->
                <div data-glare style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(220px circle at var(--glx,30%) var(--gly,22%), rgba(255,255,255,.42), rgba(255,255,255,.08) 26%, transparent 56%);mix-blend-mode:soft-light"></div>
              </div>

              <!-- content layers (raised in Z) -->
              <div style="position:absolute;inset:0;padding:8.5% 8%;display:flex;flex-direction:column;justify-content:space-between;transform:translateZ(24px);transform-style:preserve-3d">
                <!-- top row: chip + contactless + brand -->
                <div style="display:flex;align-items:flex-start;justify-content:space-between">
                  <div style="display:flex;align-items:center;gap:14px">
                    <!-- EMV chip -->
                    <div style="width:46px;height:35px;border-radius:6px;background:linear-gradient(135deg,var(--gold1),var(--gold2));box-shadow:0 1px 2px rgba(0,0,0,.5), 0 0 0 .5px rgba(0,0,0,.3) inset;position:relative">
                      <div style="position:absolute;left:50%;top:5px;bottom:5px;width:1px;background:rgba(60,40,10,.45);transform:translateX(-50%)"></div>
                      <div style="position:absolute;top:50%;left:5px;right:5px;height:1px;background:rgba(60,40,10,.45);transform:translateY(-50%)"></div>
                      <div style="position:absolute;left:50%;top:50%;width:13px;height:13px;border:1px solid rgba(60,40,10,.4);border-radius:2px;transform:translate(-50%,-50%)"></div>
                    </div>
                    <!-- contactless -->
                    <div style="position:relative;width:16px;height:22px;opacity:.65">
                      <span style="position:absolute;left:0;top:3px;width:8px;height:16px;border:1.5px solid var(--tx2);border-left:0;border-radius:0 12px 12px 0"></span>
                      <span style="position:absolute;left:4px;top:6px;width:5px;height:10px;border:1.5px solid var(--tx2);border-left:0;border-radius:0 8px 8px 0"></span>
                    </div>
                  </div>
                  <span style="font-family:var(--fd);font-weight:600;font-size:13px;letter-spacing:.16em;text-transform:uppercase;padding-left:.16em;color:var(--card-ink);text-shadow:0 1px 0 rgba(0,0,0,.28), 0 -1px 0 rgba(255,255,255,.3)">gpfree</span>
                </div>

                <!-- big monogram watermark -->
                <div style="position:absolute;right:7%;top:50%;transform:translateY(-46%);font-family:var(--fd);font-weight:300;font-size:96px;line-height:1;color:var(--card-mono);text-shadow:0 1px 0 rgba(255,255,255,.06)">&#10056;</div>

                <!-- number -->
                <div style="font-family:var(--fm);font-size:clamp(13px,2.1vw,17px);letter-spacing:.14em;color:var(--card-ink-soft);text-shadow:0 1px 1px rgba(0,0,0,.55), 0 -1px 0 rgba(255,255,255,.08)">5829&nbsp;&bull;&bull;&bull;&bull;&nbsp;&bull;&bull;&bull;&bull;&nbsp;4821</div>

                <!-- bottom row -->
                <div style="display:flex;align-items:flex-end;justify-content:space-between">
                  <div>
                    <div style="font-family:var(--fm);font-size:8px;letter-spacing:.18em;color:var(--card-ink-faint);margin-bottom:4px">MEMBER</div>
                    <div style="font-family:var(--fd);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--card-ink);text-shadow:0 1px 0 rgba(0,0,0,.28), 0 -1px 0 rgba(255,255,255,.28)">RAQ ROBINSON</div>
                  </div>
                  <div style="text-align:right">
                    <div style="font-family:var(--fm);font-size:8px;letter-spacing:.16em;color:var(--card-ink-faint);margin-bottom:4px">VALID THRU</div>
                    <div style="font-family:var(--fm);font-size:13px;letter-spacing:.08em;color:var(--card-ink-soft);text-shadow:0 1px 0 rgba(0,0,0,.5)">10/29</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- drag hint -->
        <div data-draghint style="position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);z-index:3;font-family:var(--fm);font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--tx3);pointer-events:none;transition:opacity .5s var(--soft)">drag to tilt</div>
      </div>
    </div>

    <!-- scroll hint -->
    <div style="position:absolute;left:50%;bottom:26px;transform:translateX(-50%);z-index:20;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none">
      <span style="font-family:var(--fm);font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--tx3)">scroll</span>
      <div style="width:1px;height:26px;background:linear-gradient(180deg, color-mix(in srgb,var(--tx1) 45%,transparent), transparent);animation:gpxHint 1.8s ease-in-out infinite"></div>
    </div>
  </section>

  <!-- ░░░░░░░░░ HOW IT WORKS ░░░░░░░░░ -->
  <section id="gpx-how" style="position:relative;z-index:10;padding:120px 7vw;display:flex;align-items:center;min-height:90vh">
    <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:1px;height:80px;background:linear-gradient(180deg, transparent, color-mix(in srgb,var(--iris) 60%,transparent));pointer-events:none"></div>
    <div data-howgrid style="width:100%;max-width:1280px;margin:0 auto;display:grid;grid-template-columns:0.92fr 1.08fr;gap:80px;align-items:center">

      <!-- LEFT steps -->
      <div data-reveal style="opacity:1;transform:none;transition:opacity .6s var(--soft), transform .7s var(--settle)">
        <h2 style="margin:0 0 40px;font-family:var(--fd);font-weight:300;font-size:clamp(30px,3.6vw,46px);line-height:1.08;letter-spacing:-0.035em;color:var(--tx1)">Three steps to<br>your next trip</h2>
        <div style="display:flex;flex-direction:column;gap:6px">

          <button type="button" data-step="0" style="appearance:none;cursor:pointer;text-align:left;width:100%;border:0;border-left:2px solid var(--iris);background:color-mix(in srgb,var(--iris) 12%,transparent);padding:22px 26px;border-radius:10px;color:inherit;transition:background .25s var(--soft),border-color .25s var(--soft)">
            <div style="display:flex;align-items:baseline;gap:18px">
              <span style="font-family:var(--fm);font-size:13px;color:var(--iris-bright);flex:none">01</span>
              <div>
                <div style="font-family:var(--fd);font-size:20px;color:var(--tx1)">Build your wallet</div>
                <div style="font-family:var(--fs);font-size:13px;color:var(--tx2);margin-top:5px;line-height:1.5">Add the cards you already carry. We never store the numbers.</div>
              </div>
            </div>
            <div data-stepbar style="height:2px;background:rgba(255,255,255,.1);margin-top:18px;border-radius:999px;overflow:hidden;opacity:1;transition:opacity .28s var(--soft)"><div data-stepfill style="height:100%;width:0%;background:var(--iris-bright)"></div></div>
          </button>

          <button type="button" data-step="1" style="appearance:none;cursor:pointer;text-align:left;width:100%;border:0;border-left:2px solid transparent;background:transparent;padding:22px 26px;border-radius:10px;color:inherit;transition:background .25s var(--soft),border-color .25s var(--soft)">
            <div style="display:flex;align-items:baseline;gap:18px">
              <span style="font-family:var(--fm);font-size:13px;color:var(--iris-bright);flex:none">02</span>
              <div>
                <div style="font-family:var(--fd);font-size:20px;color:var(--tx1)">Name the trip</div>
                <div style="font-family:var(--fs);font-size:13px;color:var(--tx2);margin-top:5px;line-height:1.5">Tell us where you want to go, in plain words.</div>
              </div>
            </div>
            <div data-stepbar style="height:2px;background:rgba(255,255,255,.1);margin-top:18px;border-radius:999px;overflow:hidden;opacity:0;transition:opacity .28s var(--soft)"><div data-stepfill style="height:100%;width:0%;background:var(--iris-bright)"></div></div>
          </button>

          <button type="button" data-step="2" style="appearance:none;cursor:pointer;text-align:left;width:100%;border:0;border-left:2px solid transparent;background:transparent;padding:22px 26px;border-radius:10px;color:inherit;transition:background .25s var(--soft),border-color .25s var(--soft)">
            <div style="display:flex;align-items:baseline;gap:18px">
              <span style="font-family:var(--fm);font-size:13px;color:var(--iris-bright);flex:none">03</span>
              <div>
                <div style="font-family:var(--fd);font-size:20px;color:var(--tx1)">Let the agents plan</div>
                <div style="font-family:var(--fs);font-size:13px;color:var(--tx2);margin-top:5px;line-height:1.5">They search every program and book the sweet spot.</div>
              </div>
            </div>
            <div data-stepbar style="height:2px;background:rgba(255,255,255,.1);margin-top:18px;border-radius:999px;overflow:hidden;opacity:0;transition:opacity .28s var(--soft)"><div data-stepfill style="height:100%;width:0%;background:var(--iris-bright)"></div></div>
          </button>

        </div>
      </div>

      <!-- RIGHT animated panel -->
      <div data-reveal data-howstage style="position:relative;aspect-ratio:4/3;border:1px solid var(--brd);border-radius:20px;background:linear-gradient(160deg, var(--panel-2), var(--panel));backdrop-filter:blur(12px);overflow:hidden;box-shadow:0 30px 80px -30px rgba(0,0,0,.7);opacity:1;transform:none;transition:opacity .6s var(--soft) .12s, transform .7s var(--settle) .12s">
        <div style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 80% at 30% 0%, color-mix(in srgb,var(--iris) 10%,transparent), transparent 60%)"></div>

        <!-- panel 0: wallet cards -->
        <div data-steppanel="0" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:1;transition:opacity .35s var(--soft)">
          <div style="position:relative;width:300px;height:200px">
            <div data-anim data-final="translate(-90px,6px) rotate(-9deg)" data-hidden="translate(-90px,48px) rotate(-9deg)" style="position:absolute;left:50%;top:50%;width:186px;height:118px;margin:-59px 0 0 -93px;border-radius:13px;background:linear-gradient(140deg,#262932,#121319);border:1px solid var(--brd);box-shadow:0 14px 30px -12px rgba(0,0,0,.8);padding:15px;opacity:0;transform:translate(-90px,48px) rotate(-9deg);transition:opacity .35s var(--soft) .05s, transform .55s var(--settle) .05s">
              <div style="width:28px;height:20px;border-radius:4px;background:linear-gradient(135deg,var(--gold1),var(--gold2))"></div>
              <div style="position:absolute;bottom:14px;left:16px;font-family:var(--fm);font-size:10px;color:var(--tx3)">&bull;&bull;&bull;&bull; 4821</div>
            </div>
            <div data-anim data-final="translate(90px,8px) rotate(9deg)" data-hidden="translate(90px,48px) rotate(9deg)" style="position:absolute;left:50%;top:50%;width:186px;height:118px;margin:-59px 0 0 -93px;border-radius:13px;background:linear-gradient(140deg,#1d2740,#0b1020);border:1px solid var(--brd);box-shadow:0 14px 30px -12px rgba(0,0,0,.8);padding:15px;opacity:0;transform:translate(90px,48px) rotate(9deg);transition:opacity .35s var(--soft) .18s, transform .55s var(--settle) .18s">
              <div style="width:28px;height:20px;border-radius:4px;background:linear-gradient(135deg,var(--gold1),var(--gold2))"></div>
              <div style="position:absolute;bottom:14px;left:16px;font-family:var(--fm);font-size:10px;color:var(--tx3)">&bull;&bull;&bull;&bull; 7390</div>
            </div>
            <div data-anim data-final="translate(0,-8px) rotate(-1deg)" data-hidden="translate(0,40px) rotate(-1deg)" style="position:absolute;left:50%;top:50%;width:194px;height:122px;margin:-61px 0 0 -97px;border-radius:13px;background:linear-gradient(140deg,var(--card1),var(--card2));border:1px solid var(--brd-2);box-shadow:0 22px 44px -14px rgba(0,0,0,.85), 0 0 30px -10px color-mix(in srgb,var(--iris) 40%,transparent);padding:15px;opacity:0;transform:translate(0,40px) rotate(-1deg);transition:opacity .35s var(--soft) .3s, transform .55s var(--settle) .3s">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div style="width:30px;height:21px;border-radius:4px;background:linear-gradient(135deg,var(--gold1),var(--gold2))"></div>
                <span style="font-family:var(--fd);font-size:10px;letter-spacing:.14em;color:#dfe1e8">gpfree</span>
              </div>
              <div style="position:absolute;bottom:14px;left:17px;font-family:var(--fm);font-size:10px;color:var(--tx2)">&bull;&bull;&bull;&bull; 1205</div>
            </div>
          </div>
        </div>

        <!-- panel 1: goal -->
        <div data-steppanel="1" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .35s var(--soft)">
          <div style="width:80%;max-width:430px">
            <div data-anim data-final="translateY(0)" data-hidden="translateY(22px)" style="opacity:0;transform:translateY(22px);transition:opacity .35s var(--soft) .05s, transform .55s var(--settle) .05s;background:rgba(255,255,255,.04);border:1px solid var(--brd);border-radius:14px;padding:22px 22px 18px">
              <div style="font-family:var(--fm);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--tx3);margin-bottom:14px">your goal</div>
              <div style="font-family:var(--fd);font-style:italic;font-weight:300;font-size:21px;line-height:1.3;color:var(--tx1);min-height:62px"><span data-howtyper><span></span><span style="color:var(--iris);animation:gpxCaret 1s step-end infinite">&#9613;</span></span></div>
            </div>
            <div data-anim data-final="translateY(0)" data-hidden="translateY(22px)" style="opacity:0;transform:translateY(22px);transition:opacity .35s var(--soft) .22s, transform .55s var(--settle) .22s;margin-top:16px;display:flex;justify-content:flex-end">
              <span style="display:inline-flex;align-items:center;gap:8px;font-family:var(--fs);font-size:12px;font-weight:600;letter-spacing:.03em;color:#0a0b0e;background:var(--iris-bright);padding:12px 24px;border-radius:999px">plan it &rarr;</span>
            </div>
          </div>
        </div>

        <!-- panel 2: plan -->
        <div data-steppanel="2" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .35s var(--soft)">
          <div style="width:82%;max-width:450px">
            <div data-anim data-final="translateY(0)" data-hidden="translateY(20px)" style="opacity:0;transform:translateY(20px);transition:opacity .5s var(--soft) .05s, transform .55s var(--settle) .05s;display:flex;align-items:center;gap:12px;padding:13px 16px;background:rgba(255,255,255,.04);border:1px solid var(--brd);border-radius:11px;margin-bottom:9px">
              <span style="width:7px;height:7px;border-radius:2px;background:#5fcf8e;flex:none"></span>
              <span style="font-family:var(--fm);font-size:10px;font-weight:600;color:#5fcf8e;width:64px;flex:none">WALLET</span>
              <span style="font-family:var(--fm);font-size:11px;color:var(--tx2);flex:1">read balances &middot; 240,000 pts</span>
              <span style="color:#5fcf8e;font-size:13px">&check;</span>
            </div>
            <div data-anim data-final="translateY(0)" data-hidden="translateY(20px)" style="opacity:0;transform:translateY(20px);transition:opacity .5s var(--soft) .16s, transform .55s var(--settle) .16s;display:flex;align-items:center;gap:12px;padding:13px 16px;background:rgba(255,255,255,.04);border:1px solid var(--brd);border-radius:11px;margin-bottom:9px">
              <span style="width:7px;height:7px;border-radius:2px;background:#e0b15a;flex:none"></span>
              <span style="font-family:var(--fm);font-size:10px;font-weight:600;color:#e0b15a;width:64px;flex:none">EARNING</span>
              <span style="font-family:var(--fm);font-size:11px;color:var(--tx2);flex:1">route spend &middot; 3&times; travel</span>
              <span style="color:#5fcf8e;font-size:13px">&check;</span>
            </div>
            <div data-anim data-final="translateY(0)" data-hidden="translateY(20px)" style="opacity:0;transform:translateY(20px);transition:opacity .5s var(--soft) .27s, transform .55s var(--settle) .27s;display:flex;align-items:center;gap:12px;padding:13px 16px;background:rgba(255,255,255,.04);border:1px solid var(--brd);border-radius:11px;margin-bottom:9px">
              <span style="width:7px;height:7px;border-radius:2px;background:var(--iris);flex:none"></span>
              <span style="font-family:var(--fm);font-size:10px;font-weight:600;color:var(--iris-bright);width:64px;flex:none">REDEEM</span>
              <span style="font-family:var(--fm);font-size:11px;color:var(--tx2);flex:1">transfer &rarr; ANA &middot; 1:1</span>
              <span style="color:#5fcf8e;font-size:13px">&check;</span>
            </div>
            <div data-anim data-final="translateY(0)" data-hidden="translateY(20px)" style="opacity:0;transform:translateY(20px);transition:opacity .5s var(--soft) .4s, transform .55s var(--settle) .4s;margin-top:14px;display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:color-mix(in srgb,var(--iris) 14%,transparent);border:1px solid color-mix(in srgb,var(--iris) 30%,transparent);border-radius:14px">
              <div>
                <div style="font-family:var(--fm);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--iris-bright)">your plan</div>
                <div style="font-family:var(--fd);font-size:17px;color:var(--tx1);margin-top:3px">Business saver &middot; LAX &rarr; TYO</div>
              </div>
              <div style="font-family:var(--fd);font-weight:300;font-size:26px;color:var(--iris-bright)">120k</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ░░░░░░░░░ CLOSING CTA + FOOTER ░░░░░░░░░ -->
  <section style="position:relative;z-index:10;padding:120px 7vw 0;text-align:center">
    <div data-reveal style="max-width:760px;margin:0 auto;opacity:1;transform:none;transition:opacity .6s var(--soft), transform .7s var(--settle)">
      <h2 style="margin:0;font-family:var(--fd);font-weight:300;font-size:clamp(38px,6vw,86px);line-height:1.02;letter-spacing:-0.04em;color:var(--tx1)">Go <em style="font-style:italic;font-weight:300;color:var(--iris-bright)">anywhere</em></h2>
      <p style="margin:26px auto 0;max-width:460px;font-family:var(--fs);font-size:16px;line-height:1.6;color:var(--tx2)">The points are already in your wallet. Let the agents turn them into the trip you keep putting off.</p>
      <div style="margin-top:40px;display:flex;justify-content:center">
        <a href="${SIGN_IN_URL}" class="cta" style="text-decoration:none;display:inline-flex;align-items:center;gap:9px;font-family:var(--fs);font-size:15px;font-weight:600;letter-spacing:.03em;color:#0a0b0e;background:var(--iris-bright);padding:18px 36px;border-radius:999px;box-shadow:0 14px 40px color-mix(in srgb,var(--iris) 42%,transparent), 0 0 0 1px color-mix(in srgb,var(--iris-bright) 60%,transparent)">start optimizing — free <span>&rarr;</span></a>
      </div>
      <div style="margin-top:22px;font-family:var(--fm);font-size:11px;letter-spacing:.06em;color:var(--tx3)">no card numbers stored&nbsp;&nbsp;&middot;&nbsp;&nbsp;free to start&nbsp;&nbsp;&middot;&nbsp;&nbsp;2-minute setup</div>
    </div>

    <div style="max-width:1280px;margin:110px auto 0;border-top:1px solid var(--brd);padding:30px 0 40px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:9px">
        <span style="font-family:var(--fd);font-weight:600;font-size:14px;letter-spacing:.13em;text-transform:uppercase;padding-left:.13em;color:var(--tx1)">gpfree</span>
        <span style="width:5px;height:5px;border-radius:50%;background:var(--iris)"></span>
      </div>
      <span style="font-family:var(--fm);font-size:11px;letter-spacing:.04em;color:var(--tx3)">coordination is state, not messages</span>
      <span style="font-family:var(--fm);font-size:11px;color:var(--tx3)">© 2026 GPFree</span>
    </div>
  </section>
`;

export default function GPFreeHero() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const tiltMul = 1;
    const reduced = !!(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    const cleanups: Array<() => void> = [];

    // ── value counter ──
    const countEl = root.querySelector<HTMLElement>("[data-count]");
    if (countEl) {
      const target = 4080;
      const dur = 1500;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        const v = Math.round(target * e);
        countEl.textContent = "≈ $" + v.toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
      };
      if (reduced) countEl.textContent = "≈ $4,080";
      else requestAnimationFrame(tick);
    }

    // ── background glow follows pointer ──
    const bg = root.querySelector<HTMLElement>("[data-bgglow]");
    const onBg = (e: PointerEvent) => {
      if (!bg) return;
      bg.style.setProperty("--bgx", ((e.clientX / window.innerWidth) * 100).toFixed(1) + "%");
      bg.style.setProperty("--bgy", ((e.clientY / window.innerHeight) * 100).toFixed(1) + "%");
    };
    if (!reduced) {
      window.addEventListener("pointermove", onBg);
      cleanups.push(() => window.removeEventListener("pointermove", onBg));
    }

    // ── 3D card tilt ──
    const stage = root.querySelector<HTMLElement>("[data-stage]");
    const card = root.querySelector<HTMLElement>("[data-card]");
    const glare = root.querySelector<HTMLElement>("[data-glare]");
    const shadow = root.querySelector<HTMLElement>("[data-shadow]");
    const points = root.querySelector<HTMLElement>("[data-points]");
    const hint = root.querySelector<HTMLElement>("[data-draghint]");
    const rest = { rx: 6, ry: -14 };
    const cur = { rx: 6, ry: -14 };
    const tgt = { rx: 6, ry: -14 };
    let dragging = false;
    let interacted = false;
    let onOrient: ((ev: DeviceOrientationEvent) => void) | null = null;

    const setFromPointer = (e: PointerEvent) => {
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      const range = (dragging ? 26 : 15) * (tiltMul || 1);
      tgt.ry = rest.ry + px * 2 * range;
      tgt.rx = rest.rx - py * 2 * range;
      if (!interacted) {
        interacted = true;
        if (hint) hint.style.opacity = "0";
      }
    };
    const onMove = (e: PointerEvent) => setFromPointer(e);
    const onLeave = () => {
      tgt.rx = rest.rx;
      tgt.ry = rest.ry;
    };
    const onDown = (e: PointerEvent) => {
      dragging = true;
      if (stage) stage.style.cursor = "grabbing";
      setFromPointer(e);
    };
    const onUp = () => {
      dragging = false;
      if (stage) stage.style.cursor = "grab";
    };

    if (stage && card) {
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerleave", onLeave);
      stage.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      cleanups.push(() => {
        stage.removeEventListener("pointermove", onMove);
        stage.removeEventListener("pointerleave", onLeave);
        stage.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
      });

      // gyro (mobile) — request permission on first tap if needed
      onOrient = (ev: DeviceOrientationEvent) => {
        if (ev.gamma == null || ev.beta == null) return;
        const g = Math.max(-30, Math.min(30, ev.gamma));
        const b = Math.max(-30, Math.min(30, ev.beta - 35));
        tgt.ry = rest.ry + (g / 30) * 22 * (tiltMul || 1);
        tgt.rx = rest.rx - (b / 30) * 16 * (tiltMul || 1);
        if (!interacted) {
          interacted = true;
          if (hint) hint.style.opacity = "0";
        }
      };
      const enableGyro = () => {
        const DOE = window.DeviceOrientationEvent as unknown as {
          requestPermission?: () => Promise<string>;
        };
        if (DOE && typeof DOE.requestPermission === "function") {
          DOE.requestPermission()
            .then((s) => {
              if (s === "granted" && onOrient)
                window.addEventListener("deviceorientation", onOrient);
            })
            .catch(() => {});
        } else if (window.DeviceOrientationEvent && onOrient) {
          window.addEventListener("deviceorientation", onOrient);
        }
      };
      stage.addEventListener("touchstart", enableGyro, { once: true });
      cleanups.push(() => {
        if (onOrient) window.removeEventListener("deviceorientation", onOrient);
      });

      let raf = 0;
      const loop = () => {
        cur.rx += (tgt.rx - cur.rx) * 0.1;
        cur.ry += (tgt.ry - cur.ry) * 0.1;
        card.style.transform =
          "rotateX(" + cur.rx.toFixed(2) + "deg) rotateY(" + cur.ry.toFixed(2) + "deg)";
        if (glare) {
          const gx = 30 + ((cur.ry - rest.ry) / 40) * 50;
          const gy = 22 - ((cur.rx - rest.rx) / 40) * 40;
          glare.style.setProperty("--glx", gx.toFixed(1) + "%");
          glare.style.setProperty("--gly", gy.toFixed(1) + "%");
        }
        if (shadow) {
          const sk = 1 - Math.abs(cur.ry - rest.ry) / 120;
          shadow.style.transform = "translateX(-50%) scaleX(" + Math.max(0.7, sk).toFixed(3) + ")";
        }
        if (points) {
          const dx = ((cur.ry - rest.ry) / 40) * -16;
          const dy = ((cur.rx - rest.rx) / 40) * 12;
          points.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
        }
        raf = requestAnimationFrame(loop);
      };
      if (!reduced) raf = requestAnimationFrame(loop);
      else card.style.transform = "rotateX(6deg) rotateY(-14deg)";
      cleanups.push(() => cancelAnimationFrame(raf));
    }

    // ── magnetic CTAs ──
    if (!reduced) {
      root.querySelectorAll<HTMLElement>("[data-mag]").forEach((a) => {
        a.style.transition = "transform .25s cubic-bezier(0.2,0.8,0.2,1), box-shadow .3s ease";
        const mm = (e: PointerEvent) => {
          const r = a.getBoundingClientRect();
          const mx = e.clientX - (r.left + r.width / 2);
          const my = e.clientY - (r.top + r.height / 2);
          a.style.transform =
            "translate(" + (mx * 0.22).toFixed(1) + "px," + (my * 0.3).toFixed(1) + "px)";
        };
        const ml = () => {
          a.style.transform = "translate(0,0)";
        };
        a.addEventListener("pointermove", mm);
        a.addEventListener("pointerleave", ml);
        cleanups.push(() => {
          a.removeEventListener("pointermove", mm);
          a.removeEventListener("pointerleave", ml);
        });
      });
    }

    // ── reveal on scroll ──
    const reveals = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            (en.target as HTMLElement).style.opacity = "1";
            (en.target as HTMLElement).style.transform = "translateY(0)";
          }
        });
      },
      { threshold: 0.2 },
    );
    reveals.forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());

    // ── how-it-works stepper ──
    const howSec = root.querySelector<HTMLElement>("#gpx-how");
    const tabs = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
    const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-steppanel]"));
    const DWELL = 5200;
    let step = 0;
    let inView = false;
    let auto: ReturnType<typeof setInterval> | null = null;
    let stepTT: ReturnType<typeof setTimeout> | null = null;

    const stopType = () => {
      if (stepTT) {
        clearTimeout(stepTT);
        stepTT = null;
      }
    };
    const startType = () => {
      const wrap = howSec && howSec.querySelector<HTMLElement>("[data-howtyper]");
      if (!wrap) return;
      stopType();
      const out = wrap.firstChild as HTMLElement | null;
      if (!out) return;
      const str = "fly to Tokyo in business this fall";
      if (reduced) {
        out.textContent = str;
        return;
      }
      out.textContent = "";
      let ci = 0;
      const ty = () => {
        if (ci <= str.length) {
          out.textContent = str.slice(0, ci);
          ci++;
          stepTT = setTimeout(ty, 56);
        }
      };
      ty();
    };
    const activatePanel = (i: number) => {
      panels.forEach((pnl, k) => {
        const on = k === i;
        pnl.style.transition = "none";
        pnl.style.opacity = on ? "1" : "0";
        pnl.style.pointerEvents = on ? "auto" : "none";
        pnl.querySelectorAll<HTMLElement>("[data-anim]").forEach((el) => {
          el.style.transition = "none";
          el.style.opacity = on ? "1" : "0";
          el.style.transform = on
            ? el.dataset.final || "translateY(0)"
            : el.dataset.hidden || "translateY(22px)";
        });
      });
      if (i === 1) startType();
      else stopType();
    };
    const setStep = (i: number) => {
      step = i;
      tabs.forEach((t, k) => {
        const on = k === i;
        t.style.background = on ? "color-mix(in srgb,var(--iris) 12%,transparent)" : "transparent";
        t.style.borderLeftColor = on ? "var(--iris)" : "transparent";
        const bar = t.querySelector<HTMLElement>("[data-stepbar]");
        const fill = t.querySelector<HTMLElement>("[data-stepfill]");
        if (bar) bar.style.opacity = on ? "1" : "0";
        if (fill) {
          fill.style.transition = "none";
          fill.style.width = "0%";
          if (on) {
            void fill.offsetWidth;
            fill.style.transition = "width " + DWELL + "ms linear";
            fill.style.width = "100%";
          }
        }
      });
      activatePanel(i);
    };
    const stopAuto = () => {
      if (auto) {
        clearInterval(auto);
        auto = null;
      }
    };
    const startAuto = () => {
      stopAuto();
      if (reduced) return;
      auto = setInterval(() => setStep((step + 1) % tabs.length), DWELL);
    };
    const tabH = tabs.map((t, i) => {
      const h = () => {
        setStep(i);
        if (inView) startAuto();
      };
      t.addEventListener("click", h);
      return h;
    });
    const onEnter = () => stopAuto();
    const onLeaveHow = () => {
      if (inView) startAuto();
    };
    if (howSec) {
      howSec.addEventListener("mouseenter", onEnter);
      howSec.addEventListener("mouseleave", onLeaveHow);
    }
    let howIO: IntersectionObserver | null = null;
    if (howSec) {
      howIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              inView = true;
              setStep(step);
              startAuto();
            } else {
              inView = false;
              stopAuto();
            }
          });
        },
        { threshold: 0.3 },
      );
      howIO.observe(howSec);
    }
    setStep(0);
    cleanups.push(() => {
      stopAuto();
      stopType();
      tabs.forEach((t, i) => t.removeEventListener("click", tabH[i]));
      if (howSec) {
        howSec.removeEventListener("mouseenter", onEnter);
        howSec.removeEventListener("mouseleave", onLeaveHow);
      }
      if (howIO) howIO.disconnect();
    });

    return () => {
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* noop */
        }
      });
    };
  }, []);

  return (
    <div
      id="gpx-hero"
      data-root
      ref={rootRef}
      style={{
        position: "relative",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--tx1)",
        fontFamily: "var(--fs)",
        overflowX: "hidden",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div dangerouslySetInnerHTML={{ __html: MARKUP }} />
    </div>
  );
}
