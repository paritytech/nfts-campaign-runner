const pinata = require('./pinataClient');

const pinFile = (sourcePath, name) => {
  const options = {
    pinataMetadata: {
      name,
    },
    pinataOptions: {
      cidVersion: 0,
    },
  };
  return pinata.pinFromFS(sourcePath, options);
};

module.exports = pinFile;
