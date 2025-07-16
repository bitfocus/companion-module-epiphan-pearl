const { CreateConvertToBooleanFeedbackUpgradeScript } = require('@companion-module/base')

function ensureConfigDefaults(_context, props) {
        const config = props.config
        if (!config) {
                return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
        }

        let changed = false
        if (config.verbose === undefined) {
                config.verbose = false
                changed = true
        }
        if (config.enable_metadata === undefined) {
                config.enable_metadata = false
                changed = true
        }
        if (config.meta_username === undefined) {
                config.meta_username = ''
                changed = true
        }
        if (config.meta_password === undefined) {
                config.meta_password = ''
                changed = true
        }

        return {
                updatedConfig: changed ? config : null,
                updatedActions: [],
                updatedFeedbacks: [],
        }
}

const upgradeToBooleanFeedbacks = CreateConvertToBooleanFeedbackUpgradeScript({
        channelLayout: {
                fg: 'color',
                bg: 'bgcolor',
        },
        channelStreaming: {
                fg: 'color',
                bg: 'bgcolor',
        },
        recorderRecording: {
                fg: 'color',
                bg: 'bgcolor',
        },
})

module.exports = {
        UpgradeScripts: [upgradeToBooleanFeedbacks, ensureConfigDefaults],
}
