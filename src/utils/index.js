const isNumber = (val) => !isNaN(val) && !isNaN(parseInt(val));

module.exports = {
  isNumber,
};
