import test from 'node:test';
import assert from 'node:assert/strict';
import { ageDays, duplicateKey } from '../src/domain.js';
import { requirements } from '../src/models.js';
import { all, run } from '../src/database.js';

test('ageDays returns whole elapsed calendar days and clamps future dates', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  assert.equal(ageDays(new Date('2026-10-01T13:00:00Z'), now), 12);
  assert.equal(ageDays(new Date('2026-10-15T00:00:00Z'), now), 0);
});

test('ageDays returns null when its date is absent', () => {
  assert.equal(ageDays(undefined), null);
  assert.equal(ageDays(null), null);
});

test('duplicate key uses requirement, role, and normalized email', () => {
  const base = { soNumber: 'SO-1', jobRole: 'Engineer', candidateName: 'Alex Doe', candidateEmail: ' ALEX@EXAMPLE.COM ' };
  assert.equal(duplicateKey(base), duplicateKey({ ...base, candidateEmail: 'alex@example.com' }));
  assert.notEqual(duplicateKey(base), duplicateKey({ ...base, jobRole: 'Designer' }));
  assert.notEqual(duplicateKey(base), duplicateKey({ ...base, soNumber: 'SO-2' }));
});

test('duplicate key falls back to normalized candidate name and phone', () => {
  const base = { soNumber: 'SO-1', jobRole: 'Engineer', candidateName: 'Alex Doe', candidatePhone: '+91 123 456' };
  assert.equal(duplicateKey(base), duplicateKey({ ...base, candidateName: 'alex-doe', candidatePhone: '+91 123 456' }));
  assert.notEqual(duplicateKey(base), duplicateKey({ ...base, candidatePhone: '+91 987 654' }));
});

test('duplicate key distinguishes the same RR and candidate across accounts', () => {
  const base = { accountName: 'Account A', soNumber: '10000003259_1', jobRole: 'Engineer', candidateName: 'Alex Doe', candidatePhone: '123' };
  assert.notEqual(duplicateKey(base), duplicateKey({ ...base, accountName: 'Account B' }));
  assert.equal(duplicateKey(base), duplicateKey({ ...base, accountName: ' account a ' }));
});

test('same RR number and role are separate requirements for different accounts', () => {
  const rrNumber = `RR-${Date.now()}`;
  const first = requirements.upsert({ accountName: 'Account A', soNumber: rrNumber, jobRole: 'Engineer' });
  const second = requirements.upsert({ accountName: 'Account B', soNumber: rrNumber, jobRole: 'Engineer' });
  const repeated = requirements.upsert({ accountName: 'Account A', soNumber: rrNumber, jobRole: 'Engineer' });

  assert.notEqual(first?._id, second?._id);
  assert.equal(first?._id, repeated?._id);
  run('DELETE FROM requirements WHERE soNumber = ?', [rrNumber]);
  assert.equal(all('SELECT id FROM requirements WHERE soNumber = ?', [rrNumber]).length, 0);
});
