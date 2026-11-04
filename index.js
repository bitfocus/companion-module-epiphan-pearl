const { EpiphanEncoder, upgradeScripts } = require('./src/instance')

// module-base 2.x: the module class is the export, the upgrade scripts hang off it (runEntrypoint() was removed)
module.exports = EpiphanEncoder
module.exports.UpgradeScripts = upgradeScripts
