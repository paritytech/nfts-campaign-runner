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
    throw new Error(
      `the configured class image path: ${imagePath} is not a file`
    );
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
  return metaCid;
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

const generateAndSetClassMetadata = async () => {
  if (!wfSetting?.class?.metadata) {
    // no class metdata is configured. ask user if they want to configure a class metadata
    let { withoutMetadata } = (await inqAsk([
      {
        type: 'confirm',
        name: 'withoutMetadata',
        message: `No class metadata is configured in workflow.json, do you want to continue without setting class metadata`,
        default: false,
      },
    ])) || { withoutMetadata: false };
    if (!withoutMetadata) {
      throw new Error('Please configure a class metadata in workflow.json.');
    }
  } else {
    let { name, description, imageFile } = wfSetting?.class?.metadata;
    let classMetaCid = await generateMetadata(name, description, imageFile);
    await setClassMetadata(wfSetting?.class?.id, classMetaCid);
    return classMetaCid;
  }
};

module.exports = { generateAndSetClassMetadata };
