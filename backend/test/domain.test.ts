import test from 'node:test';
import assert from 'node:assert/strict';
import { ageDays, duplicateKey } from '../src/domain.js';

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
