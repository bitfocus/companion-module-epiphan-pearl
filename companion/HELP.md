## Epiphan Pearl Recorder/Streamer

Should work with all Epiphan Pearl models. Firmware 4.24.1 or newer is recommended: the module then uses the Pearl REST API v2.0 automatically. With older firmware the module uses the older API and shows a warning recommending a firmware update.

If the Pearl is not reachable, the module retries the connection every 10 seconds.

**Finding the Pearl on the network**

Pearls in the same network as Companion are found automatically (Bonjour) and listed under **Pearl** in the connection settings with their device name. Select one and enter username and password. For a Pearl in another network, e.g. behind a router or VPN, select **Manual** and enter its IP address or hostname.

**Available commands**

- Change channel layout
- Start/Stop channel recording/streaming
- Start/Stop recorder recording
- Get/Set Content Metadata - title, author, filename prefix
- Get/Set layout data
- Insert marker
- Reboot/shutdown system

**Variables (selection)**

- Storage per drive (`main` = internal drive, `external` = USB drive): state, total/used/free in GB and %, estimated remaining recording time (hh:mm, calculated from the bitrate of the running recordings, empty while nothing is recorded)
- Per channel: name, active layout, input signal, resolution, fps, bitrate
- Per recorder: state and duration, per stream: state, duration, reconnections and error
- System: firmware, uptime, CPU load and temperature with warnings, device name and location
