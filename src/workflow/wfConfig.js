const path = require('path');
const { isEmptyObject } = require('../utils');
const {
  validate,
  validateFileAccess,
  validateFileExists,
  validateElement,
  validateSection,
} = require('../utils/validation');

const parseConfig = (cfile) => {
  // resolve the path a relative path
  let configFile = path.resolve(cfile);
  let configJson;

  try {
    validateFileExists(configFile, 'workflow config');

    configJson = require(configFile);
    validate(
      configJson,
      `No workflow configuration was found in configuration file: ${configFile}`
    );

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
      validateFileExists(
        path.resolve(configJson.class.metadata.imageFile),
        'class.metadata.imageFile'
      );
    }
    if (configJson.class.metadata?.videoFile) {
      validateFileExists(
        path.resolve(configJson.class.metadata.videoFile),
        'class.metadata.videoFile'
      );
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
    let metaFolderName = 'metadata';
    let metaFolderPath = path.join(outDir, metaFolderName);
    configJson.metadataFolder = path.resolve(metaFolderPath);
    configJson.instance.data.outputCsvFile = path.resolve(outFilename);

    validateFileExists(
      configJson.instance.data.csvFile,
      'instance.data.csvFile'
    );
    validateFileAccess(outDir, 'write');

    // instance.metadata
    const instanceMetadata = configJson.instance.metadata;
    if (!isEmptyObject(instanceMetadata)) {
      if (instanceMetadata.imageFile) {
        const parts = instanceMetadata.imageFile.split('/');
        const imageFileNameTemplate = parts.pop();
        const imageFolder = parts.join('/');

        configJson.instance.metadata.imageFolder = path.resolve(imageFolder);
        configJson.instance.metadata.imageFileNameTemplate =
          imageFileNameTemplate;

        validateFileExists(
          configJson.instance.metadata.imageFolder,
          'instance.metadata.imageFile'
        );
      }

      if (instanceMetadata.videoFile) {
        const parts = instanceMetadata.videoFile.split('/');
        const videoFileNameTemplate = parts.pop();
        const videoFolder = parts.join('/');

        configJson.instance.metadata.videoFolder = path.resolve(videoFolder);
        configJson.instance.metadata.videoFileNameTemplate =
          videoFileNameTemplate;

        validateFileExists(
          configJson.instance.metadata.videoFolder,
          'instance.metadata.videoFile'
        );
      }

      validateElement(configJson, 'instance.metadata.name', configFile);
      validateElement(configJson, 'instance.metadata.description', configFile);
    }
  } catch (error) {
    return { error: error.message ?? error.toString() };
  }

  return { config: configJson };
};

module.exports = { parseConfig };
