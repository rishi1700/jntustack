/* Shared responsive navigation for JNTUStack.
   The `js` class lets CSS collapse the menu only when this controller loaded,
   so navigation remains available when JavaScript is disabled. */
(function () {
  document.documentElement.classList.add('js');

  function wire() {
    var menuButton = document.getElementById('mobileNavToggle');
    var nav = document.getElementById('topNav');
    var branches = document.querySelector('.nav-branches');
    var branchesButton = document.querySelector('.nav-branches-toggle');
    if (!menuButton || !nav) return;

    function setBranches(open) {
      if (!branches || !branchesButton) return;
      branches.dataset.open = open ? 'true' : 'false';
      branchesButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function setMenu(open) {
      nav.dataset.open = open ? 'true' : 'false';
      menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) setBranches(false);
    }

    menuButton.addEventListener('click', function () {
      setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
    });

    if (branchesButton) {
      branchesButton.addEventListener('click', function () {
        setBranches(branchesButton.getAttribute('aria-expanded') !== 'true');
      });
    }

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a') && window.matchMedia('(max-width: 900px)').matches) setMenu(false);
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('.site-header')) setMenu(false);
      if (branches && !event.target.closest('.nav-branches')) setBranches(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var menuWasOpen = menuButton.getAttribute('aria-expanded') === 'true';
        var branchesWereOpen = branchesButton && branchesButton.getAttribute('aria-expanded') === 'true';
        if (!menuWasOpen && !branchesWereOpen) return;
        setMenu(false);
        if (menuWasOpen && window.matchMedia('(max-width: 900px)').matches) menuButton.focus();
        else if (branchesWereOpen && branchesButton) branchesButton.focus();
      }
    });

    window.addEventListener('resize', function () {
      if (!window.matchMedia('(max-width: 900px)').matches) setMenu(false);
    });

    setMenu(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
