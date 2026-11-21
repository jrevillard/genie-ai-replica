// Copyright (C) 2026 ITU
// SPDX-License-Identifier: Apache-2.0
/**
 * Static contract checks for the ROCm Ansible path.
 *
 * Four defects were found in reviews, all of them "the play fails on every
 * host" or "the operator gets an opaque error" — none of them reachable by
 * the pipeline's job list, because the ROCm plays run against a real ROCm
 * host that CI does not have:
 *
 *   1. a `failed_when` that read `gpu_groups.results` INSIDE a loop
 *      (`register` binds the per-item result there, so the attribute does
 *      not exist and Jinja raised on every host);
 *   2. an inventory group name that did not match the group_vars/
 *      directory, so none of the ROCm variables — or the vault — loaded;
 *   3. an empty `gpu_public_domain` that reached the certificate task and
 *      died as an openssl error instead of a named assertion;
 *   4. (the collapse) a SECOND GPU playbook — deploy-gpu-rocm.yml — whose
 *      standalone existence was the vendor file-set drift the MR review
 *      rejected. The ROCm plays now live in deploy-gpu.yml, host-scoped to
 *      rocm_gpu_nodes, and their variables load through vars_files (NOT
 *      group_vars/: a directory there must match an inventory group name,
 *      which is defect 2's root cause — vars_files makes the load explicit
 *      and cannot silently mismatch).
 *
 * These are static checks, not a play run: they read the files and assert
 * the shape that the fixes established.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const ANSIBLE_DIR = path.join(ROOT, 'deploy', 'ansible');
const PLAYBOOK = path.join(ANSIBLE_DIR, 'deploy-gpu.yml');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('ROCm ansible contract', () => {
  describe('deploy-gpu.yml (one playbook, both vendors)', () => {
    let play;

    beforeAll(() => {
      play = read(PLAYBOOK);
    });

    it('exists and the standalone ROCm playbook is gone', () => {
      expect(fs.existsSync(PLAYBOOK)).toBe(true);
      expect(fs.existsSync(path.join(ANSIBLE_DIR, 'deploy-gpu-rocm.yml'))).toBe(false);
    });

    it('targets both vendor groups', () => {
      const targets = [...play.matchAll(/hosts:\s*(\S+)/g)].map((m) => m[1]);
      expect(targets.length).toBeGreaterThan(0);
      expect(targets).toContain('itu_rtx_gpu_api');
      expect(targets).toContain('rocm_gpu_nodes');
    });

    it('loads the ROCm vars through vars_files, not group_vars', () => {
      // group_vars/<dir>/ resolves by INVENTORY GROUP NAME — the root cause
      // of the silent-variable defect. vars_files makes the load explicit:
      // a missing file aborts the play loudly instead of leaving every
      // variable undefined.
      const varsFiles = [...play.matchAll(/vars_files:/g)].length;
      expect(varsFiles).toBeGreaterThanOrEqual(4); // detect + verification + prepare + deploy + smoke ≥ 4 plays
      expect(play).toContain('vars/rocm_gpu_nodes.yml');
      expect(play).toContain('vars/vault-rocm-gpu.yml');
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
      // match the vars_files entry that actually loads it.
      expect(play).toMatch(/vars\/vault-rocm-gpu\.yml/);
    });

    it('enables the rocm-models profile on the GPU-node deploy', () => {
      // The pooling services (vllm-reranker, vllm-embedding) are
      // profile-gated: without --profile rocm-models the compose up runs
      // green and deploys a node WITHOUT its reranker/embedder — and every
      // smoke test then fails 502. Compose has no env-file equivalent
      // (COMPOSE_PROFILES is CLI-level), so the flag must be in the
      // command.
      const deployBlock = play.split('- name: Deploy ROCm GPU node services')[1] || '';
      expect(deployBlock).toMatch(/--profile rocm-models/);
    });

    it('renders ONE compose template (no overlay file is copied)', () => {
      // The vendor axis is the template's gpu_vendor conditionals. A copy
      // of a second compose file here would resurrect the file-set drift.
      expect(play).not.toMatch(/docker-compose\.rocm/);
      expect(play).toMatch(/docker-compose\.gpu\.yaml\.j2/);
    });
  });

  describe('the ROCm vars file', () => {
    it('lives at the vars_files path and carries the vendor marker', () => {
      const varsPath = path.join(ANSIBLE_DIR, 'vars', 'rocm_gpu_nodes.yml');
      expect(fs.existsSync(varsPath)).toBe(true);
      const vars = read(varsPath);
      expect(vars).toMatch(/^gpu_vendor:\s*rocm$/m);
    });

    it('no group_vars/rocm_gpu_nodes directory lingers', () => {
      // A lingering group_vars directory resolves by inventory group name
      // and would shadow (or double-load) the vars_files entry.
      expect(fs.existsSync(path.join(ANSIBLE_DIR, 'group_vars', 'rocm_gpu_nodes'))).toBe(false);
    });

    it('no live file still points at the old group_vars path', () => {
      // `rocm_gpu_api` was the directory name before the rename; a live
      // reference to it means an operator is pointed at a path that does
      // not resolve.
      const live = [
        PLAYBOOK,
        path.join(ANSIBLE_DIR, 'README.md'),
        path.join(ROOT, 'site', 'content', 'en', 'docs', 'deploy', 'gpu.md'),
        path.join(ROOT, 'docs', 'helm-k8s-rocm-handoff.md')
      ];
      for (const file of live) {
        expect(read(file)).not.toMatch(/rocm_gpu_api/);
      }
    });
  });

  describe('inventory and compose template agree', () => {
    it('the shared GPU inventory example carries both vendor groups', () => {
      const inventory = read(path.join(ANSIBLE_DIR, 'inventory', 'gpu.ini.example'));
      const groups = [...inventory.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1].trim());
      expect(groups).toEqual(expect.arrayContaining(['itu_rtx_gpu_api', 'rocm_gpu_nodes']));
    });

    it('the standalone ROCm inventory example is gone', () => {
      expect(fs.existsSync(path.join(ANSIBLE_DIR, 'inventory', 'rocm_gpu.ini.example'))).toBe(false);
    });

    it('the compose template renders the ROCm bits only under the vendor marker', () => {
      // The template is shared with NVIDIA nodes: the ROCm-only services
      // and device rows must sit inside a gpu_vendor == 'rocm' conditional,
      // or an NVIDIA node's render would gain ROCm services (or fail on
      // missing ROCm vars).
      const tpl = read(path.join(ANSIBLE_DIR, 'templates', 'docker-compose.gpu.yaml.j2'));
      const rocmBlocks = [...tpl.matchAll(/gpu_vendor is defined and gpu_vendor == 'rocm'/g)].length;
      // vllm-llm, vllm-translation, and the pooling-pair block.
      expect(rocmBlocks).toBeGreaterThanOrEqual(3);

      // Each pooling service name must sit after a rocm vendor marker:
      // scan back to the most recent Jinja conditional and require it to
      // gate on gpu_vendor.
      const nearestIfAbove = (idx) => {
        const open = tpl.lastIndexOf('{% if', idx);
        return open === -1 ? '' : tpl.slice(open, open + 120);
      };
      for (const service of ['vllm-reranker:', 'vllm-embedding:']) {
        const idx = tpl.indexOf(service);
        expect(idx).toBeGreaterThan(-1);
        expect({ service, gate: nearestIfAbove(idx) }).toEqual({
          service,
          gate: expect.stringMatching(/gpu_vendor/)
        });
      }
    });
  });
});
