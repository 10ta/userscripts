/*
 * Keep X / Twitter videos muted unless I unmute them myself.
 *
 * - Anything that unmutes a video without a user action (X restoring the last
 *   volume, autoplay, switching posts) is undone immediately.
 * - Only one video may have sound: unmuting another one mutes the previous.
 * - Once unmuted, the video is muted again as soon as less than half of it is
 *   on screen, and the permission is revoked (scrolling back keeps it muted).
 *
 * Event driven only: a capture-phase volumechange listener plus one
 * IntersectionObserver for the video that currently has sound.
 */
const GESTURE_MS = 500;      // a volumechange this soon after a click/keypress is mine
const VISIBLE_RATIO = 0.5;   // below this much of the video on screen -> mute again

register({
  id: 'x-video-mute',
  name: '视频保持静音',
  description: 'Keep X/Twitter videos muted until unmuted by hand; only one video at a time, muted again when scrolled away.',
  enabledByDefault: true,
  match: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
  run() {
    let lastGesture = 0;
    let allowed = null;      // the one video allowed to have sound
    let observer = null;
    let muting = false;      // set while we mute, so our own change is ignored

    // Only button-like targets count: clicking the video itself plays it or opens
    // the post, and X may unmute as part of that — which is what we want to block.
    const onGesture = e => {
      if (!e.isTrusted) return;
      const el = e.target instanceof Element ? e.target : null;
      if (e.type === 'keydown' || (el && el.closest('button, [role="button"], input[type="range"]'))) {
        lastGesture = Date.now();
      }
    };
    for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, onGesture, true);

    const mute = video => {
      muting = true;
      video.muted = true;
      muting = false;
    };

    const revoke = () => {
      if (observer) { observer.disconnect(); observer = null; }
      allowed = null;
    };

    const watch = video => {
      if (typeof IntersectionObserver === 'undefined') return;
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.intersectionRatio < VISIBLE_RATIO) {
            mute(video);
            revoke();
          }
        }
      }, { threshold: [VISIBLE_RATIO] });
      observer.observe(video);
    };

    document.addEventListener('volumechange', e => {
      const video = e.target;
      if (muting || !(video instanceof HTMLMediaElement) || video.muted) return;

      if (video === allowed) return;                       // already approved
      if (Date.now() - lastGesture > GESTURE_MS) {         // nobody asked for this
        mute(video);
        return;
      }
      if (allowed && allowed !== video) mute(allowed);     // only one video with sound
      revoke();
      allowed = video;
      watch(video);
    }, true);
  },
});