/* JNTUStack — Teal brand theme toggle
   Light is the default (the :root tokens). "dark" is the only stored override.
   Serve this from /theme-toggle.js and include it once, site-wide.
   Pair it with a <button id="themeToggle" class="theme-toggle"></button> in the header. */
(function () {
  var KEY = "ts-theme";
  var root = document.documentElement;

  function apply(mode) {
    if (mode === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme"); // absent = light (default tokens)
    var btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = mode === "dark" ? "☀ Day" : "☾ Night";
  }

  // Apply saved preference immediately (this file is in <head>, so no flash).
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved === "dark" ? "dark" : "light");

  function wire() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    apply(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, next); } catch (e) {}
      apply(next);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
