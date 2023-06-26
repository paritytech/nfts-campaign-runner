const pinataSDK = require('@pinata/sdk');
const { cache } = require('../utils/cache');
const Bottleneck = require('bottleneck/es5');

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 333,
});

const client = {
  pinata: undefined,
  pinFile: async function (sourcePath, name, useCache = false) {
    let cid;
    if (useCache && cache.has(sourcePath)) {
      cid = cache.get(sourcePath);
      console.log(
        `file ${sourcePath} has been already uploaded, returning cid:${cid} from cache.`
      );
      return cid;
    } else {
      const options = {
        pinataMetadata: {
          name,
        },
        pinataOptions: {
          cidVersion: 0,
        },
      };
      const pinResult = await limiter.schedule(() =>
        this.pinata.pinFromFS(sourcePath, options)
      );

      //let pinResult = await this.pinata.pinFromFS(sourcePath, options);
      cid = pinResult?.IpfsHash;
      cache.set(sourcePath, cid);
      console.log(`uploaded file ${sourcePath}, cid:${cid}.`);
    }
    return cid;
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
