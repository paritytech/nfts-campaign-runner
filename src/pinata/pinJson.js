const pinata = require('./pinataClient');

const pinJson = (json, name) => {
  const options = {
    pinataMetadata: {
      name,
    },
    pinataOptions: {
      cidVersion: 0,
    },
  };
  return pinata.pinJSONToIPFS(json, options);
};

module.exports = pinJson;
