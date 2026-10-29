// The configuration error screen.
//
// A rejected runtime config used to leave the browser with a blank page
// and a console line. The screen is the operator's only view of what
// went wrong, so the tests below pin what it must carry: the failing
// paths, the file it came from, and a way out.

const { renderConfigError } = require('../config-error-screen');

describe('configuration error screen', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the failing paths from the loader error', () => {
    const error = new Error(
      'genie-ai-config.json failed schema validation:\n' +
        "  /features/chat/quickHelp/buttons/0 must have required property 'styles'\n" +
        '  /features/chat/welcomeMessage must be string'
    );
    renderConfigError(error);

    const screen = document.querySelector('[data-testid="config-error-screen"]');
    expect(screen).not.toBeNull();
    expect(screen.getAttribute('role')).toBe('alert');

    const detail = document.querySelector('[data-testid="config-error-detail"]');
    expect(detail.textContent).toContain("buttons/0 must have required property 'styles'");
    expect(detail.textContent).toContain('/features/chat/welcomeMessage must be string');
  });

  it('names the file the configuration was served from', () => {
    renderConfigError(new Error('boom'));
    const screen = document.querySelector('[data-testid="config-error-screen"]');
    expect(screen.textContent).toContain('/config/genie-ai-config.json');
  });

  it('offers a reload for a configuration that was fixed on the host', () => {
    renderConfigError(new Error('boom'));
    const reload = document.querySelector('[data-testid="config-error-reload"]');
    expect(reload).not.toBeNull();
    expect(reload.tagName).toBe('BUTTON');
  });

  it('renders one screen only, replacing a previous one', () => {
    renderConfigError(new Error('first'));
    renderConfigError(new Error('second'));
    const screens = document.querySelectorAll('[data-testid="config-error-screen"]');
    expect(screens.length).toBe(1);
    expect(screens[0].textContent).toContain('second');
  });

  it('accepts a plain string failure', () => {
    renderConfigError('not an Error instance');
    const detail = document.querySelector('[data-testid="config-error-detail"]');
    expect(detail.textContent).toBe('not an Error instance');
  });
});
