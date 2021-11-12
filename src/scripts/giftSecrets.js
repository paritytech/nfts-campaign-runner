const fs = require('fs');
const { Keyring } = require('@polkadot/keyring');
const { randomAsHex, cryptoWaitReady } = require('@polkadot/util-crypto');
const path = require('path');

const createSecret = async () => {
  let output = path.join(
    __dirname,
    '../data/Parity-Anniversary/secrets-with-address12.csv'
  );
  const count = 8;

  // initialize keyring
  const keyring = new Keyring({ type: 'sr25519' });
  await cryptoWaitReady();
  keyring.setSS58Format(2); //set format to Kusama

  let writeStream = fs.createWriteStream(output);

  for (let i = 0; i < count; i++) {
    const secret = randomAsHex(10);
    const address = keyring.createFromUri(secret).address;
    writeStream.write(`${secret},${address}\n`);
  }

  // the finish event is emitted when all data has been flushed from the stream
  writeStream.on('finish', () => {
    console.log('wrote all data to file');
  });

  // close the stream
  writeStream.end();
};

createSecret().catch((err) => console.log(`error happend \n ${err}`));
