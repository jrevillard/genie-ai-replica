// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — AccessPanel behavior tests: revoke wiring, picker grant flow.
// David's field report (2026-10-17): "cannot remove grants once users have
// access" — no revoke POST ever reached kong. These tests pin the client
// side of the contract: the Revoke button MUST call revokeAccess.

jest.mock('../../services/repoOkfService', () => ({
  getAccess: jest.fn(),
  getAccessUsers: jest.fn(),
  putAccess: jest.fn(),
  grantAccess: jest.fn(),
  revokeAccess: jest.fn(),
  grantGroupAccess: jest.fn(),
  revokeGroupAccess: jest.fn()
}));

import { mount } from '@vue/test-utils';
import AccessPanel from '../../components/okf/editor/AccessPanel.vue';
import repoOkfService from '../../services/repoOkfService';

const REPO = 'r-test-0001';

function baseModel() {
  return {
    restricted: true,
    required_scopes: [`okf:t:${REPO}:admin`],
    user_holders: [
      { user_id: 'u1', username: 'alice', levels: ['read'], via: 'user' },
      { user_id: 'u2', username: 'bob', levels: ['read'], via: 'role' }
    ],
    group_holders: [{ group_id: 'g1', name: 'curators', levels: ['read'] }],
    configured: true
  };
}

async function mountedPanel() {
  repoOkfService.getAccess.mockResolvedValue(baseModel());
  const w = mount(AccessPanel, {
    props: { repoId: REPO },
    global: { stubs: { teleport: true } }
  });
  await w.vm.$nextTick();
  await w.vm.$nextTick();
  return w;
}

describe('OkfAccessPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('the holders table renders and Revoke calls revokeAccess with the username', async () => {
    const w = await mountedPanel();
    const rows = w.findAll('.okf-access__table tbody tr');
    expect(rows.length).toBe(3); // 1 group + 2 users

    repoOkfService.revokeAccess.mockResolvedValue({ ok: true });
    // Click the FIRST table's Revoke (group), then the user rows.
    await w
      .findAll('button')
      .filter((b) => b.text().includes('Revoke'))[1]
      .trigger('click');
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(repoOkfService.revokeAccess).toHaveBeenCalledWith(REPO, { username: 'alice' });
  });

  test('group Revoke calls revokeGroupAccess', async () => {
    const w = await mountedPanel();
    repoOkfService.revokeGroupAccess.mockResolvedValue({ ok: true, removed: ['read'] });
    await w
      .findAll('button')
      .filter((b) => b.text().includes('Revoke'))[0]
      .trigger('click');
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(repoOkfService.revokeGroupAccess).toHaveBeenCalledWith(REPO, { group: 'curators' });
  });

  test('picker: search renders users with has_access marks; grant sends usernames', async () => {
    const w = await mountedPanel();
    repoOkfService.getAccessUsers.mockResolvedValue({
      q: '',
      total_matching: 2,
      users: [
        { id: 'u1', username: 'alice', name: 'Alice', email: 'a@x', has_access: true },
        { id: 'u3', username: 'carol', name: 'Carol', email: 'c@x', has_access: false }
      ]
    });
    await w
      .findAll('button')
      .filter((b) => b.text().includes('Grant access to users'))[0]
      .trigger('click');
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(repoOkfService.getAccessUsers).toHaveBeenCalledWith(REPO, '');

    const boxes = w.findAll('.okf-access__picker-list input[type="checkbox"]');
    // granted row has NO checkbox — it gets an inline Revoke instead
    expect(boxes.length).toBe(1);
    expect(boxes[0].attributes('disabled')).toBeUndefined();
    expect(w.findAll('.okf-access__picker-list button').filter((b) => b.text().trim() === 'Revoke').length).toBe(1);

    await boxes[0].setValue(true);
    repoOkfService.grantAccess.mockResolvedValue({ ok: true, granted: ['carol'] });
    const grantBtn = w.findAll('button').filter((b) => b.text().includes('Grant access ('));
    expect(grantBtn.length).toBeGreaterThan(0);
    await grantBtn[0].trigger('click');
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(repoOkfService.grantAccess).toHaveBeenCalledWith(REPO, { usernames: ['carol'] });
  });

  test('picker: granted rows expose inline Revoke — the grant surface is the revoke surface', async () => {
    const w = await mountedPanel();
    repoOkfService.getAccessUsers.mockResolvedValue({
      q: '',
      total_matching: 1,
      users: [{ id: 'u1', username: 'alice', name: 'Alice', email: 'a@x', has_access: true }]
    });
    await w
      .findAll('button')
      .filter((b) => b.text().includes('Grant access to users'))[0]
      .trigger('click');
    await w.vm.$nextTick();
    await w.vm.$nextTick();

    // No checkbox for granted rows; a Revoke button instead (scoped to the
    // picker list — the holders table behind the dialog has its own Revokes).
    expect(w.findAll('.okf-access__picker-list input[type="checkbox"]').length).toBe(0);
    const revokeBtn = w.findAll('.okf-access__picker-list button').filter((b) => b.text().trim() === 'Revoke');
    expect(revokeBtn.length).toBe(1);

    repoOkfService.revokeAccess.mockResolvedValue({ ok: true });
    // The picker refresh re-queries after the revoke.
    repoOkfService.getAccessUsers.mockResolvedValue({
      q: '',
      total_matching: 1,
      users: [{ id: 'u1', username: 'alice', name: 'Alice', email: 'a@x', has_access: false }]
    });
    await revokeBtn[0].trigger('click');
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(repoOkfService.revokeAccess).toHaveBeenCalledWith(REPO, { username: 'alice' });
    expect(repoOkfService.getAccessUsers.mock.calls.length).toBeGreaterThan(1);
  });
});
