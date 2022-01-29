const { fillTemplateFromData } = require('./csv');

describe('csv utility tests', () => {
  it('test template strings', () => {
    let template = '<<test column>> is in test column';
    let filledStr = 'fizzbuzz is in test column';
    let header = ['test column'];
    let data = ['fizzbuzz'];
    let result = fillTemplateFromData(template, header, data);
    expect(result).toBe(filledStr);
  });
});
