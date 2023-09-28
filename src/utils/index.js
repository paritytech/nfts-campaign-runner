const { formatBalance } = require('@polkadot/util');

const isNumber = (val) => !isNaN(val) && !isNaN(parseInt(val));

const isEmptyObject = (obj) => {
  return !obj || typeof obj !== 'object' || !Object.keys(obj).length;
};

const formatBalanceWithUnit = (balance, chainInfo) => {
  let { decimals, token: unit } = chainInfo;
  return formatBalance(balance, { decimals, withSiFull: true, withUnit: unit });
};

module.exports = {
  isNumber,
  isEmptyObject,
  formatBalanceWithUnit,
};
