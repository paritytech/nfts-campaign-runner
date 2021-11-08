const pinataSDK = require('@pinata/sdk');
const pinata = require('');
const wfSetting = require('..workflow.json');
const pinata = pinataSDK(
  wfSetting?.pinata?.apiKey,
  wfSetting?.pinata?.secretApiKey
);

module.exports = pinata;
