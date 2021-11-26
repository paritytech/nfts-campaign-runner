const { connect } = require('./chain/chain');
const { signAndSendTx } = require('./chain/txHandler');
const wfSetting = require('./workflow.json');
const fs = require('fs');
const path = require('path');

const pinFile = require('./pinata/pinFile');

let createMataJson = (name, imageCid) => {
  let metadata = {
    name: `${name}, 1 year anniversary at Parity`,
    image: `ipfs://ipfs/${imageCid}`,
    description: `Happy 1 year anniversary ${name}. Thank you for all you have done throughout your journey at Parity.`,
  };
  return JSON.stringify(metadata, null, 2);
};

const generateMetadata = async (name, description, imageFile) => {
  // pin image
  let imagePath = path.resolve(imageFile);
  if (!fs.existsSync(imagePath)) {
    throw new Error(
      `the configured class image path: ${imagePath} does not exist`
    );
  }
  if (!fs.statSync(imagePath)?.isFile()) {
    throw new Error(`the configured image path: ${imagePath} is not a file`);
  }
  let { dir, name: fname } = path.parse(imagePath);
  let metaPath = path.join(dir, `${fname}.meta`);

  let imagePinResult = await pinFile(imagePath, `${fname}.image`);
  let imageCid = imagePinResult?.IpfsHash;
  if (!imageCid) {
    throw new Error(`failed to pin image.`);
  }

  // create metatdata
  let metadata = {
    name: name,
    image: `ipfs://ipfs/${imageCid}`,
    description: description,
  };

  let metadataStr = JSON.stringify(metadata, null, 2);

  // save matadat in the file
  fs.writeFileSync(metaPath, metadataStr, { encoding: 'utf8' });

  // pin metadata
  let metaPinResult = await pinFile(metaPath, `${fname}.meta`);
  let metaCid = metaPinResult?.IpfsHash;
  if (!metaCid) {
    throw new Error(`failed to pin metadata`);
  }
  return { metaCid, imageCid };
};

let setMetadataInBatch = async (classId, instanceMetaCids) => {
  const { api, signingPair, proxiedAddress } = await connect();

  let txs = [];
  for (let i = 0; i < instanceMetaCids.length; i++) {
    let { instanceId, metaCid } = instanceMetaCids[i];
    txs.push(api.tx.uniques.setMetadata(classId, instanceId, metaCid, false));
  }

  let txBatch = api.tx.utility.batchAll(txs);
  let call = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
    : txBatch;
  await signAndSendTx(api, call, signingPair);
  console.log(call.toHuman());
};

let setClassMetadata = async (classId, metadataCid) => {
  const { api, signingPair, proxiedAddress } = await connect();
  let tx = api.tx.uniques.setClassMetadata(classId, metadataCid, false);

  let txCall = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', tx)
    : tx;
  console.log(`sending tx with hash ${tx.toHex()}`);
  await signAndSendTx(api, txCall, signingPair);
};

const generateAndSetClassMetadata = async (classId, metadata) => {
  let { name, description, imageFile } = metadata;
  let { metaCid } = await generateMetadata(name, description, imageFile);
  await setClassMetadata(classId, metaCid);
  return metaCid;
};

module.exports = {
  generateAndSetClassMetadata,
  setMetadataInBatch,
  generateMetadata,
};
