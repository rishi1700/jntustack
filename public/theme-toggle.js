/* JNTUStack — Night Study theme toggle
   Dark is the default (the :root tokens). "light" is the only stored override.
   Serve this from /theme-toggle.js and include it once, site-wide.
   Pair it with a <button id="themeToggle" class="theme-toggle"></button> in the header. */
(function () {
  var KEY = "ns-theme";
  var root = document.documentElement;

  function apply(mode) {
    if (mode === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme"); // absent = dark (default tokens)
    var btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = mode === "light" ? "☾ Night" : "☀ Day";
  }

  // Apply saved preference immediately (this file is in <head>, so no flash).
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved === "light" ? "light" : "dark");

  function wire() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    apply(root.getAttribute("data-theme") === "light" ? "light" : "dark");
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      try { localStorage.setItem(KEY, next); } catch (e) {}
      apply(next);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
