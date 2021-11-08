const { Keyring } = require('@polkadot/keyring');
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { network } = require('../../workflow.json');
const wsURI = network.provider;
const seed = network.accountSeed;
const proxiedAddress = network.proxiedAddress;

const wsProvider = new WsProvider(wsURI);
const keyring = new Keyring({ type: 'sr25519' });

// ToDO: verify seed is a valid mnemonic
const signingPair = keyring.createFromUri(seed);
const api;

module.exports = {
  connect: async function () {
    if (!api) {
        api = await ApiPromise.create({ provider: wsProvider });
        await api.isReady;
    }
    return { api, keyring, signingPair, proxiedAddress };
  },
};
