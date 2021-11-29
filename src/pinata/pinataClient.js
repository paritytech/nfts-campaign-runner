const pinataSDK = require('@pinata/sdk');

const client = {
  pinata: undefined,
  pinFile: function (sourcePath, name) {
    const options = {
      pinataMetadata: {
        name,
      },
      pinataOptions: {
        cidVersion: 0,
      },
    };
    return this.pinata.pinFromFS(sourcePath, options);
  },
  pinJson: function (json, name) {
    const options = {
      pinataMetadata: {
        name,
      },
      pinataOptions: {
        cidVersion: 0,
      },
    };
    return this.pinata.pinJSONToIPFS(json, options);
  },
};
const createPinataClient = (pinataConfig) => {
  client.pinata = pinataSDK(pinataConfig?.apiKey, pinataConfig?.secretApiKey);
  return client;
};

module.exports = { createPinataClient };
