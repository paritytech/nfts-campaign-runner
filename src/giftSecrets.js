const fs = require('fs');
const { randomAsHex } = require('@polkadot/util-crypto');

const generateSecret = async (keyring) => {
  if (!keyring) {
    throw new Error('keyring is required.');
  }
  const secret = randomAsHex(10);
  const address = keyring.createFromUri(secret).address;
  return { secret, address };
};

module.exports = { generateSecret };
