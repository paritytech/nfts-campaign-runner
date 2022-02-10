const { isNumber } = require('./index');
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
});
