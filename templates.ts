import { MODE } from './env.ts';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _if = (condition: unknown, template: string) => (
  condition ? template : ''
);

const Tabs = () => `
  <input type="radio" name="tabs" id="tab1" class="tab-input" checked />
  <label class="tab" for="tab1">Editor</label>
  <input type="radio" name="tabs" id="tab2" class="tab-input" />
  <label class="tab" for="tab2">Preview</label>
  <span id="characterCount" class="character-count"></span>
`;

const Editor = (paste = '') => `
  <div id="editor-container">
    <textarea id="pasteTextArea" name="paste" required>${escapeHtml(paste)}</textarea>
    <div id="editor"></div>
  </div>

  <div id="preview-container">
  </div>
`;

const layout = (title: string, content: string, meta: { ogDesc?: string } = {}) => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="raw markdown pastebin">
    <meta property="og:title" content="${escapeHtml(title) || 'mdgist'}">
    <meta property="og:description" content="${escapeHtml(meta.ogDesc || 'raw markdown pastebin')}">
    <meta property="og:type" content="website">
    <link rel="stylesheet" href="/codemirror.min.css">
    <link rel="stylesheet" href="/main.css">
    <title>${escapeHtml(title) || 'mdgist'}</title>
  </head>
  <body>
    <header>
      <div class="header-inner">
        <a href="/" class="logo">mdgist</a>
        <nav>
          <a href="/">New</a>
          <a href="/guide">Guide</a>
        </nav>
        <button id="darkSwitch" class="theme-toggle" type="button" aria-label="Toggle theme">
          <span class="theme-icon"></span>
        </button>
      </div>
    </header>

    ${_if(MODE === 'demo', `
      <div role="alert" class="demo-alert">
        <strong>Demo instance</strong> &mdash; posts are automatically deleted every few minutes.
      </div>
    `)}

    ${content}

    <footer></footer>
    <script src="/theme-switch.js"></script>
  </body>
  </html>
`;

export const homePage = ({
  paste = '',
  url = '',
  errors = { url: '' },
} = {}) => layout('mdgist', `
  <main>
    ${Tabs()}

    <form id="editor-form" method="post" action="/save">
      ${Editor(paste)}

      <div class="form-row">
        <div class="form-group">
          <input
            name="url"
            type="text"
            placeholder="Custom URL (optional)"
            minlength="3"
            maxlength="40"
            value="${escapeHtml(url)}"
            pattern=".*\\S+.*"
            aria-invalid="${Boolean(errors.url)}"
            ${_if(errors.url, 'aria-describedby="url-error"')}
          />
          ${_if(errors.url, `
            <small class="error" id="url-error">${escapeHtml(errors.url)}</small>
          `)}
        </div>
        <div class="form-group">
          <input
            name="editcode"
            type="text"
            placeholder="Edit code (optional)"
            minlength="3"
            maxlength="40"
          />
        </div>
        <div class="form-group">
          <select name="ttl" class="ttl-select">
            <option value="">No expiry</option>
            <option value="3600000">1 hour</option>
            <option value="86400000">1 day</option>
            <option value="604800000">1 week</option>
            <option value="2592000000">30 days</option>
          </select>
        </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  </main>
  <script src="/marked.min.js"></script>
  <script src="/codemirror.min.js"></script>
  <script src="/cm-markdown.min.js"></script>
  <script src="/cm-sublime.min.js"></script>
  <script src="/editor.js"></script>
`);

export const pastePage = ({ id = '', html = '', title = '' } = {}) => {
  return layout(title, `
  <main>
    <article class="paste-container">
      ${html}
    </article>
    <div class="form-actions">
      <a class="btn btn-secondary" href="/${escapeHtml(id)}/raw">Raw</a>
      <a class="btn btn-secondary" href="/${escapeHtml(id)}/edit">Edit</a>
      <a class="btn btn-secondary" href="/${escapeHtml(id)}/history">History</a>
      <a class="btn btn-danger" href="/${escapeHtml(id)}/delete">Delete</a>
    </div>
  </main>
`);
};

export const guidePage = ({ html = '', title = '' } = {}) => layout(title, `
  <main>
    <article class="paste-container">
      ${html}
    </article>
  </main>
`);

export const editPage = (
  {
    id = '',
    paste = '',
    hasEditCode = false,
    errors = { editCode: '' },
  } = {},
) => layout(`Edit - ${id}`, `
  <main>
    ${Tabs()}

    <form id="editor-form" method="post" action="/${escapeHtml(id)}/save">
      ${Editor(paste)}

      <input class="sr-only" name="url" type="text" value="${escapeHtml(id)}" disabled />
      <div class="form-row">
        ${_if(hasEditCode, `
          <div class="form-group">
            <input
              name="editcode"
              type="text"
              placeholder="Edit code"
              minlength="3"
              maxlength="40"
              required
              aria-invalid="${Boolean(errors.editCode)}"
              ${_if(errors.editCode, 'aria-describedby="editcode-error"')}
            />

            ${_if(errors.editCode, `
              <small class="error" id="editcode-error">${escapeHtml(errors.editCode)}</small>
            `)}
          </div>
        `)}
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  </main>
  <script src="/marked.min.js"></script>
  <script src="/codemirror.min.js"></script>
  <script src="/cm-markdown.min.js"></script>
  <script src="/cm-sublime.min.js"></script>
  <script src="/editor.js"></script>
`);

export const deletePage = (
  { id = '', hasEditCode = false, errors = { editCode: '' } } = {}
) => {
  return layout(`Delete - ${id}`, `
  <main>
    <div class="delete-confirm">
      <p>Are you sure you want to delete <strong>${escapeHtml(id)}</strong>?</p>
    </div>
    <form method="post" action="/${escapeHtml(id)}/delete">
      <div class="form-row">
        ${_if(hasEditCode, `
          <div class="form-group">
            <input
              name="editcode"
              type="text"
              placeholder="Edit code"
              minlength="3"
              maxlength="40"
              required
              aria-invalid="${Boolean(errors.editCode)}"
              ${_if(errors.editCode, 'aria-describedby="editcode-error"')}
            />

            ${_if(errors.editCode, `
              <small class="error" id="editcode-error">${escapeHtml(errors.editCode)}</small>
            `)}
          </div>
        `)}
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-danger">Delete</button>
        <a class="btn btn-secondary" href="/${escapeHtml(id)}">Cancel</a>
      </div>
    </form>
  </main>
`);
};

export const errorPage = () => layout('404', `
  <main class="error-page">
    <h1>404</h1>
    <p>That paste doesn't exist. Maybe it was deleted?</p>
    <a href="/" class="btn btn-primary">Create a new paste</a>
  </main>
`);

export const historyPage = (
  { id = '', versions = [] as { timestamp: number }[] } = {},
) => {
  return layout(`History - ${id}`, `
  <main>
    <div class="paste-container">
      <h1>History &mdash; ${escapeHtml(id)}</h1>
      ${versions.length === 0 ? '<p>No edit history yet.</p>' : `
        <ul class="history-list">
          ${versions.map((v: { timestamp: number }) => `
            <li>
              <a href="/${escapeHtml(id)}/history/${v.timestamp}">
                ${new Date(v.timestamp).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC')}
              </a>
            </li>
          `).join('')}
        </ul>
      `}
      <div class="form-actions">
        <a class="btn btn-secondary" href="/${escapeHtml(id)}">Back to paste</a>
      </div>
    </div>
  </main>
`);
};
