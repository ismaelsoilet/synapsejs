(function () {
  try {
    var root = document.documentElement;
    var mode = localStorage.getItem('showcase.theme') || 'system';
    var accent = localStorage.getItem('showcase.accent') || 'cyan';
    var motion = localStorage.getItem('showcase.motion') || 'on';
    var resolved = mode === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : mode;
    root.dataset.theme = resolved;
    root.dataset.themeMode = mode;
    root.dataset.accent = accent;
    root.dataset.motion = motion;
    root.style.colorScheme = resolved;
  } catch (error) {
    /* storage disabled: keep the default dark theme */
  }
})();
