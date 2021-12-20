# uniques-campaign-runner

A cli tool to automate running NFT campaign workflows on substrate-uniques-pallet in bulk.  
The tools works in combination with [nft gift app](https://github.com/hamidra/dotdrop/tree/polkadot-nft) to mint NFT's in bulk and create nft gift codes which can be claimed using the [nft claim apps](https://claimnft.kusama.network).

## Install

To install the tool, clone this repo:

```bash
# Clone the repository
git clone https://github.com/hamidra/uniques-campaign-runner.git
cd uniques-campaign-runner
```

and install the npm package from the project directory.

```bash
npm install -g .
```

## Define a workflow

To define your workflow you need to provide the cli with a workflow.json using the following template:

```bash
{
  "network": {
    "provider": "<provider e.g. wss://statemine-rpc.polkadot.io>",
    "accountSeed": "<account seed>",
    "proxiedAddress": "<in case the account is a proxy the address of proxied/primary account>"
  },
  "pinata": {
    "apiKey": "<PinataApiKey>",
    "secretApiKey": "<PinataSecretApiKey>"
  },
  "class": {
    "id": "<classId that the NFT instances are being minted in>",
    "metadata": {
      "imageFile": "<Path to the image file that is used for class metadata>",
      "name": "<the value for the name field in class metadata>",
      "description": "the value for the description field class metadata"
    }
  },
  "instance": {
    "data": {
      "csvFile": "<a csv file that contains the instances data>",
      "offset": "<the row offset, if not specified it starts from row 0>",
      "count": "<the number of rows to be used after offset, if not specified it will count up to last row.>"
    },
    "initialFund": "<initial starting balance for the created gift accounts to be used to fund the tx fees when the NFTs are claimed.>",
    "batchSize": "<the number of transactions that are send in a batch. default to 100 if not specified>",
    "metadata": {
      "imageFolder": "<the path to the media folder that will be minted>",
      "extension": "<the extension of the media files that will be minted>",
      "name": "the value for the name field in the instance metadata",
      "description": "the value for the description field in the instance metadata"
    }
  }
}
```

Note:

- the _proxiedAddress_ is optional, and if provided the account that is drived from the _accountSeed_ will be considered as a proxy and all the extrinsic calls will be send as a proxy call on behalf of the proxiedAddress.
- The data file is a csv file and the number of rows specifies the maximum number of instances that can be minted. The combination of offset and count specifies the actual number of instances.
- The offset specifies the first row number in the csv datafile that the instances will be minted from that number up to the specified count.
- if the calculated row numbers fall outside of the number of rows in the csv file (e.x. offset+count-1 > last_row_number_in_the_file) the minting will stop after the last row number.
- the instance.metadata.extension specifies the extension of the media files and the instance.metadata.imageFolder specifies the folder that contains the media files that are going to be minted. the files in that folder should be named according to the row number in the csv datafile. e.x. for extension='jpg' the file <imageFolder>/1.jpg will be minted for the first row and <imageFolder>/2.jpg for the second row and ...

## Running a workflow

To run the workflow you can run it by executing the cli while passing a workflow .json configuration to the command.

```
uniqcamp <path to workflow.json>
```

## Checkpionts

The workflow is checkpointed at each step, in case it is halted at any point during the process due to any failures, you can take it from where you left and continue it from the last successfull checkpoint by running the cli again.
