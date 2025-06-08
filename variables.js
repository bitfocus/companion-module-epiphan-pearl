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
            variables.push({ variableId: `channel_${channelId}_active_layout`, name: `Channel ${channelId} Active Layout` })
            variables.push({ variableId: `channel_${channelId}_meta_title`, name: `Channel ${channelId} Title` })
            variables.push({ variableId: `channel_${channelId}_meta_author`, name: `Channel ${channelId} Author` })
            variables.push({ variableId: `channel_${channelId}_meta_copyright`, name: `Channel ${channelId} Copyright` })
            variables.push({ variableId: `channel_${channelId}_meta_comment`, name: `Channel ${channelId} Comment` })
            variables.push({ variableId: `channel_${channelId}_meta_description`, name: `Channel ${channelId} Description` })
            variables.push({ variableId: `channel_${channelId}_meta_rec_prefix`, name: `Channel ${channelId} Filename Prefix` })
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

        // Event related variables
        for (const eventId of Object.keys(this.state.events)) {
            variables.push({ variableId: `event_${eventId}_state`, name: `Event ${eventId} State` })
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
            const activeLayout = Object.values(channel.layouts || {}).find((l) => l.active)
            values[`channel_${channelId}_active_layout`] = activeLayout ? activeLayout.name : ''
            const meta = channel.metadata || {}
            values[`channel_${channelId}_meta_title`] = meta.title || ''
            values[`channel_${channelId}_meta_author`] = meta.author || ''
            values[`channel_${channelId}_meta_copyright`] = meta.copyright || ''
            values[`channel_${channelId}_meta_comment`] = meta.comment || ''
            values[`channel_${channelId}_meta_description`] = meta.description || ''
            values[`channel_${channelId}_meta_rec_prefix`] = meta.rec_prefix || ''
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

        for (const eventId of Object.keys(this.state.events)) {
            const ev = this.state.events[eventId]
            values[`event_${eventId}_state`] = ev.status?.state || ''
        }

        if (this.state.system) {
            const system = this.state.system
            values['system_status_date'] = system.status?.date || ''
            values['system_status_uptime'] = system.status?.uptime || ''
            values['afu_state'] = system.afu?.state || system.afu?.status || ''
            values['firmware_version'] = system.firmware || ''
            values['product_name'] = system.product?.name || system.product || ''

            const id = system.identity || {}
            const ident = id.identity || {}
            values['identity_name'] = id.name || ident.name || ''
            values['identity_location'] = id.location || ident.location || ''
            values['identity_description'] = id.description || ident.description || ''
        }

        this.setVariableDefinitions(definitions)
        this.setVariableValues(values)
    },
}
