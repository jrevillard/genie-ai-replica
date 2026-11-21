// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The AMD ROCm (Strix Halo / gfx1151) GPU profile against the validator's
 * GPU_RANGES table.
 *
 * `env.strixhalo` is the sizing profile for the ROCm venue: 33 pins that
 * decide what the GPU tier claims from the shared host's memory (45.8 GiB
 * GTT aperture, 27 GB operator ceiling). The config-validator's
 * `parseGpuProfile` was only ever called against `env.t4` and
 * `env.rtx6000`, so the ROCm profile drifted from the GPU_RANGES vocabulary
 * silently - a pin outside the table escapes every range check, and a pin
 * inside the table but wrong for the venue (a utilization fraction that
 * fits its own range but blows the shared budget) is not caught at all.
 *
 * `config-validation.test.js` already asserts the aggregate for this file
 * (no errors, no unknown parameters) and pins the two backend enums. This
 * file owns what the aggregate cannot express:
 *
 *   - the per-pin contract: every pin satisfies its own GPU_RANGES entry
 *     (type AND range), named per pin so a failure says which one drifted;
 *   - the presence contract: every non-optional GPU_RANGES entry is
 *     actually set by the profile - the shipped validator checks the
 *     values that happen to be there, never that a required one is;
 *   - the measured pins: the exact values the ROCm venue is sized for.
 *     Each is a decision taken against a measurement, so a change is a
 *     deliberate edit on both sides rather than an accident;
 *   - the shared-budget invariant: the utilization fractions the profile
 *     claims are fractions of the 45.8 GiB GTT aperture, so the tier's
 *     claim is their SUM - a budget no per-variable range check can
 *     express;
 *   - negative controls: a mutated copy of the profile is rejected, so
 *     the gate is known to fail when it should.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const { validateHardwareProfile, parseGpuProfile, GPU_RANGES } = require('../validators/validate-hardware');
const { parseComposeEnvVars } = require('../validators/parse-compose');

const ROOT = path.resolve(__dirname, '../../..');
const STRIXHALO_FILE = path.join(ROOT, 'env.strixhalo');
// The vendor axis lives IN the base files now — their `${VAR:-default}`
// rows are what the venue resolves when the profile leaves a knob unset.
const BASE_COMPOSE_FILE = path.join(ROOT, 'docker-compose.yaml');
const BASE_GPU_COMPOSE_FILE = path.join(ROOT, 'docker-compose.gpu.yaml');

const PROFILE_NAME = 'STRIX HALO (iGPU unified memory)';

// The GTT aperture the ROCm utilization fractions are taken of, and the
// operator's ceiling for the whole GPU tier. Both are measured facts of the
// reference venue, recorded in
// docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md
// (`rocm-smi --showmeminfo gtt` -> 49,218,076,672 B = 45.8 GiB) and in the
// profile's own header. The sum check below is the reason the fractions are
// pinned: each one fits GPU_RANGES on its own while their total does not.
//
// The ceiling is the profile's own number ("the operator's budget for the
// whole GPU tier peaked at 27 GB", decision 2026-11-11), compared against
// the same GiB-scale claim the profile derives from the aperture - 0.28 of
// 45.8 GiB is the "~12.8 GiB" the header states. The profile's own total
// line ("measured <= ~22 GB") is a measured peak, slightly under the
// fraction sum this test computes (0.50 x 45.8 GiB = 22.9 GiB).
const GTT_APERTURE_GIB = 45.8;
const GPU_TIER_CEILING_GIB = 27;

// The pins the ROCm venue is sized for. Every value here is the value in
// env.strixhalo - the table is the profile's contract, so a retune has to
// be a visible edit on both sides.
const MEASURED_PINS = [
  // Main LLM (granite-3.1-2b, shared-era sizing).
  ['VLLM_LLM_MODEL_ID', 'ibm-granite/granite-3.1-2b-instruct'],
  ['VLLM_GPU_UTILIZATION', '0.28'],
  ['VLLM_MAX_MODEL_LEN', '49152'],
  ['VLLM_MAX_NUM_SEQS', '16'],
  ['VLLM_DTYPE', 'half'],
  // Translation LLM (gemma-3-1b-it).
  ['VLLM_TRANSLATION_MODEL_ID', 'google/gemma-3-1b-it'],
  ['VLLM_TRANSLATION_GPU_UTILIZATION', '0.12'],
  ['VLLM_TRANSLATION_MAX_MODEL_LEN', '8192'],
  ['VLLM_TRANSLATION_MAX_NUM_SEQS', '16'],
  ['VLLM_TRANSLATION_DTYPE', 'auto'],
  // vLLM reranker (the TEI ROCm image cannot run on gfx1151).
  ['VLLM_RERANKER_MODEL_ID', 'BAAI/bge-reranker-v2-m3'],
  ['RERANKER_VLLM_MODEL', 'BAAI/bge-reranker-v2-m3'],
  ['VLLM_RERANKER_GPU_UTILIZATION', '0.05'],
  ['VLLM_RERANKER_MAX_MODEL_LEN', '8192'],
  // Backends: both consumers move to their own vLLM instance on the GPU.
  ['EMBEDDING_BACKEND', 'vllm'],
  ['RERANKER_BACKEND', 'vllm'],
  ['EMBEDDING_VLLM_ENDPOINT', 'http://vllm-embedding:8000'],
  ['RERANKER_VLLM_ENDPOINT', 'http://vllm-reranker:8000'],
  // Vendor image pins (the base files' defaults are the NVIDIA builds;
  // this profile pins the ROCm/CPU builds — the spike winners).
  ['VLLM_IMAGE', 'rocm/vllm:rocm10.1.0_ubuntu24.04_py3.14-pytorch_2.13.0_vllm-0.29.0'],
  ['TEI_EMBEDDING_IMAGE', 'ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3'],
  ['TEI_RERANKING_IMAGE', 'ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3'],
  // Vendor device passthrough + the neutralized NVIDIA claim.
  ['GPU_DEVICE_KFD', '/dev/kfd'],
  ['GPU_DEVICE_DRI', '/dev/dri'],
  ['NVIDIA_VISIBLE_DEVICES', 'void'],
  // TEI runs the CPU image here - GPU-sized batch knobs inflate candle's
  // buffer pools on CPU (16.3 GiB RSS measured at 8192/32).
  ['TEI_RERANKING_MAX_BATCH_TOKENS', '2048'],
  ['TEI_RERANKING_MAX_CONCURRENT_REQUESTS', '8'],
  ['TEI_EMBEDDING_MAX_BATCH_TOKENS', '2048'],
  ['TEI_RERANKING_AUTO_TRUNCATE', 'true'],
  // Docling has no ROCm support - the CUDA probe falls back to CPU anyway.
  ['DOCLING_DEVICE', 'cpu'],
  // Device group GIDs (distro-specific; measure with `getent group`).
  ['RENDER_GID', '990'],
  ['VIDEO_GID', '44']
];

// The knobs the profile deliberately leaves to the base files. `env.strixhalo`
// does not pin them; the base compose ships the default, and that default is
// what the venue runs.
const BASE_OWNED = new Map(
  [BASE_COMPOSE_FILE, BASE_GPU_COMPOSE_FILE].flatMap((file) =>
    parseComposeEnvVars(file).map((v) => [v.name, v.default === null ? undefined : v.default])
  )
);

const profile = parseGpuProfile(STRIXHALO_FILE);

/**
 * The value a knob takes on the ROCm venue: the profile's pin when it has
 * one, otherwise the base file's default - the order compose resolves
 * `${VAR:-default}` in.
 *
 * @param {string} name - the variable name
 * @param {Array<{ name: string, value: string }>} variables - the profile to read
 * @returns {string|undefined}
 */
function effectiveValue(name, variables) {
  const pinned = variables.find((v) => v.name === name);
  if (pinned) return pinned.value;
  return BASE_OWNED.get(name);
}

/**
 * Per-pin GPU_RANGES conformance.
 *
 * The shipped `validateHardwareProfile` aggregates the same information
 * into one error list; this returns one violation per pin so a failure
 * names the pin that drifted.
 *
 * @param {Array<{ name: string, value: string }>} variables - the profile to check
 * @returns {string[]} the violations, empty when the profile conforms
 */
function gpuRangeViolations(variables) {
  const violations = [];

  for (const { name, value } of variables) {
    const range = GPU_RANGES[name];
    if (!range) {
      violations.push(`${name}='${value}' has no GPU_RANGES entry`);
      continue;
    }

    if (range.type === 'enum') {
      if (!range.values.includes(value)) {
        violations.push(`${name}='${value}' not in valid values: [${range.values.join(', ')}]`);
      }
      continue;
    }

    if (range.type === 'string') {
      if (value === '') {
        violations.push(`${name} is empty`);
      }
      continue;
    }

    // Numeric: the whole value must be a number of the declared type.
    // `parseFloat` alone would accept '0.28abc' (it reads 0.28) and
    // '49152.5' for an int knob (it reads 49152.5) - both reach vLLM as a
    // malformed flag.
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      violations.push(`${name}='${value}' is not a valid number`);
      continue;
    }

    const numVal = Number(trimmed);
    if (range.type === 'int' && !Number.isInteger(numVal)) {
      violations.push(`${name}=${numVal} is not an integer`);
      continue;
    }
    if (numVal < range.min || numVal > range.max) {
      violations.push(`${name}=${numVal} out of range [${range.min}, ${range.max}]`);
    }
  }

  return violations;
}

/**
 * The GPU_RANGES entries the profile must set.
 *
 * A GPU_RANGES entry without `optional: true` is required: the shipped
 * validator never checks presence, so a dropped pin is invisible to it.
 *
 * @param {Array<{ name: string }>} variables - the profile to check
 * @returns {string[]} the missing required names
 */
function missingRequiredVariables(variables) {
  const present = new Set(variables.map((v) => v.name));
  return Object.entries(GPU_RANGES)
    .filter(([, range]) => !range.optional)
    .map(([name]) => name)
    .filter((name) => !present.has(name));
}

/**
 * The GPU tier's claim on the GTT aperture.
 *
 * Each utilization fraction is a share of the aperture, so the tier's claim
 * is their SUM. Four fractions at the top of their individual ranges would
 * each pass GPU_RANGES and together claim several times the aperture.
 *
 * @param {Array<{ name: string, value: string }>} variables - the profile to size
 * @returns {{ total: number, claimedGib: number, withinCeiling: boolean }}
 */
function gpuTierBudget(variables) {
  // All four vLLM instances carve the same aperture: the main LLM, the
  // translation LLM, the reranker and the embedder. The embedder's share
  // comes from the base-file default (the profile does not pin it), which is
  // why the sum resolves it through `effectiveValue`.
  const shares = [
    'VLLM_GPU_UTILIZATION',
    'VLLM_TRANSLATION_GPU_UTILIZATION',
    'VLLM_RERANKER_GPU_UTILIZATION',
    'VLLM_EMBEDDING_GPU_UTILIZATION'
  ];
  const total = shares.reduce((sum, name) => sum + Number(effectiveValue(name, variables)), 0);
  const claimedGib = total * GTT_APERTURE_GIB;
  return {
    total: Number(total.toFixed(3)),
    claimedGib: Number(claimedGib.toFixed(1)),
    withinCeiling: claimedGib <= GPU_TIER_CEILING_GIB
  };
}

/**
 * Write a mutated copy of the profile into a temp dir.
 *
 * The filename keeps the `env.strixhalo` suffix so `parseGpuProfile`
 * resolves the same profile name for the copy as for the real file.
 *
 * @param {(content: string) => string} mutate - the mutation to apply
 * @returns {string} the path of the mutated copy
 */
function writeMutatedProfile(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocm-profile-'));
  const file = path.join(dir, 'env.strixhalo');
  fs.writeFileSync(file, mutate(fs.readFileSync(STRIXHALO_FILE, 'utf8')));
  return file;
}

describe('ROCm (Strix Halo) GPU profile', () => {
  describe('profile shape', () => {
    test('every variable the profile sets has a GPU_RANGES entry', () => {
      // The vocabulary sync: a pin the validator does not know escapes
      // every range check - the shipped validator reports it only as a
      // warning.
      const unknown = profile.variables.map((v) => v.name).filter((name) => !GPU_RANGES[name]);
      expect(unknown).toEqual([]);
    });

    test('every required GPU_RANGES entry is set by the profile', () => {
      expect(missingRequiredVariables(profile.variables)).toEqual([]);
    });
  });

  describe('GPU_RANGES conformance', () => {
    test('every pin satisfies its own GPU_RANGES entry', () => {
      expect(gpuRangeViolations(profile.variables)).toEqual([]);
    });

    test('the shipped validator reports no error for the profile', () => {
      // The production owner of the range rule, asserted here so this file
      // stands alone as the ROCm profile gate. config-validation.test.js
      // asserts the same aggregate; what it cannot express is which pin
      // drifted, that a required pin is present at all, or that the tier's
      // sum fits the shared budget.
      const result = validateHardwareProfile(STRIXHALO_FILE, PROFILE_NAME);
      expect(result.errors).toEqual([]);
      expect(result.warnings.filter((w) => w.includes('Unknown GPU parameter'))).toEqual([]);
    });
  });

  describe('measured pins', () => {
    test.each(MEASURED_PINS)('%s is pinned to %s', (name, expected) => {
      const pinned = profile.variables.find((v) => v.name === name);
      expect(pinned).toBeDefined();
      expect(pinned.value).toBe(expected);
    });
  });

  describe('base-file sizing vocabulary', () => {
    // The profile test above only reaches the knobs env.strixhalo PINS.
    // The base files own the rest — and a knob the validator does
    // not know escapes every range check (the shipped validator reports it
    // only as a warning). RERANKER_VLLM_MAX_MODEL_LEN lived in exactly that
    // hole: the base files read it, the profile does not pin it, and
    // nothing asserted the two were in step. This closes the class, not the
    // case.
    const SIZING_KNOB = /(MAX_MODEL_LEN|GPU_UTILIZATION|MAX_BATCH_TOKENS|MAX_CONCURRENT_REQUESTS)/;

    test('every sizing knob the base GPU files read has a GPU_RANGES entry', () => {
      const names = new Set();
      for (const file of [BASE_COMPOSE_FILE, BASE_GPU_COMPOSE_FILE]) {
        for (const v of parseComposeEnvVars(file)) {
          if (SIZING_KNOB.test(v.name)) names.add(v.name);
        }
      }
      expect(names.size).toBeGreaterThan(0);
      const unknown = [...names].filter((n) => !GPU_RANGES[n]).sort();
      expect(unknown).toEqual([]);
    });

    test('the client-side rerank window pin is in step with the server knob', () => {
      // The two must describe the SAME window: the instance is started with
      // VLLM_RERANKER_MAX_MODEL_LEN, and the wrapper is told the served
      // window with RERANKER_VLLM_MAX_MODEL_LEN. A client pin that drifts
      // from the server pin enforces the length contract against the wrong
      // number.
      const client = GPU_RANGES.RERANKER_VLLM_MAX_MODEL_LEN;
      const server = GPU_RANGES.VLLM_RERANKER_MAX_MODEL_LEN;
      expect(client).toBeDefined();
      expect(client).toEqual(server);
    });
  });

  describe('ROCm service wiring', () => {
    test('the TEI images are the CPU build', () => {
      // The ROCm TEI image fails on gfx1151 (Instinct-only kernels), so
      // the spike's decision was the CPU image. A ROCm-flavoured TEI pin
      // here is a service that never becomes healthy on the venue.
      for (const name of ['TEI_EMBEDDING_IMAGE', 'TEI_RERANKING_IMAGE']) {
        const image = profile.variables.find((v) => v.name === name).value;
        expect(image).toMatch(/^ghcr\.io\/huggingface\/text-embeddings-inference:cpu-/);
        expect(image).not.toMatch(/rocm/i);
      }
    });

    test('the vLLM image is the ROCm build', () => {
      const image = profile.variables.find((v) => v.name === 'VLLM_IMAGE').value;
      expect(image).toMatch(/^rocm\/vllm:/);
    });

    test('the vLLM endpoints name the pooling services', () => {
      // The endpoints address the profile's services by compose name; a
      // renamed service leaves the wrapper resolving nothing at request
      // time, long after the profile parsed fine.
      const endpoint = (name) => new URL(profile.variables.find((v) => v.name === name).value).hostname;
      expect(endpoint('EMBEDDING_VLLM_ENDPOINT')).toBe('vllm-embedding');
      expect(endpoint('RERANKER_VLLM_ENDPOINT')).toBe('vllm-reranker');
    });
  });

  describe('shared GPU-tier budget', () => {
    test('the utilization fractions sum under the operator ceiling', () => {
      const budget = gpuTierBudget(profile.variables);
      expect(budget.withinCeiling).toBe(true);
      expect(budget.claimedGib).toBeLessThanOrEqual(GPU_TIER_CEILING_GIB);
    });

    test('the embedder sizing comes from the base-file default', () => {
      // env.strixhalo does not pin the embedder's share; the base compose
      // does, and that default is what the venue runs.
      expect(profile.variables.some((v) => v.name === 'VLLM_EMBEDDING_GPU_UTILIZATION')).toBe(false);
      expect(effectiveValue('VLLM_EMBEDDING_GPU_UTILIZATION', profile.variables)).toBe('0.05');
      expect(effectiveValue('VLLM_EMBEDDING_MAX_MODEL_LEN', profile.variables)).toBe('512');
    });
  });

  describe('negative controls', () => {
    const mutatedDirs = [];

    afterAll(() => {
      for (const dir of mutatedDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    /**
     * Write a mutated profile copy and register its directory for cleanup.
     *
     * @param {(content: string) => string} mutate - the mutation to apply
     * @returns {string} the path of the mutated copy
     */
    function mutatedProfile(mutate) {
      const file = writeMutatedProfile(mutate);
      mutatedDirs.push(path.dirname(file));
      return file;
    }

    test('an out-of-range pin is rejected', () => {
      const file = mutatedProfile((content) =>
        content.replace(/^VLLM_MAX_MODEL_LEN=.*$/m, 'VLLM_MAX_MODEL_LEN=262144')
      );
      const result = validateHardwareProfile(file, PROFILE_NAME);
      expect(result.errors.join('\n')).toContain('VLLM_MAX_MODEL_LEN');
      expect(result.errors.join('\n')).toContain('out of range');
      expect(gpuRangeViolations(parseGpuProfile(file).variables).join('\n')).toContain('VLLM_MAX_MODEL_LEN');
    });

    test('a missing required pin is rejected', () => {
      const file = mutatedProfile((content) => content.replace(/^VLLM_MAX_NUM_SEQS=.*\n/m, ''));
      expect(missingRequiredVariables(parseGpuProfile(file).variables)).toContain('VLLM_MAX_NUM_SEQS');
    });

    test('a pin outside the vocabulary is rejected', () => {
      const file = mutatedProfile((content) => `${content}\nVLLM_FUTURE_KNOB=1\n`);
      const result = validateHardwareProfile(file, PROFILE_NAME);
      expect(result.warnings.join('\n')).toContain("Unknown GPU parameter 'VLLM_FUTURE_KNOB'");
      expect(gpuRangeViolations(parseGpuProfile(file).variables).join('\n')).toContain('VLLM_FUTURE_KNOB');
    });

    test('a non-integer value for an integer knob is rejected', () => {
      const file = mutatedProfile((content) =>
        content.replace(/^VLLM_MAX_MODEL_LEN=.*$/m, 'VLLM_MAX_MODEL_LEN=49152.5')
      );
      expect(gpuRangeViolations(parseGpuProfile(file).variables).join('\n')).toContain('is not an integer');
    });

    test('a utilization fraction that blows the shared budget is rejected', () => {
      // 0.55 sits inside GPU_RANGES' [0.1, 0.95], so every per-pin check
      // passes - and the tier claims 33 GiB of a 45.8 GiB aperture beside
      // its neighbours. Only the sum catches it.
      const file = mutatedProfile((content) =>
        content.replace(/^VLLM_GPU_UTILIZATION=.*$/m, 'VLLM_GPU_UTILIZATION=0.55')
      );
      const mutated = parseGpuProfile(file).variables;
      expect(gpuRangeViolations(mutated)).toEqual([]);
      expect(gpuTierBudget(mutated).withinCeiling).toBe(false);
    });
  });
});
