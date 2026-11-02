/**
 * Property-Based Tests for IngestionProgressIndicator.vue - Stage Icon Assignment
 *
 * Uses fast-check with Vue Test Utils to validate that the stageStates computed
 * property correctly assigns icon states based on stages_completed and status values.
 *
 * Feature: ingestion-progress-feedback, Property 6: Stage icon assignment
 * Validates: Requirements 5.4
 */
const fc = require('fast-check');
const { mount } = require('@vue/test-utils');
const IngestionProgressIndicator = require('../IngestionProgressIndicator.vue').default;

const STAGE_NAMES = ['Extraction', 'Chunking', 'Guardrail', 'Labeling', 'Graph'];

/**
 * Feature: ingestion-progress-feedback, Property 6: Stage icon assignment
 * Validates: Requirements 5.4
 *
 * For any stages_completed value in [0, 5] and status in ["in_progress", "completed", "error"]:
 * - Stages at index < stages_completed show "completed" state
 * - Stage at index === stages_completed (if status is "in_progress") shows "active" state
 * - Stage at index === stages_completed (if status is "error") shows "error" state
 * - Stages at index > stages_completed show "pending" state
 * - If status is "completed", all stages show "completed" state
 */
describe('Feature: ingestion-progress-feedback, Property 6: Stage icon assignment', () => {
  it('stages at index < stages_completed display "completed" state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom('in_progress', 'error'),
        (stagesCompleted, status) => {
          const wrapper = mount(IngestionProgressIndicator, {
            props: {
              progress: {
                stages_completed: stagesCompleted,
                stage_progress_percent: 0,
                total_stages: 5,
                status: status,
                current_stage: STAGE_NAMES[Math.min(stagesCompleted, 4)],
                started_at: '2025-01-01T00:00:00.000Z',
              },
              fileStatus: 'Ingesting',
            },
          });

          const stageStates = wrapper.vm.stageStates;

          // All stages before stages_completed should be 'completed'
          for (let i = 0; i < stagesCompleted; i++) {
            expect(stageStates[i].state).toBe('completed');
            expect(stageStates[i].name).toBe(STAGE_NAMES[i]);
          }

          wrapper.unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stage at index === stages_completed shows "active" when status is "in_progress"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        (stagesCompleted) => {
          const wrapper = mount(IngestionProgressIndicator, {
            props: {
              progress: {
                stages_completed: stagesCompleted,
                stage_progress_percent: 0,
                total_stages: 5,
                status: 'in_progress',
                current_stage: STAGE_NAMES[stagesCompleted],
                started_at: '2025-01-01T00:00:00.000Z',
              },
              fileStatus: 'Ingesting',
            },
          });

          const stageStates = wrapper.vm.stageStates;

          // The active stage should show 'active' state
          expect(stageStates[stagesCompleted].state).toBe('active');
          expect(stageStates[stagesCompleted].name).toBe(STAGE_NAMES[stagesCompleted]);

          wrapper.unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stage at index === stages_completed shows "error" when status is "error"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        (stagesCompleted) => {
          const wrapper = mount(IngestionProgressIndicator, {
            props: {
              progress: {
                stages_completed: stagesCompleted,
                stage_progress_percent: 0,
                total_stages: 5,
                status: 'error',
                current_stage: STAGE_NAMES[stagesCompleted],
                started_at: '2025-01-01T00:00:00.000Z',
                finished_at: '2025-01-01T00:05:00.000Z',
              },
              fileStatus: 'Ingesting',
            },
          });

          const stageStates = wrapper.vm.stageStates;

          // The failed stage should show 'error' state
          expect(stageStates[stagesCompleted].state).toBe('error');
          expect(stageStates[stagesCompleted].name).toBe(STAGE_NAMES[stagesCompleted]);

          wrapper.unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stages at index > stages_completed display "pending" state when not completed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.constantFrom('in_progress', 'error'),
        (stagesCompleted, status) => {
          const wrapper = mount(IngestionProgressIndicator, {
            props: {
              progress: {
                stages_completed: stagesCompleted,
                stage_progress_percent: 0,
                total_stages: 5,
                status: status,
                current_stage: STAGE_NAMES[stagesCompleted],
                started_at: '2025-01-01T00:00:00.000Z',
              },
              fileStatus: 'Ingesting',
            },
          });

          const stageStates = wrapper.vm.stageStates;

          // All stages after the active/error stage should be 'pending'
          for (let i = stagesCompleted + 1; i < 5; i++) {
            expect(stageStates[i].state).toBe('pending');
            expect(stageStates[i].name).toBe(STAGE_NAMES[i]);
          }

          wrapper.unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all stages show "completed" when status is "completed"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        (stagesCompleted) => {
          const wrapper = mount(IngestionProgressIndicator, {
            props: {
              progress: {
                stages_completed: stagesCompleted,
                stage_progress_percent: 100,
                total_stages: 5,
                status: 'completed',
                current_stage: 'Completed',
                started_at: '2025-01-01T00:00:00.000Z',
                finished_at: '2025-01-01T00:10:00.000Z',
              },
              fileStatus: 'Ingesting',
            },
          });

          const stageStates = wrapper.vm.stageStates;

          // All stages should be 'completed' regardless of stages_completed value
          for (let i = 0; i < 5; i++) {
            expect(stageStates[i].state).toBe('completed');
            expect(stageStates[i].name).toBe(STAGE_NAMES[i]);
          }

          wrapper.unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('combined property: full stage state assignment is correct for any valid input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.constantFrom('in_progress', 'completed', 'error'),
        fc.integer({ min: 0, max: 100 }),
        (stagesCompleted, status, stageProgressPercent) => {
          const wrapper = mount(IngestionProgressIndicator, {
            props: {
              progress: {
                stages_completed: stagesCompleted,
                stage_progress_percent: stageProgressPercent,
                total_stages: 5,
                status: status,
                current_stage: status === 'completed' ? 'Completed' : STAGE_NAMES[Math.min(stagesCompleted, 4)],
                started_at: '2025-01-01T00:00:00.000Z',
                finished_at: status === 'completed' || status === 'error' ? '2025-01-01T00:10:00.000Z' : null,
              },
              fileStatus: 'Ingesting',
            },
          });

          const stageStates = wrapper.vm.stageStates;

          // Verify length is always 5
          expect(stageStates).toHaveLength(5);

          for (let i = 0; i < 5; i++) {
            // Verify name matches expected stage name
            expect(stageStates[i].name).toBe(STAGE_NAMES[i]);

            if (status === 'completed') {
              // All stages completed when overall status is completed
              expect(stageStates[i].state).toBe('completed');
            } else if (i < stagesCompleted) {
              // Stages before current are completed
              expect(stageStates[i].state).toBe('completed');
            } else if (i === stagesCompleted && status === 'in_progress') {
              // Current stage is active when in progress
              expect(stageStates[i].state).toBe('active');
            } else if (i === stagesCompleted && status === 'error') {
              // Current stage shows error when status is error
              expect(stageStates[i].state).toBe('error');
            } else {
              // Later stages are pending
              expect(stageStates[i].state).toBe('pending');
            }
          }

          wrapper.unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});
