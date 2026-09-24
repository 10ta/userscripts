/*
 * Keep X / Twitter videos muted unless I turn the sound on myself.
 *
 * Principle: never fight X's player from outside. Muting is done by clicking
 * X's own mute button, so X's internal state, its icon and the <video> always
 * agree (writing video.muted directly made them drift apart: sound with a
 * "muted" icon, and stalls while X re-initialised the player).
 *
 * Rules (at most one video has sound):
 *   - A video becomes unmuted within 500 ms of MY click on its mute button
 *     (or the "m" key)                        -> allowed; the previous one is muted
 *   - A video has sound any other way         -> muted (autoplay, X restoring volume,
 *                                                scrubbing, new/re-created players)
 *   - The allowed video gets muted            -> permission revoked
 *   - The allowed video fully leaves the screen -> muted, permission revoked
 *
 * The mute button has no data-testid and its aria-label follows the UI language,
 * so it is recognised by its speaker icon (plus known labels as a fallback).
 */
const ACTION_MS = 500;

// Speaker body, shared by the "mute" and "unmute" icons.
const SPEAKER_PATH = 'M14 22h-2.35';
// Sound waves: only in the icon shown while the video HAS sound (button action = mute).
const WAVES_PATH = 'M20.817 5.098';
const MUTE_LABELS = ['Mute', 'Unmute', '静音', '取消静音', 'Couper le son', 'Activer le son'];

const isMuteButton = el =>
  !!el && el.matches('button') &&
  (!!el.querySelector(`svg path[d^="${SPEAKER_PATH}"]`) || MUTE_LABELS.includes(el.getAttribute('aria-label')));

register({
  id: 'x-video-mute',
  name: '视频保持静音',
  description: 'Keep X/Twitter videos muted until unmuted by hand (via X\'s own mute button); one video at a time, muted again when it leaves the screen.',
  enabledByDefault: true,
  match: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
  run() {
    // --- my actions --------------------------------------------------------
    let lastUnmute = { time: 0, button: null }; // my click on a mute button, or "m"

    document.addEventListener('click', e => {
      if (!e.isTrusted) return; // our own programmatic clicks are not "mine"
      const button = e.target instanceof Element ? e.target.closest('button') : null;
      if (isMuteButton(button)) lastUnmute = { time: Date.now(), button };
    }, true);
    document.addEventListener('keydown', e => {
      if (!e.isTrusted || (e.key !== 'm' && e.key !== 'M')) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
      lastUnmute = { time: Date.now(), button: null };
    }, true);

    // --- the video's own player ---------------------------------------------
    // Walk up from the video until an ancestor contains a mute button.
    const findMuteButton = video => {
      for (let el = video.parentElement, depth = 0; el && depth < 15; el = el.parentElement, depth++) {
        const btn = [...el.querySelectorAll('button')].find(isMuteButton);
        if (btn) return btn;
      }
      return null;
    };

    const byMe = video => {
      if (Date.now() - lastUnmute.time > ACTION_MS) return false;
      // A click must be on THIS video's mute button; the "m" key has no button.
      return !lastUnmute.button || findMuteButton(video) === lastUnmute.button;
    };

    // Mute through X's button when it shows the "has sound" icon, so X stays in
    // sync. Otherwise (no controls rendered, or X's icon already says muted while
    // sound plays) set the property directly as a last resort.
    const muteViaX = video => {
      if (video.muted) return;
      const btn = findMuteButton(video);
      if (btn && btn.querySelector(`svg path[d^="${WAVES_PATH}"]`)) btn.click();
      if (!video.muted) video.muted = true;
    };

    // --- permission ------------------------------------------------------------
    let allowed = null; // { video, observer }

    const revoke = () => {
      if (!allowed) return;
      if (allowed.observer) allowed.observer.disconnect();
      allowed = null;
    };

    const grant = video => {
      if (allowed) {
        const previous = allowed.video;
        revoke();
        muteViaX(previous); // only one video with sound
      }
      let observer = null;
      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(entries => {
          if (entries.some(entry => !entry.isIntersecting)) {
            revoke();
            muteViaX(video);
          }
        });
        observer.observe(video);
      }
      allowed = { video, observer };
    };

    const check = e => {
      const video = e.target;
      if (!(video instanceof HTMLMediaElement)) return;
      const isAllowed = allowed && allowed.video === video;
      if (video.muted) {
        if (isAllowed) revoke();
        return;
      }
      if (isAllowed) return;
      if (byMe(video)) grant(video);
      else muteViaX(video);
    };
    // Media events don't bubble, but capture listeners on document still see them.
    document.addEventListener('volumechange', check, true);
    document.addEventListener('play', check, true);
  },
});