(() => {
  const KEY = 'mdgist-theme';
  const btn = document.getElementById('darkSwitch');

  const setMode = (mode) => {
    localStorage.setItem(KEY, mode);
    document.body.setAttribute('data-theme', mode);

    if (window.cmEditor) {
      window.cmEditor.setOption('theme', mode === 'd' ? 'material' : 'default');
    }
  };

  let mode = localStorage.getItem(KEY);
  if (!mode) {
    mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'd'
      : 'l';
  }

  setMode(mode);

  btn.addEventListener('click', () => {
    mode = mode === 'd' ? 'l' : 'd';
    setMode(mode);
  });
})();
