#!/usr/bin/env node

const { Command } = require('commander');
const { WorkflowError } = require('./Errors');
const { runWorkflow } = require('./workflow/workflow');
const program = new Command();

program.version('0.0.1');

program
  .argument(`<workflow-config>`, 'the workflow configuration file')
  .action(async (workflowConfig) => {
    await runWorkflow(workflowConfig);
    console.log('done!');
  });

program
  .parseAsync(process.argv)
  .then(() => process.exit(0))
  .catch((err) => {
    if (err instanceof WorkflowError) {
      console.log(err?.message);
    } else {
      console.log(err);
    }

    process.exit(1);
  });
