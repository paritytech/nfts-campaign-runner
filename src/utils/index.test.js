const { isNumber, isEmptyObject } = require('./index');

describe('general utility tests', () => {
  it('test isNumber', () => {
    expect(isNumber(1)).toBe(true);
    expect(isNumber('1')).toBe(true);
    expect(isNumber(0)).toBe(true);
    expect(isNumber('0')).toBe(true);
    expect(isNumber(1.2)).toBe(true);
    expect(isNumber('1.2')).toBe(true);

    expect(isNumber('')).toBe(false);
    expect(isNumber('1.234edgg')).toBe(false);
    expect(isNumber({})).toBe(false);
    expect(isNumber(null)).toBe(false);
    expect(isNumber(undefined)).toBe(false);
    expect(isNumber(false)).toBe(false);
  });

  it('test isEmptyObject', () => {
    expect(isEmptyObject(null)).toBe(true);
    expect(isEmptyObject({})).toBe(true);
    expect(isEmptyObject([])).toBe(true);
    expect(isEmptyObject(() => {})).toBe(true);
    expect(isEmptyObject(0)).toBe(true);
    expect(isEmptyObject(undefined)).toBe(true);
    expect(isEmptyObject(false)).toBe(true);
    expect(isEmptyObject('1')).toBe(true);

    expect(isNumber({ a: 1})).toBe(false);
  });
});
