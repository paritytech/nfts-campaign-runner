const { connect } = require('./chain/chain');
const { signAndSendTx } = require('../chain/txHandler');
const wfSetting = require('./workflow.json');
const path = require('path');
const pinFile = require('../pinata/pinFile');

let createMataJson = (name, imageCid) => {
  let metadata = {
    name: `${name}, 1 year anniversary at Parity`,
    image: `ipfs://ipfs/${imageCid}`,
    description: `Happy 1 year anniversary ${name}. Thank you for all you have done throughout your journey at Parity.`,
  };
  return JSON.stringify(metadata, null, 2);
};

const generateMetaData = async (name, description, imageFile, ipfsName) => {
  if (!wfSetting?.class?.metadata) {
    // pin image
    let imagePath = path.resolve(imageFile);
    let { dir, name } = path.parse(imagePath);
    let metaPath = path.join(dir, `${name}.meta`);
    let pinResult = pinFile(imagePath, `${ipfsName}.image`);
    let imageCid = pinResult?.IpfsHash;
    if (!cid) {
      throw new Error(`failed to pin image.`);
    }

    // create metatdata
    let metadata = {
      name: name,
      image: `ipfs://ipfs/${imageCid}`,
      description: description,
    };
    let metadat = JSON.stringify(metadata, null, 2);

    // pin metadata
    let pinResult = pinFile(imagePath, `${ipfsName}.meta`);
    let metaCid = pinResult?.IpfsHash;
    if (!cid) {
      throw new Error(`failed to pin metadata`);
    }
    fs.writeFileSync(outputFile, metadata, { encoding: 'utf8' });
  }
};

let setClassMetaData = async (classId, metadataCid) => {
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
    let classMetaCid = generateMetaData(name, description, imageFile, metaName);
    await setClassMetadata(wfSetting?.class?.id, classMetaCid);
  }
};
