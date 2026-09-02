const { runEntrypoint } = require('@companion-module/base')
const { EpiphanPearl, upgradeScripts } = require('./src/instance')

runEntrypoint(EpiphanPearl, upgradeScripts)
