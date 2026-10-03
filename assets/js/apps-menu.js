/**
 * The waffle (apps grid) menu in the top nav.
 *
 * The dropdown's markup lives in index.html and is toggled with the `hidden`
 * attribute — in the React build it was mounted and unmounted instead. The
 * visible result is the same, and the accessibility contract is unchanged:
 * `hidden` removes the element from the accessibility tree exactly as
 * unmounting did, so a screen reader never announces a closed menu.
 *
 * Dismissal matches the original: outside pointer-down, or Escape. The
 * listeners are only attached while the menu is open, so a closed menu costs
 * nothing on every click and keypress in the page.
 */
(function () {
  "use strict";

  function init() {
    var wrap = document.querySelector(".jarvis-waffle-wrap");
    if (!wrap) return;
    var button = wrap.querySelector(".jarvis-waffle-btn");
    var menu = wrap.querySelector(".jarvis-apps");
    if (!button || !menu) return;

    var open = false;

    var onPointerDown = function (e) {
      if (!wrap.contains(e.target)) setOpen(false);
    };

    var onKey = function (e) {
      if (e.key === "Escape") {
        setOpen(false);
        // Focus would otherwise be left on <body>, stranding keyboard users at
        // the top of the document rather than back on the control they used.
        button.focus();
      }
    };

    function setOpen(next) {
      if (next === open) return;
      open = next;
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));

      if (open) {
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("touchstart", onPointerDown);
        document.addEventListener("keydown", onKey);
      } else {
        document.removeEventListener("mousedown", onPointerDown);
        document.removeEventListener("touchstart", onPointerDown);
        document.removeEventListener("keydown", onKey);
      }
    }

    button.addEventListener("click", function () {
      setOpen(!open);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
