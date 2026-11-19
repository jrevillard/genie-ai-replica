// Copyright (C) 2026 ITU
// SPDX-License-Identifier: Apache-2.0
/**
 * Static contract checks for the ROCm Ansible path.
 *
 * Three defects were found in the !968 review, all of them "the play
 * fails on every host" or "the operator gets an opaque error" — none of
 * them reachable by the pipeline's job list, because the ROCm playbook
 * runs against a real ROCm host that CI does not have:
 *
 *   1. a `failed_when` that read `gpu_groups.results` INSIDE a loop
 *      (`register` binds the per-item result there, so the attribute does
 *      not exist and Jinja raised on every host);
 *   2. an inventory group name that did not match the group_vars/
 *      directory, so none of the ROCm variables — or the vault — loaded;
 *   3. an empty `gpu_public_domain` that reached the certificate task and
 *      died as an openssl error instead of a named assertion.
 *
 * These are static checks, not a play run: they read the files and assert
 * the shape that the fixes established.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const ANSIBLE_DIR = path.join(ROOT, 'deploy', 'ansible');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('ROCm ansible contract', () => {
  describe('deploy-gpu-rocm.yml', () => {
    let play;

    beforeAll(() => {
      play = read(path.join(ANSIBLE_DIR, 'deploy-gpu-rocm.yml'));
    });

    it('does not read `.results` from a register bound inside a loop', () => {
      // A `register` inside a `loop:` binds the PER-ITEM result to the
      // variable name, so `gpu_groups.results` does not exist there — the
      // expression raised "object of type 'dict' has no attribute
      // 'results'" and failed the task on every host. The `results` key is
      // only assembled once the loop has finished.
      //
      // Scanned per TASK (comment lines stripped): a task that both loops
      // and registers is the dangerous shape. `item.item` is equally wrong
      // in such a task — `item` IS the loop value (the group name), not a
      // per-item result object.
      const code = play
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');

      const tasks = code.split(/^ {4}- name:/m).slice(1);
      expect(tasks.length).toBeGreaterThan(0);

      const loopingRegisterTasks = tasks.filter((t) => /(^|\s)loop:/.test(t) && /register:/.test(t));
      expect(loopingRegisterTasks.length).toBeGreaterThan(0);

      const resultOffenders = loopingRegisterTasks.filter((t) => /failed_when:[^\n]*\.results\b/.test(t));
      expect(resultOffenders).toEqual([]);

      const itemItemOffenders = loopingRegisterTasks.filter((t) => /item\.item/.test(t));
      expect(itemItemOffenders).toEqual([]);
    });

    it('asserts gpu_public_domain is set and non-empty', () => {
      // An empty domain renders `-subj "/CN="` and the SAN as `DNS:`;
      // openssl then exits 1 without writing server.crt.
      expect(play).toMatch(/gpu_public_domain is defined and gpu_public_domain \| length > 0/);
    });

    it('names the vault path in the assertion message', () => {
      // The operator is told exactly which file to edit; the path must
      // match the group_vars directory that actually exists.
      expect(play).toMatch(/group_vars\/rocm_gpu_nodes\/vault\.yml/);
    });
  });

  describe('inventory and group_vars agree', () => {
    it('the inventory group name resolves the group_vars directory', () => {
      // Ansible resolves `group_vars/<name>/` by the INVENTORY GROUP NAME,
      // not by the directory name. A mismatch means every variable in the
      // directory (and the vault inside it) is invisible to the play.
      const inventory = read(path.join(ANSIBLE_DIR, 'inventory', 'rocm_gpu.ini.example'));
      const groups = [...inventory.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1].trim());
      expect(groups).toContain('rocm_gpu_nodes');

      const varsDir = path.join(ANSIBLE_DIR, 'group_vars', 'rocm_gpu_nodes');
      expect(fs.existsSync(varsDir)).toBe(true);
      expect(fs.existsSync(path.join(varsDir, 'vars.yml'))).toBe(true);
    });

    it('the playbook targets the same group as the inventory', () => {
      const play = read(path.join(ANSIBLE_DIR, 'deploy-gpu-rocm.yml'));
      const targets = [...play.matchAll(/hosts:\s*(\S+)/g)].map((m) => m[1]);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(target).toBe('rocm_gpu_nodes');
      }
    });

    it('no live file still points at the old group_vars path', () => {
      // `rocm_gpu_api` was the directory name before the rename; a live
      // reference to it means an operator is pointed at a path that does
      // not resolve.
      const live = [
        path.join(ANSIBLE_DIR, 'deploy-gpu-rocm.yml'),
        path.join(ANSIBLE_DIR, 'README.md'),
        path.join(ROOT, 'site', 'content', 'en', 'docs', 'deploy', 'gpu.md'),
        path.join(ROOT, 'docs', 'helm-k8s-rocm-handoff.md')
      ];
      for (const file of live) {
        expect(read(file)).not.toMatch(/rocm_gpu_api/);
      }
    });
  });
});
