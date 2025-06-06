module.exports = {
    /**
     * INTERNAL: Get the available variable definitions.
     *
     * @access protected
     * @since 2.2.0
     * @returns {Object[]} - the available variables
     */
    get_variables() {
        const variables = []

        // Channel related variables
        for (const channelId of Object.keys(this.state.channels)) {
            const channel = this.state.channels[channelId]
            variables.push({ variableId: `channel_${channelId}_name`, name: `Channel ${channelId} Name` })
            for (const publisherId of Object.keys(channel.publishers)) {
                const publisher = channel.publishers[publisherId]
                variables.push({ variableId: `stream_${channelId}_${publisherId}_name`, name: `Stream ${channelId}-${publisherId} Name` })
                variables.push({ variableId: `stream_${channelId}_${publisherId}_state`, name: `Stream ${channelId}-${publisherId} State` })
            }
        }

        // Recorder related variables
        for (const recorderId of Object.keys(this.state.recorders)) {
            variables.push({ variableId: `recorder_${recorderId}_state`, name: `Recorder ${recorderId} State` })
            variables.push({ variableId: `recorder_${recorderId}_duration`, name: `Recorder ${recorderId} Duration` })
            variables.push({ variableId: `recorder_${recorderId}_active`, name: `Recorder ${recorderId} Active` })
        }

        // System info variables
        variables.push({ variableId: 'system_status_date', name: 'System Status Date' })
        variables.push({ variableId: 'system_status_uptime', name: 'System Status Uptime' })
        variables.push({ variableId: 'afu_state', name: 'AFU State' })
        variables.push({ variableId: 'firmware_version', name: 'Firmware Version' })
        variables.push({ variableId: 'product_name', name: 'Product Name' })
        variables.push({ variableId: 'identity_name', name: 'Identity Name' })
        variables.push({ variableId: 'identity_location', name: 'Identity Location' })
        variables.push({ variableId: 'identity_description', name: 'Identity Description' })

        return variables
    },

    /**
     * INTERNAL: Update variable definitions and values.
     *
     * @access protected
     * @since 2.2.0
     */
    updateVariables() {
        const definitions = this.get_variables()
        const values = {}

        for (const channelId of Object.keys(this.state.channels)) {
            const channel = this.state.channels[channelId]
            values[`channel_${channelId}_name`] = channel.name
            for (const publisherId of Object.keys(channel.publishers)) {
                const publisher = channel.publishers[publisherId]
                values[`stream_${channelId}_${publisherId}_name`] = publisher.name
                values[`stream_${channelId}_${publisherId}_state`] = publisher.status?.state || ''
            }
        }

        for (const recorderId of Object.keys(this.state.recorders)) {
            const recorder = this.state.recorders[recorderId]
            values[`recorder_${recorderId}_state`] = recorder.status?.state || ''
            values[`recorder_${recorderId}_duration`] = recorder.status?.duration || ''
            values[`recorder_${recorderId}_active`] = recorder.status?.active || ''
        }

        if (this.state.system) {
            values['system_status_date'] = this.state.system.status?.date || ''
            values['system_status_uptime'] = this.state.system.status?.uptime || ''
            values['afu_state'] = this.state.system.afu?.state || ''
            values['firmware_version'] = this.state.system.firmware || ''
            values['product_name'] = this.state.system.product || ''
            values['identity_name'] = this.state.system.identity?.name || ''
            values['identity_location'] = this.state.system.identity?.location || ''
            values['identity_description'] = this.state.system.identity?.description || ''
        }

        this.setVariableDefinitions(definitions)
        this.setVariableValues(values)
    },
}
