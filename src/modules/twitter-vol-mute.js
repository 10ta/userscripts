/*
 * Keep X / Twitter videos muted unless I turn the sound on myself.
 *
 * One rule: any change TOWARD sound needs a recent action of mine; any AUTOMATIC
 * stop takes the sound away. At most one video has sound at a time.
 *
 *   play / volumechange, video has sound
 *     - it is the video I allowed          -> keep
 *     - I just used a player control       -> allow it (and mute the previous one)
 *     - otherwise                          -> mute
 *   the allowed video
 *     - gets muted (by anyone)             -> permission revoked
 *     - pauses without an action of mine   -> mute + revoke   (scrolled away, removed, ended)
 *     - pauses right after I clicked/keyed -> keep            (my own pause)
 *     - leaves the screen completely       -> mute + revoke
 *
 * Event driven only. Global capture listeners for play/volumechange; the pause
 * listener and the IntersectionObserver are attached to the one allowed video
 * only (pause is listened on the element itself, so it is still heard when X
 * removes the element from the page), and detached when permission is revoked.
 */
const ACTION_MS = 500; // a change this soon after my click / keypress counts as mine

// Keys that act on the player: mute, play/pause, seek.
const PLAYER_KEYS = new Set(['m', 'M', 'k', 'K', ' ', 'ArrowLeft', 'ArrowRight', 'j', 'J', 'l', 'L']);

register({
  id: 'x-video-mute',
  name: '视频保持静音',
  description: 'Keep X/Twitter videos muted until unmuted by hand; one video at a time, muted again when it stops or leaves the screen.',
  enabledByDefault: true,
  match: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
  run() {
    // Two strengths of "recent action of mine":
    //   lastControl — a player control (button, slider, player key): may turn sound ON.
    //   lastAction  — any click / player key: marks a pause as mine (clicking the
    //                 video surface to pause counts).
    let lastControl = 0;
    let lastAction = 0;
    const recent = t => Date.now() - t <= ACTION_MS;

    document.addEventListener('pointerdown', e => {
      if (!e.isTrusted) return;
      lastAction = Date.now();
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('button, [role="button"], [role="slider"], input[type="range"]')) lastControl = lastAction;
    }, true);
    document.addEventListener('keydown', e => {
      if (!e.isTrusted || !PLAYER_KEYS.has(e.key)) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return; // typing, not the player
      lastAction = lastControl = Date.now();
    }, true);

    let allowed = null; // { video, onPause, observer } — the one video allowed to have sound

    const mute = video => { if (!video.muted) video.muted = true; };

    const revoke = () => {
      if (!allowed) return;
      allowed.video.removeEventListener('pause', allowed.onPause);
      if (allowed.observer) allowed.observer.disconnect();
      allowed = null;
    };

    const silence = video => {
      if (allowed && allowed.video === video) revoke();
      mute(video);
    };

    const grant = video => {
      if (allowed) {
        const previous = allowed.video;
        revoke();
        mute(previous); // only one video with sound
      }
      const onPause = () => { if (!recent(lastAction)) silence(video); };
      video.addEventListener('pause', onPause);
      let observer = null;
      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(entries => {
          if (entries.some(entry => !entry.isIntersecting)) silence(video);
        });
        observer.observe(video);
      }
      allowed = { video, onPause, observer };
    };

    const check = e => {
      const video = e.target;
      if (!(video instanceof HTMLMediaElement)) return;
      const isAllowed = allowed && allowed.video === video;
      if (video.muted) {
        if (isAllowed) revoke(); // muted by me or X: sound needs a new action of mine
        return;
      }
      if (isAllowed) return;
      if (recent(lastControl)) grant(video);
      else mute(video);
    };
    // Media events don't bubble, but capture listeners on document still see them.
    document.addEventListener('play', check, true);
    document.addEventListener('volumechange', check, true);
  },
});