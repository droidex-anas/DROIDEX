import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitUnit, withUnit } from './tokenUnit';

test('a number with a unit splits into the number and the unit', () => {
  assert.deepEqual(splitUnit('12px'), { number: '12', unit: 'px' });
  assert.deepEqual(splitUnit('-0.5rem'), { number: '-0.5', unit: 'rem' });
  assert.deepEqual(splitUnit('.25s'), { number: '.25', unit: 's' });
  assert.deepEqual(splitUnit('50%'), { number: '50', unit: '%' });
});

test('unitless numbers and other values stay whole', () => {
  for (const value of ['0', '1.5', '600', '12 px', '0 1px 2px #0003', 'calc(1px + 2px)', 'auto'])
    assert.equal(splitUnit(value), null, value);
});

test('an edited number keeps its unit, and a value typed with a unit stands as typed', () => {
  assert.equal(withUnit('16', 'px'), '16px');
  assert.equal(withUnit('1.5rem', 'px'), '1.5rem');
  assert.equal(withUnit('auto', 'px'), 'auto');
  assert.equal(withUnit('', 'px'), '');
});
