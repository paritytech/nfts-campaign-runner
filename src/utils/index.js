const isNumber = (val) => !isNaN(val) && !isNaN(parseInt(val));

const isEmptyObject = (obj) => {
  return !obj || typeof obj !== 'object' || !Object.keys(obj).length;
}

module.exports = {
  isNumber,
  isEmptyObject,
};
