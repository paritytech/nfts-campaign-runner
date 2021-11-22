const fs = require('fs');
const { randomAsHex } = require('@polkadot/util-crypto');
const { connect } = require('./chain/chain');

const generateSecret = async () => {
  const { keyring } = await connect();
  const secret = randomAsHex(10);
  const address = keyring.createFromUri(secret).address;
  return { secret, address };
};

module.exports = { generateSecret };
