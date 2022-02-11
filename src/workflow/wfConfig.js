const path = require('path');
const { validate, validateFileAccess, validateFileExists, validateElement, validateSection } = require('../utils/validation');

const parseConfig = (cfile) => {
  // resolve the path a relative path
  let configFile = path.resolve(cfile);
  let configJson;

  try {
    validateFileExists(configFile, 'workflow config');

    configJson = require(configFile);
    validate(configJson, `No workflow configuration was found in configuration file: ${configFile}`);

    // network
    validateSection(configJson, 'network', configFile);
    validateElement(configJson, 'network.provider', configFile);
    validateElement(configJson, 'network.accountSeed', configFile);

    // pinata
    validateSection(configJson, 'pinata', configFile);
    validateElement(configJson, 'pinata.apiKey', configFile);
    validateElement(configJson, 'pinata.secretApiKey', configFile);

    // class
    validateSection(configJson, 'class', configFile);
    validateElement(configJson, 'class.id', configFile);
    if (configJson.class.metadata?.imageFile) {
      validateFileExists(path.resolve(configJson.class.metadata.imageFile), 'class.metadata.imageFile');
    }

    // instance
    validateSection(configJson, 'instance', configFile);

    // instance.data
    validateSection(configJson, 'instance.data', configFile);
    validateElement(configJson, 'instance.data.csvFile', configFile);

    configJson.instance.data.csvFile = path.resolve(
      configJson.instance.data.csvFile
    );

    // set output path
    let outDir = path.dirname(configJson.instance.data.csvFile);
    let ext = path.extname(configJson.instance.data.csvFile);
    let filename = path.basename(configJson.instance.data.csvFile, ext);
    filename += ext ? `.final${ext}` : `.final`;
    let outFilename = path.join(outDir, filename);
    configJson.instance.data.outputCsvFile = path.resolve(outFilename);

    validateFileExists(configJson.instance.data.csvFile, 'instance.data.csvFile');
    validateFileAccess(outDir, 'write');

    // instance.metadata
    const instanceMetadata = configJson.instance.metadata;
    if (instanceMetadata && typeof instanceMetadata === 'object' && Object.keys(instanceMetadata).length) {
      validateSection(configJson, 'instance.metadata', configFile);
      validateElement(configJson, 'instance.metadata.imageFile', configFile);

      const parts = instanceMetadata.imageFile.split('/');
      const fileNameTemplate = parts.pop();
      const imageFolder = parts.join('/');

      configJson.instance.metadata.imageFolder = path.resolve(imageFolder);
      configJson.instance.metadata.fileNameTemplate = fileNameTemplate;

      validateFileExists(configJson.instance.metadata.imageFolder, 'instance.metadata.imageFile');

      validateElement(configJson, 'instance.metadata.name', configFile);
      validateElement(configJson, 'instance.metadata.description', configFile);
    }
  } catch (error) {
    return { error: error.message ?? error.toString() };
  }

  return { config: configJson };
};

module.exports = { parseConfig };
