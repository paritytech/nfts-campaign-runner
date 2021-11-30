#!/usr/bin/env node

const { Command } = require('commander');
const { runWorkflow } = require('./workflow');
const program = new Command();

program.version('0.0.1');

program
  .argument(`<workflow-config>`, 'the workflow configuration file')
  .action(async (workflowConfig) => {
    runWorkflow(workflowConfig);
    console.log('done!');
  });

program
  .parseAsync(process.argv)
  .then(() => process.exit(0))
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
