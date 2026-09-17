// components/shared/lib/__tests__/tracing-background.test.js
'use strict';

describe('SCOPE_VERSION resolution', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses SERVICE_VERSION when set', () => {
    process.env.SERVICE_VERSION = '9.9.9-test';
    const { _SCOPE_VERSION_FOR_TEST } = require('../tracing-background');
    expect(_SCOPE_VERSION_FOR_TEST).toBe('9.9.9-test');
  });

  it('falls back to package.json version when SERVICE_VERSION unset', () => {
    delete process.env.SERVICE_VERSION;
    jest.spyOn(process, 'cwd').mockReturnValue('/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/components/document-repository');
    const { _SCOPE_VERSION_FOR_TEST } = require('../tracing-background');
    // Must be a non-default semver string from the actual repo root package.json.
    expect(_SCOPE_VERSION_FOR_TEST).toMatch(/^\d+\.\d+\.\d+/);
    expect(_SCOPE_VERSION_FOR_TEST).not.toBe('1.0.0');
  });

  it('falls back to "1.0.0" when no env and no package.json readable', () => {
    delete process.env.SERVICE_VERSION;
    jest.spyOn(process, 'cwd').mockReturnValue('/nonexistent');
    const { _SCOPE_VERSION_FOR_TEST } = require('../tracing-background');
    expect(_SCOPE_VERSION_FOR_TEST).toBe('1.0.0');
  });
});
