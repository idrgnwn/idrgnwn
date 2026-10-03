/**
 * The tagline, typed out one character at a time with a blinking caret.
 *
 * THE LAYOUT CONSTRAINT THIS IS BUILT AROUND: `.jarvis-hero` is a fit-content
 * block, so its width IS this string's max-content width. Revealing the text by
 * growing a substring would therefore re-measure the hero on every keystroke and
 * visibly resize the whole column, hologram included.
 *
 * So the finished string is always in the DOM, in a hidden span that reserves
 * the real box, and the animation is painted on top of it:
 *
 *   ghost  — `visibility: hidden`, full text. Layout only. Nothing else here
 *            contributes width or height, so the hero measures exactly what it
 *            measured before the animation was introduced — 538.48px at the
 *            current 54-character tagline, constant across all 55 steps.
 *   typed  — absolutely positioned over the ghost, carries the visible
 *            characters and the caret. Out of flow, so it cannot affect width.
 *   label  — screen-reader copy (`.sr-only`), read once as a whole sentence.
 *            The other two are aria-hidden: `visibility: hidden` already keeps
 *            the ghost out of the accessibility tree, and announcing a
 *            half-typed string letter by letter would be noise.
 *
 * The sentence lives in the markup, not here — this script reads it off the
 * ghost span, so index.html stays the single source of truth for the copy.
 * With JS off, `typed` stays empty and the <noscript> block in index.html makes
 * the ghost visible instead, so the sentence still renders.
 */
(function () {
  "use strict";

  /** Per-character delay. The tagline's 54 characters at 42ms is a ~2.2s run. */
  var CHAR_MS = 42;

  /** Beat before the first character, so the hero settles first. */
  var START_MS = 500;

  var REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

  function init() {
    var ghost = document.querySelector(".jarvis-tagline-ghost");
    var typed = document.querySelector(".jarvis-tagline-typed");
    var caret = document.querySelector(".jarvis-caret");
    if (!ghost || !typed || !caret) return;

    var text = ghost.textContent;
    var count = 0;
    var startTimer = 0;
    var tickTimer = 0;

    var query = window.matchMedia(REDUCED_MOTION);

    // One text node, written in place, sitting immediately before the caret.
    // Rewriting `typed.innerHTML` per character would instead destroy and
    // recreate the caret element, which restarts its CSS animation — and would
    // reparse markup 54 times for what is a string assignment.
    var textNode = typed.insertBefore(document.createTextNode(""), caret);

    var render = function (shown, done) {
      textNode.nodeValue = shown;

      // `data-done` switches the caret from solid-while-typing to blinking once
      // the sentence lands — a caret that blinks mid-word reads as a stall
      // rather than as typing.
      if (done) caret.setAttribute("data-done", "");
      else caret.removeAttribute("data-done");
    };

    var clear = function () {
      clearTimeout(startTimer);
      clearInterval(tickTimer);
      startTimer = 0;
      tickTimer = 0;
    };

    var run = function () {
      clear();

      // Reduced motion skips the reveal outright — the sentence is simply there.
      if (query.matches) {
        count = text.length;
        render(text, true);
        return;
      }

      render(text.slice(0, count), count >= text.length);
      if (count >= text.length) return;

      startTimer = setTimeout(function () {
        tickTimer = setInterval(function () {
          if (count >= text.length) {
            clearInterval(tickTimer);
            tickTimer = 0;
            return;
          }
          count += 1;
          render(text.slice(0, count), count >= text.length);
        }, CHAR_MS);
      }, START_MS);
    };

    // Flipping the OS setting mid-run re-evaluates from the current character,
    // the same way the React effect did when its dependency changed.
    if (query.addEventListener) query.addEventListener("change", run);
    else if (query.addListener) query.addListener(run); // Safari < 14

    run();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
