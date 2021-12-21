const { signAndSendTx } = require('../chain/txHandler');
const fs = require('fs');
const path = require('path');

const generateMetadata = async (pinataClient, name, description, imageFile) => {
  // pin image
  let imagePath = path.resolve(imageFile);
  if (!fs.existsSync(imagePath)) {
    throw new WorkflowError(
      `the configured class image path: ${imagePath} does not exist`
    );
  }
  if (!fs.statSync(imagePath)?.isFile()) {
    throw new WorkflowError(
      `the configured image path: ${imagePath} is not a file`
    );
  }
  let { dir, name: fname } = path.parse(imagePath);
  let metaPath = path.join(dir, `${fname}.meta`);

  let imagePinResult = await pinataClient.pinFile(imagePath, `${fname}.image`);
  let imageCid = imagePinResult?.IpfsHash;
  if (!imageCid) {
    throw new WorkflowError(`failed to pin image.`);
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
  let metaPinResult = await pinataClient.pinFile(metaPath, `${fname}.meta`);
  let metaCid = metaPinResult?.IpfsHash;
  if (!metaCid) {
    throw new WorkflowError(`failed to pin metadata`);
  }
  return { metaCid, imageCid };
};

let setMetadataInBatch = async (connection, classId, instanceMetaCids) => {
  const { api, signingPair, proxiedAddress } = await connection;

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

let setClassMetadata = async (connection, classId, metadataCid) => {
  const { api, signingPair, proxiedAddress } = connection;
  let tx = api.tx.uniques.setClassMetadata(classId, metadataCid, false);

  let txCall = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', tx)
    : tx;
  console.log(`sending tx with hash ${tx.toHex()}`);
  await signAndSendTx(api, txCall, signingPair);
};

const generateAndSetClassMetadata = async (
  connection,
  pinataClient,
  classId,
  metadata
) => {
  let { name, description, imageFile } = metadata;
  let { metaCid } = await generateMetadata(
    pinataClient,
    name,
    description,
    imageFile
  );
  await setClassMetadata(connection, classId, metaCid);
  return metaCid;
};

module.exports = {
  generateAndSetClassMetadata,
  setMetadataInBatch,
  generateMetadata,
};
