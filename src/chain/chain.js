const { Keyring } = require('@polkadot/keyring');
const { ApiPromise, WsProvider } = require('@polkadot/api');

// ToDO: verify seed is a valid mnemonic
let signingPair;
let api;
let keyring;

module.exports = {
  connect: async function (network) {
    const wsURI = network?.provider;
    const seed = network?.accountSeed;
    const proxiedAddress = network?.proxiedAddress;
    if (!api) {
      if (!wsURI) {
        throw new Error('No RPC endpoint is configured for the network');
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
        throw new Error(
          'No account seed phrase is configured to be used with the network'
        );
      }
      signingPair = keyring.createFromUri(seed);
    }
    return { api, keyring, signingPair, proxiedAddress };
  },
};
