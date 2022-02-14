const { randomAsHex } = require('@polkadot/util-crypto');
const { WorkflowError } = require('../Errors');

const generateSecret = async (keyring) => {
  if (!keyring) {
    throw new WorkflowError('keyring is required.');
  }
  const secret = randomAsHex(10);
  const address = keyring.createFromUri(secret).address;
  return { secret, address };
};

module.exports = { generateSecret };
