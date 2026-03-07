(({ marked }) => {
  const MAX_LENGTH = 40000;
  const cmEl = document.getElementById('editor');
  const textArea = document.getElementById('pasteTextArea');
  const editorTab = document.getElementById('tab1');
  const editorForm = document.getElementById('editor-form');
  const previewTab = document.getElementById('tab2');
  const previewContainer = document.getElementById('preview-container');
  const characterCount = document.getElementById('characterCount');

  // onload, reset to editorTab
  editorTab.click();

  const editor = new CodeMirror(cmEl, {
    mode: 'markdown',
    value: textArea.value,
    keymap: 'sublime',
    theme: 'default',
    viewportMargin: Infinity
  });

  window.cmEditor = editor;

  const updateCharacterCount = (count) => {
    characterCount.innerText = `${count}/${MAX_LENGTH}`;
  };

  updateCharacterCount(textArea.value.length);

  const updateTextArea = debounce((value) => {
    textArea.value = value;
  }, 1500);

  const onChange = (_instance, _change) => {
    const value = editor.getValue();
    textArea.value = value;
    updateCharacterCount(value.length);
    updateTextArea(value);
  };

  const onBeforeChange = (instance, change) => {
    if (change.update) {
      const newLine = instance.getDoc().lineSeparator();
      let text = change.text.join(newLine);
      let delta = text.length - (instance.indexFromPos(change.to) - instance.indexFromPos(change.from));
      if (delta <= 0) return true;

      delta = instance.getValue().length + delta - MAX_LENGTH;
      if (delta > 0) {
        text = text.substr(0, text.length - delta);
        change.update(change.from, change.to, text.split(newLine));
      }
    }

    return true;
  };

  editor.on('change', onChange);
  editor.on('beforeChange', onBeforeChange);

  editorTab.addEventListener('click', () => {
    editor.refresh();
  });

  editorForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    textArea.value = editor.getValue();
    editorForm.submit();
  });

  previewTab.addEventListener('change', () => {
    const raw = marked.parse(editor.getValue(), { breaks: true });
    previewContainer.innerHTML = sanitizeHtml(raw);
  });

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,style').forEach(
      (el) => el.remove()
    );
    doc.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
        if (
          ['href', 'src', 'action'].includes(attr.name) &&
          el.getAttribute(attr.name).trim().toLowerCase().startsWith('javascript:')
        ) {
          el.removeAttribute(attr.name);
        }
      }
    });
    return doc.body.innerHTML;
  }

  function debounce(cb, wait) {
    let timer;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => cb(...args), wait);
    };
  }
})(window);
