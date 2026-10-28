/*
 * The error screen a deployment sees when the runtime configuration is
 * rejected.
 *
 * The runtime config is fetched before the app is created and validated
 * against the schema it carries. A validation failure is an operator
 * error — the served file does not match the schema it declares — and the
 * app must not mount with a config it just refused. Without this screen
 * the operator gets a blank page and a console line: in production that
 * is indistinguishable from a broken deploy, and the only trace of the
 * cause is the browser console of whoever happens to open it.
 *
 * The screen is plain DOM on purpose. It is rendered before Vue exists,
 * it must not depend on the theme tokens (the config is what carries
 * them, and it is exactly what failed), and it must render in both
 * themes without a stylesheet that may not have loaded.
 */

const CONFIG_PATH = '/config/genie-ai-config.json';

const CONTAINER_ID = 'genie-config-error';

const styles = `
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #0f1412;
  color: #e8f0ea;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
`;

const panelStyles = `
  max-width: 760px;
  width: 100%;
  border: 1px solid #2f4a37;
  border-left: 4px solid #d95c4f;
  border-radius: 8px;
  background: #16201b;
  padding: 24px 28px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
`;

const titleStyles = `
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
  color: #f3d9d4;
`;

const leadStyles = `
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.5;
  color: #b9c9be;
`;

const detailStyles = `
  margin: 0 0 16px;
  padding: 14px 16px;
  border-radius: 6px;
  background: #0d1512;
  border: 1px solid #2a4030;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  color: #e8f0ea;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 40vh;
  overflow: auto;
`;

const hintStyles = `
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.6;
  color: #b9c9be;
`;

const buttonStyles = `
  appearance: none;
  border: 1px solid #3d6b48;
  border-radius: 6px;
  background: #234a2c;
  color: #e8f0ea;
  font-size: 14px;
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
`;

const buttonHoverStyles = `
  background: #2b5a35;
`;

/**
 * Renders the configuration error as the whole interface.
 *
 * @param {Error|string} error - the failure raised by the config loader.
 * @param {Document} [doc] - the document to render into (tests inject one).
 * @returns {HTMLElement} the container element.
 */
function renderConfigError(error, doc = document) {
  const message = error instanceof Error ? error.message : String(error);

  const existing = doc.getElementById(CONTAINER_ID);
  if (existing) existing.remove();

  const container = doc.createElement('div');
  container.id = CONTAINER_ID;
  container.setAttribute('role', 'alert');
  container.setAttribute('data-testid', 'config-error-screen');
  container.setAttribute('style', styles);

  const panel = doc.createElement('div');
  panel.setAttribute('style', panelStyles);

  const title = doc.createElement('h1');
  title.setAttribute('style', titleStyles);
  title.textContent = 'Configuration error — the application cannot start';
  panel.appendChild(title);

  const lead = doc.createElement('p');
  lead.setAttribute('style', leadStyles);
  lead.textContent = `The runtime configuration served at ${CONFIG_PATH} was rejected: it does not satisfy the schema it declares. The application was not mounted.`;
  panel.appendChild(lead);

  const detail = doc.createElement('pre');
  detail.setAttribute('style', detailStyles);
  detail.setAttribute('data-testid', 'config-error-detail');
  detail.textContent = message;
  panel.appendChild(detail);

  const hint = doc.createElement('p');
  hint.setAttribute('style', hintStyles);
  hint.textContent =
    'This is a deployment problem, not a user problem. The file the host serves must be the one the branch ships: re-seed the runtime config directory (config_bootstrap) so it mirrors the branch, or fix the configuration in the repository and deploy again.';
  panel.appendChild(hint);

  const reload = doc.createElement('button');
  reload.setAttribute('type', 'button');
  reload.setAttribute('style', buttonStyles);
  reload.setAttribute('data-testid', 'config-error-reload');
  reload.textContent = 'Reload';
  reload.addEventListener('mouseenter', () => {
    reload.setAttribute('style', buttonStyles + buttonHoverStyles);
  });
  reload.addEventListener('mouseleave', () => {
    reload.setAttribute('style', buttonStyles);
  });
  reload.addEventListener('click', () => {
    doc.defaultView?.location.reload();
  });
  panel.appendChild(reload);

  container.appendChild(panel);
  doc.body.appendChild(container);
  return container;
}

export { renderConfigError, CONFIG_PATH };
export default renderConfigError;
