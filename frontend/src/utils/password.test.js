import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem } from './password.js';

test('passwordProblem matches the server rule: 8 characters to 72 bytes', () => {
  assert.match(passwordProblem('short'), /at least 8/);
  assert.equal(passwordProblem('long-enough'), '');
  assert.equal(passwordProblem('a'.repeat(72)), '');
  assert.match(passwordProblem('a'.repeat(73)), /too long/);
  // 37 characters, but 74 bytes in UTF-8.
  assert.match(passwordProblem('é'.repeat(37)), /too long/);
});
