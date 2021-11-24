const path = require('path');

const checkpointPath = './';

const headerTitles = {
  classId: 'classId',
  instanceId: 'instanceId',
  classMetadata: 'classMetadata',
  instanceMetadata: 'instanceMetadat',
  secret: 'gift account secret',
  address: 'gift account address',
  imageCid: 'image cid',
  metaCid: 'metadata cid',
  lastMintBatch: 'last minted batch',
  lastMetadataBatch: 'last metadata batch',
};

const checkpointFiles = {
  class: path.join(__dirname, `${checkpointPath}/.class.cp`),
  data: path.join(__dirname, `${checkpointPath}/.data.cp`),
  batch: path.join(__dirname, `${checkpointPath}/.batch.cp`),
};

module.exports = { checkpointFiles, headerTitles };
