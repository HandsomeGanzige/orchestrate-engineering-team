import assert from 'node:assert/strict';
import test from 'node:test';

import {
  newWorkDocument,
  validateDocument,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-document.mjs';
import {
  applyAssignment,
  applyDecision,
  applyMaterial,
  applyResult,
  applyTodo,
  applyVote,
  applyWork,
  scopesConflict,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/work-model.mjs';

function document() {
  return newWorkDocument({
    id: 'model-work',
    name: 'Model work',
    summary: 'Exercises the pure work model.',
    keywords: ['model', 'workflow', 'state'],
    type: 'delivery',
    goal: 'Exercise state transitions.',
    successCriteria: ['Transitions remain valid.'],
  }, '../../../index.md', new Date('2026-07-28T01:00:00.000Z'));
}

test('work-model interface owns todo transitions without persistence', () => {
  const work = document();
  assert.deepEqual(
    applyTodo(work, 'add', { id: 'implement-model', text: 'Implement model.' }),
    { todo: 'implement-model', action: 'add' },
  );
  applyTodo(work, 'complete', { id: 'align-goal', next: 'implement-model' });
  assert.equal(work.blocks.todo.find((todo) => todo.id === 'align-goal').status, 'completed');
  assert.equal(work.blocks.todo.find((todo) => todo.id === 'implement-model').status, 'in_progress');
});

test('work-model interface rejects overlapping Development write domains', () => {
  assert.equal(scopesConflict('src/runtime', 'src/runtime/lease.mjs'), true);
  const work = document();
  const base = {
    role: 'development',
    objective: 'Implement a bounded module.',
    dependsOn: [],
    sharedInterfaceStable: true,
    touchesGlobal: false,
    integrator: 'runtime-integration',
  };
  applyAssignment(work, 'add', { ...base, id: 'dev-core', write: ['src/runtime'] });
  applyAssignment(work, 'add', { ...base, id: 'dev-lease', write: ['src/runtime/lease.mjs'] });
  applyAssignment(work, 'start', { id: 'dev-core' });
  assert.throws(
    () => applyAssignment(work, 'start', { id: 'dev-lease' }),
    (error) => error.code === 'PARALLEL_CONFLICT'
      && error.message === 'overlapping write scopes: src/runtime/lease.mjs and src/runtime',
  );
});

test('work-model assignment dependencies must be unique, valid, non-self, and already declared', () => {
  const missing = document();
  assert.throws(
    () => applyAssignment(missing, 'add', {
      id: 'dev-dependent',
      role: 'development',
      objective: 'Start only after a declared prerequisite.',
      write: ['src/dependent.mjs'],
      dependsOn: ['dev-missing'],
    }),
    (error) => error.code === 'NOT_FOUND'
      && error.message === 'assignment prerequisite not found: dev-missing',
  );

  const prerequisite = {
    id: 'dev-prerequisite',
    role: 'development',
    objective: 'Provide a declared prerequisite.',
    write: ['src/prerequisite.mjs'],
  };
  const malformed = document();
  applyAssignment(malformed, 'add', prerequisite);
  for (const fixture of [
    {
      name: 'duplicate',
      dependsOn: ['dev-prerequisite', 'dev-prerequisite'],
      code: 'INVALID_INPUT',
      message: 'dependsOn must contain unique assignment IDs',
    },
    {
      name: 'self reference',
      dependsOn: ['dev-dependent'],
      code: 'INVALID_INPUT',
      message: 'assignment cannot depend on itself',
    },
    {
      name: 'invalid ID',
      dependsOn: ['Not Valid'],
      code: 'INVALID_INPUT',
      message: 'invalid assignment dependency: Not Valid',
    },
  ]) {
    assert.throws(
      () => applyAssignment(malformed, 'add', {
        id: 'dev-dependent',
        role: 'development',
        objective: 'Reject malformed dependencies.',
        write: ['src/dependent.mjs'],
        dependsOn: fixture.dependsOn,
      }),
      (error) => error.code === fixture.code && error.message === fixture.message,
      fixture.name,
    );
  }
});

test('work-model assignment start requires every declared prerequisite to be complete', () => {
  const unfinished = document();
  applyAssignment(unfinished, 'add', {
    id: 'dev-prerequisite',
    role: 'development',
    objective: 'Complete the prerequisite.',
    write: ['src/prerequisite.mjs'],
  });
  applyAssignment(unfinished, 'add', {
    id: 'dev-dependent',
    role: 'development',
    objective: 'Start after the prerequisite completes.',
    write: ['src/dependent.mjs'],
    dependsOn: ['dev-prerequisite'],
  });
  assert.throws(
    () => applyAssignment(unfinished, 'start', { id: 'dev-dependent' }),
    (error) => error.code === 'INVALID_TRANSITION'
      && error.message === 'assignment prerequisite is not completed: dev-prerequisite',
  );
});

test('persisted Assignment dependencies reject cycles and accept a valid DAG', () => {
  const selfCycle = document();
  applyAssignment(selfCycle, 'add', {
    id: 'dev-self',
    role: 'development',
    objective: 'Exercise self-cycle recovery.',
    write: ['src/self.mjs'],
  });
  selfCycle.blocks.assignments[0].dependsOn = ['dev-self'];
  assert.throws(
    () => validateDocument(selfCycle, { file: 'self-cycle.md' }),
    (error) => error.code === 'INVALID_ASSIGNMENT'
      && error.message === 'self-cycle.md: assignment dev-self cannot depend on itself',
  );

  const multiCycle = document();
  applyAssignment(multiCycle, 'add', {
    id: 'dev-base',
    role: 'development',
    objective: 'Provide the base dependency.',
    write: ['src/base.mjs'],
  });
  applyAssignment(multiCycle, 'add', {
    id: 'dev-dependent',
    role: 'development',
    objective: 'Depend on the base.',
    write: ['src/dependent.mjs'],
    dependsOn: ['dev-base'],
  });
  multiCycle.blocks.assignments[0].dependsOn = ['dev-dependent'];
  assert.throws(
    () => validateDocument(multiCycle, { file: 'multi-cycle.md' }),
    (error) => error.code === 'INVALID_ASSIGNMENT'
      && error.message === 'multi-cycle.md: assignment dependency cycle: dev-base -> dev-dependent -> dev-base',
  );

  const dag = document();
  applyAssignment(dag, 'add', {
    id: 'dev-base',
    role: 'development',
    objective: 'Provide the DAG root.',
    write: ['src/base.mjs'],
  });
  applyAssignment(dag, 'add', {
    id: 'dev-middle',
    role: 'development',
    objective: 'Provide the DAG middle.',
    write: ['src/middle.mjs'],
    dependsOn: ['dev-base'],
  });
  applyAssignment(dag, 'add', {
    id: 'dev-leaf',
    role: 'development',
    objective: 'Provide the DAG leaf.',
    write: ['src/leaf.mjs'],
    dependsOn: ['dev-base', 'dev-middle'],
  });
  assert.doesNotThrow(() => validateDocument(dag, { file: 'valid-dag.md' }));
});

test('persisted identity collections require valid unambiguous IDs', () => {
  const cases = [
    {
      name: 'duplicate todo',
      code: 'INVALID_TODO',
      message: 'todo must contain unique IDs: align-goal',
      mutate(work) {
        work.blocks.todo.push({ ...work.blocks.todo[0], status: 'pending' });
      },
    },
    {
      name: 'duplicate child',
      code: 'INVALID_CHILD',
      message: 'children must contain unique IDs: child-work',
      mutate(work) {
        work.blocks.children.push({ id: 'child-work' }, { id: 'child-work' });
      },
    },
    {
      name: 'duplicate material',
      code: 'INVALID_MATERIAL',
      message: 'materials must contain unique IDs: materials/review/report.md',
      mutate(work) {
        work.blocks.materials.push(
          { id: 'materials/review/report.md' },
          { id: 'materials/review/report.md' },
        );
      },
    },
    {
      name: 'duplicate decision',
      code: 'INVALID_DECISION',
      message: 'confirmed_decisions must contain unique IDs: stable-contract',
      mutate(work) {
        work.blocks.confirmed_decisions.push(
          { id: 'stable-contract' },
          { id: 'stable-contract' },
        );
      },
    },
    {
      name: 'invalid assignment ID',
      code: 'INVALID_ASSIGNMENT',
      message: 'assignments[0].id is invalid',
      mutate(work) {
        applyAssignment(work, 'add', {
          id: 'dev-valid',
          role: 'development',
          objective: 'Create a structurally valid Assignment.',
          write: ['src/valid.mjs'],
        });
        work.blocks.assignments[0].id = 'Not Valid';
      },
    },
    {
      name: 'duplicate assignment',
      code: 'INVALID_ASSIGNMENT',
      message: 'assignments must contain unique IDs: dev-duplicate',
      mutate(work) {
        applyAssignment(work, 'add', {
          id: 'dev-duplicate',
          role: 'development',
          objective: 'Create a structurally valid Assignment.',
          write: ['src/duplicate.mjs'],
        });
        work.blocks.assignments.push(structuredClone(work.blocks.assignments[0]));
      },
    },
  ];

  for (const fixture of cases) {
    const work = document();
    fixture.mutate(work);
    assert.throws(
      () => validateDocument(work, { file: 'identity.md' }),
      (error) => error.code === fixture.code
        && error.message === `identity.md: ${fixture.message}`,
      fixture.name,
    );
  }
});

test('persisted Material identity equals its normalized canonical path', () => {
  const work = document();
  applyMaterial(work, 'add', {
    role: 'review',
    path: 'materials/review/../review/report.md',
    summary: 'Canonical review report',
    purpose: 'Exercise persisted Material identity.',
  });
  assert.deepEqual(work.blocks.materials[0], {
    id: 'materials/review/report.md',
    role: 'review',
    path: 'materials/review/report.md',
    summary: 'Canonical review report',
    purpose: 'Exercise persisted Material identity.',
  });
  assert.doesNotThrow(() => validateDocument(work, { file: 'valid-material.md' }));

  work.blocks.materials[0].id = 'arbitrary-material-id';
  assert.throws(
    () => validateDocument(work, { file: 'invalid-material.md' }),
    (error) => error.code === 'INVALID_MATERIAL'
      && error.message === 'invalid-material.md: material id must equal normalized path: materials/review/report.md',
  );
});

test('work-model apply interfaces compose decisions, materials, results, votes, and evidence', () => {
  const work = document();
  assert.deepEqual(
    applyDecision(work, 'add', { id: 'stable-seam', summary: 'Keep the model seam pure.' }),
    { decision: 'stable-seam' },
  );
  assert.deepEqual(applyMaterial(work, 'add', {
    role: 'architecture',
    path: 'materials/architecture/model-seam.md',
    summary: 'Model seam',
    purpose: 'Guide implementation.',
  }), { material: 'materials/architecture/model-seam.md' });
  applyAssignment(work, 'add', {
    id: 'dev-model',
    role: 'development',
    objective: 'Implement the model seam.',
    write: ['src/model.mjs'],
  });
  applyAssignment(work, 'start', { id: 'dev-model' });
  assert.deepEqual(
    applyResult(work, { assignment: 'dev-model', result: {
      status: 'completed',
      summary: ['Implemented the model seam.'],
      artifacts: [],
      files: ['src/model.mjs'],
      checks: [{ command: 'node --test', result: 'passed' }],
      requires_test: true,
      test_reason: 'Executable behavior changed.',
      requires_review: true,
      review_reason: 'The model contract changed.',
      blockers: [],
    } }),
    { assignment: 'dev-model', result_status: 'completed' },
  );
  applyAssignment(work, 'complete', { id: 'dev-model' });
  applyVote(work, 'record', {
    role: 'main',
    requiresTest: true,
    testReason: 'Run independent tests.',
    requiresReview: true,
    reviewReason: 'Run independent review.',
  });
  assert.deepEqual(applyVote(work, 'compute', {}).decisions.test.execute, true);
  assert.deepEqual(
    applyWork(work, 'evidence', {
      criterion: 'Transitions remain valid.',
      evidence: 'Direct model interface assertions passed.',
      pointers: ['scripts/workflow/work-model.test.mjs'],
    }),
    { criterion: 'Transitions remain valid.', recorded: true },
  );
});

test('work-model material interface applies the shared role-folder policy', () => {
  const work = document();
  for (const [role, folder] of [
    ['test', 'test'],
    ['retest', 'test'],
    ['review', 'review'],
    ['rereview', 'review'],
  ]) {
    assert.equal(
      applyMaterial(work, 'add', {
        role,
        path: `materials/${folder}/${role}.md`,
        summary: `${role} material`,
        purpose: 'Exercise role-folder mapping.',
      }).material,
      `materials/${folder}/${role}.md`,
    );
  }
  assert.throws(
    () => applyMaterial(work, 'add', {
      role: 'test',
      path: 'materials/review/wrong.md',
      summary: 'Wrong folder',
      purpose: 'Must be rejected.',
    }),
    (error) => error.code === 'MATERIAL_SCOPE'
      && error.message === 'material path must be below materials/test/',
  );
  assert.throws(
    () => applyMaterial(work, 'add', {
      role: 'toString',
      path: 'materials/review/prototype.md',
      summary: 'Prototype key',
      purpose: 'Must be rejected.',
    }),
    (error) => error.code === 'MATERIAL_SCOPE'
      && error.message === 'role may not register materials',
  );
});
