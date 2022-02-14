const get = require('lodash.get');
const fs = require('fs');
const { WorkflowError } = require('../Errors');

const errors = {
  section: (section, configFile) => {
    return `No ${section} configuration was found for the workflow in configuration file: ${configFile}.`;
  },
  element: (element, configFile) => {
    return `${element} is not configured in configuration file: ${configFile}.`;
  },
  pathNotExists: (name, path) => {
    return `${name} does not exist at the configured path: ${path}.`;
  },
  pathHasWrongAccess: (path, accessLevel) => {
    return `${path} does not have the right access: ${accessLevel}.`;
  },
};

const throwError = (errorText) => { throw new WorkflowError(errorText); };

const validate = (object, keyPath, errorText) => {
  if (!errorText) {
    errorText = keyPath;
    keyPath = '';
  }

  if (!keyPath && !object) {
    throwError(errorText);
  }

  if (keyPath && !get(object, keyPath)) throwError(errorText);
}

const validateSection = (configJson, section, configFile) => {
  validate(configJson, section, errors.section(section, configFile));
};

const validateElement = (configJson, element, configFile) => {
  validate(configJson, element, errors.element(element, configFile));
};

const validateFileExists = (filePath, errorText) => {
  if (!fs.existsSync(filePath)) {
    throwError(errors.pathNotExists(errorText, filePath));
  }
};

const validateFileAccess = (filePath, accessLevel = 'default') => {
  const ACCESS_LEVELS = {
    read: fs.constants.R_OK,
    write: fs.constants.W_OK,
    execute: fs.constants.X_OK,
    default: fs.constants.F_OK,
  };

  try {
    fs.accessSync(filePath, ACCESS_LEVELS[accessLevel]);
  } catch {
    throwError(errors.pathHasWrongAccess(filePath, accessLevel));
  }
};

module.exports = {
  throwError,
  validate,
  validateFileAccess,
  validateFileExists,
  validateElement,
  validateSection,
};
