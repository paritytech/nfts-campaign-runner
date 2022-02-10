const { Keyring } = require('@polkadot/keyring');
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { WorkflowError } = require('../Errors');

// TODO: verify seed is a valid mnemonic
let signingPair;
let api;
let keyring;

const connect = async function (network) {
  const wsURI = network?.provider;
  const seed = network?.accountSeed;
  const proxiedAddress = network?.proxiedAddress;
  if (!api) {
    if (!wsURI) {
      throw new WorkflowError('No RPC endpoint is configured for the network');
    }
    const wsProvider = new WsProvider(wsURI);
    api = await ApiPromise.create({ provider: wsProvider });
    await api.isReady;
  }

  if (!keyring) {
    keyring = new Keyring({ type: 'sr25519' });
  }

  if (!signingPair) {
    if (!seed) {
      throw new WorkflowError(
        'No account seed phrase is configured to be used with the network'
      );
    }
    signingPair = keyring.createFromUri(seed);
  }
  return { api, keyring, signingPair, proxiedAddress };
};

module.exports = { connect };
