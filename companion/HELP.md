## Epiphan Pearl

Control and monitor Epiphan Pearl encoders (Pearl-2, Pearl Mini, Pearl Nano, Pearl Nexus) from Companion: switch layouts, start and stop streams and recorders, mute inputs, route outputs, react to storage and CMS schedule state, and show live preview thumbnails on your buttons.

### Requirements

- **Pearl firmware 4.24.1 or newer** for the full feature set. This module talks to the Pearl REST API v2.0 (`/api/v2.0/...`).
- **Older firmware** still works: when the v2.0 API is not available (or "Use API v2.0" is unticked) the module falls back to the legacy `/api/...` API and offers the original feature set (layouts, streaming, recording, markers, layout data, content metadata, reboot/shutdown). Everything listed below as _v2.0 only_ is hidden or logs a warning on legacy devices.
- A Pearl user with **admin** rights (the default `admin` account). Operator accounts cannot change settings.
- Network access from the Companion host to the Pearl's HTTP port (80 by default).

### Connection settings

| Setting                               | Meaning                                                                                                                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Target IP / hostname**              | IP address or DNS name of the Pearl (default `192.168.255.250`).                                                                                                                                                                                                            |
| **Target Port**                       | HTTP port of the Pearl web UI/API (default `80`).                                                                                                                                                                                                                           |
| **Username**                          | Pearl account name (default `admin`).                                                                                                                                                                                                                                       |
| **Password**                          | Password for that account. Leave blank if the Pearl has no password set.                                                                                                                                                                                                    |
| **Feedback polling frequency**        | Seconds between state polls (1..300, default `10`). Every poll refreshes channels, publishers, recorders, inputs, outputs, storage, single touch and system status. Lower values react faster but put more load on the Pearl.                                               |
| **Request timeout**                   | Milliseconds a single request may take before it is aborted (1000..60000, default `5000`).                                                                                                                                                                                  |
| **Use API v2.0 (if available)**       | Ticked (default): probe for the v2.0 API and use it; fall back to the legacy API if it is missing. Untick to force the legacy API.                                                                                                                                          |
| **Preview refresh interval**          | Seconds between preview image refreshes (default `2`). `0` disables preview feedbacks entirely. Only previews that are actually placed on a button are fetched, each one costs one image request per interval, so 6 preview buttons at 2 s means 3 requests/s to the Pearl. |
| **Preview width**                     | Width in pixels requested from the Pearl for preview images (72..720, default `144`). Larger images look sharper on big surfaces but cost more bandwidth and CPU on the Pearl.                                                                                              |
| **Poll CMS schedule**                 | Ticked (default): poll the upcoming and ongoing CMS event every poll (Kaltura, Panopto, YuJa, Opencast...). Untick if the Pearl is not connected to a CMS.                                                                                                                  |
| **Poll last archive file**            | Off by default. When ticked, the newest recording of every recorder is fetched each poll and exposed as `recorder_N_last_file_*` variables.                                                                                                                                 |
| **Poll network connectivity details** | Off by default. When ticked, `/system/connectivity/details` is fetched every 6th poll and exposed as `connectivity_*` variables.                                                                                                                                            |
| **Enable verbose logging**            | Log every request and response at debug level. Useful when reporting a problem; leave off in normal use.                                                                                                                                                                    |

### Actions

Text options accept Companion variables (for example `$(internal:time_hms)` as a marker text). Actions never disable the connection when the Pearl rejects a request: the device's error message is written to the connection log.

#### Channels & layouts

| Action                    | Notes                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Change channel layout** | Activates the selected layout of a channel.                                                                                      |
| **Set channel name**      | Renames a channel. _v2.0 only._                                                                                                  |
| **Insert Marker**         | Adds a chapter bookmark with the given text to the recording that is currently running on the channel (MP4/MOV recordings only). |
| **Get layout data**       | Reads the full layout JSON of a layout into a custom variable.                                                                   |
| **Set layout data**       | Writes a layout JSON (usually obtained with _Get layout data_) back to a layout.                                                 |
| **Get Content Metadata**  | Reads title, author and filename prefix of a channel into the `channel_N_metadata_*` variables.                                  |
| **Set Content Metadata**  | Sets title, author and filename prefix of a channel.                                                                             |

#### Streams / publishers

| Action                         | Notes                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Control streaming**          | Start, stop or toggle a single publisher or all publishers of a channel.                                                                                                          |
| **Set publisher name**         | Renames a publisher. _v2.0 only._                                                                                                                                                 |
| **Set publisher enabled**      | Enables/disables a publisher (disabled publishers are skipped by "all publishers" start). _v2.0 only._                                                                            |
| **Set publisher single touch** | Includes/excludes a publisher from the front-panel single touch control. _v2.0 only._                                                                                             |
| **Set RTMP destination**       | Sets URL, stream key, username and/or password of an RTMP(S) publisher. Blank fields are left unchanged. _v2.0 only._                                                             |
| **Set SRT destination**        | Sets mode (caller/listener/rendezvous), URL, stream id, port and/or latency of an SRT publisher. Blank fields are left unchanged. _v2.0 only._                                    |
| **Patch publisher settings**   | Sends an arbitrary JSON partial update to a publisher's settings (`PATCH .../publishers/{pid}/settings`). Use this for protocol settings without a dedicated action. _v2.0 only._ |
| **Add publisher**              | Creates a new publisher on a channel from a name and a JSON settings object (`POST .../publishers`). _v2.0 only._                                                                 |

Example body for **Patch publisher settings** (RTMP, taken from the API reference):

```json
{
	"rtmp": { "url": "rtmp://192.168.86.57", "stream": "PATCHED STREAM" },
	"common": { "enabled": false }
}
```

Example settings for **Add publisher** (RTMP push):

```json
{
	"type": "rtmp",
	"rtmp": {
		"disable_audio": false,
		"url": "rtmp://192.168.86.51",
		"stream": "",
		"username": "",
		"password": ""
	},
	"common": { "enabled": false, "single_touch": false }
}
```

Other publisher types use the same shape with `type` set to `rtsp`, `srt`, `hls`, `ndi`, `mpegts-udp`, `mpegts-rtp` or `rtp-udp` and a matching settings block (`rtsp`, `srt`, `hls`, `ndi`, `mpegts_udp`, `mpegts_rtp`, `rtp_udp`).

#### Recorders

| Action                    | Notes                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Control recording**     | Start, stop, reset or toggle a single recorder (channel recorder or multi-source recorder). Reset closes the current file and starts a new one. |
| **Control all recorders** | Start or stop every recorder on the device at once. _v2.0 only._                                                                                |

#### Inputs

| Action                   | Notes                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Input audio mute**     | Mutes/unmutes an analog/local audio input. _v2.0 only._                                                                                                              |
| **Input audio gain**     | Sets the gain (dB) of an audio input, for the stereo pair or for channel A / B individually (splitting the stereo pair). _v2.0 only._                                |
| **Input audio delay**    | Sets the audio delay of an input in milliseconds (-300..300). _v2.0 only._                                                                                           |
| **Input phantom power**  | Switches 48 V phantom power on or off on inputs that support it. _v2.0 only._                                                                                        |
| **Patch input settings** | Sends an arbitrary JSON partial update to an input's settings (`PATCH /inputs/{sid}/settings`). Not all inputs accept settings (the Pearl answers 405). _v2.0 only._ |
| **Create network input** | Creates a new RTSP, SRT, NDI, Web Graphics or Dante input from a type, a name and a JSON settings object (`POST /inputs`). _v2.0 only._                              |

Example settings for **Create network input** (type `srt`, SRT listener, taken from the API reference):

```json
{
	"audio": { "delay": 0 },
	"video": {
		"nosignal": { "image": "", "timeout": 8 },
		"force_full_color_range": true,
		"hwaccel_decoding": true
	},
	"srt": {
		"mode": "listener",
		"latency": 83,
		"encryption": { "passphrase": "AAAAAAAAAAAAAAAAAA", "keylength": 256 },
		"port": 1029
	}
}
```

An SRT caller uses `"srt": { "mode": "caller", "latency": 80, "encryption": null, "url": "srt://10.2.4.6:1025", "stream_id": "", "source_port": 0 }` instead.

Example body for **Patch input settings** (analog audio input):

```json
{
	"audio": { "delay": 0 },
	"local_audio": { "gain": 0, "mute": false }
}
```

#### Outputs

| Action                | Notes                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Set output source** | Routes a video output (HDMI/SDI out) to the multi-viewer, device info screen, console, a channel or an input. Choose _Custom_ to type any source id. _v2.0 only._ |

#### Single touch

| Action                  | Notes                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Single touch toggle** | Presses the single touch control: starts or stops every recorder and publisher that is included in single touch. _v2.0 only._ |

#### Storage

| Action            | Notes                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| **Eject storage** | Safely ejects a removable storage (USB drive / SD card). _v2.0 only._ |

#### Configuration presets

| Action                         | Notes                                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apply configuration preset** | Applies a configuration preset stored on the Pearl. Optionally restrict to sections (`system`, `network`, `sources`, `edid`, `channels`, `afu`, `cms`, `avstudio`, `frontscreen`, `displays`); empty means all sections. The Pearl may reboot afterwards, this is logged. _v2.0 only._ |

#### CMS events

| Action                    | Notes                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Event control**         | Start, stop, pause or resume a scheduled CMS event. Pick the _upcoming_ or _ongoing_ event (resolved at press time) or _Custom_ and type an event id. _v2.0 only._                                                                               |
| **Extend event**          | Adds the given number of seconds (default 300) to the finish time of the running or paused event. _v2.0 only._                                                                                                                                   |
| **Create ad-hoc event**   | Creates an ad-hoc event on the configured CMS from a JSON body (`POST /schedule/events`). Kaltura, Panopto and Opencast are supported. For Kaltura and Panopto an ad-hoc login session is normally required first, see limitations. _v2.0 only._ |
| **Ad-hoc session logout** | Deletes the active ad-hoc login session (`DELETE /schedule/events/adhoc/session`). _v2.0 only._                                                                                                                                                  |

Example body for **Create ad-hoc event** (Kaltura, taken from the API reference):

```json
{
	"type": "vod",
	"title": "Example ad-hoc event",
	"description": "Example event",
	"start": 60,
	"duration": 3600
}
```

`start` is seconds from now (or a Unix timestamp when above 31536000); `duration` is in seconds (minimum 60).

#### System

| Action                           | Notes                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reboot system**                | Reboots the Pearl.                                                                                                                                                      |
| **Shutdown system**              | Powers the Pearl off.                                                                                                                                                   |
| **Refresh connectivity details** | Fetches `/system/connectivity/details` once and updates the `connectivity_*` variables (independent of the polling option). _v2.0 only._                                |
| **Run speed test**               | Runs the built-in uplink/downlink TCP or UDP speed test for the given number of seconds (default 10) and stores the result in the `speedtest_*` variables. _v2.0 only._ |
| **Refresh state now**            | Polls the Pearl immediately instead of waiting for the next polling interval.                                                                                           |

### Feedbacks

All feedbacks except the previews are boolean and change the button style when true. The preview feedbacks draw an image on the button.

#### Channels & layouts

| Feedback                                  | True when                                                 |
| ----------------------------------------- | --------------------------------------------------------- |
| **Change style on channel layout change** | The selected layout is the active layout of a channel.    |
| **Channel preview**                       | Draws the live preview image of the channel. _v2.0 only._ |

#### Streams / publishers

| Feedback                      | True when                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Change style if streaming** | The selected publisher is streaming (or, for _all_, every publisher of the channel is streaming).           |
| **Publisher state**           | The selected publisher is in the chosen state: started, stopped, starting, listening or error. _v2.0 only._ |
| **Any publisher streaming**   | At least one publisher on the device is streaming. _v2.0 only._                                             |

#### Recorders

| Feedback                      | True when                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Change style if recording** | The selected recorder is recording.                                                                               |
| **Recorder state**            | The selected recorder is in the chosen state: started, stopped, paused, starting, error or disabled. _v2.0 only._ |
| **Any recorder recording**    | At least one recorder on the device is recording. _v2.0 only._                                                    |

#### Inputs and outputs

| Feedback           | True when                                                |
| ------------------ | -------------------------------------------------------- |
| **Input preview**  | Draws the live preview image of the input. _v2.0 only._  |
| **Output preview** | Draws the live preview image of the output. _v2.0 only._ |

#### Single touch

| Feedback                 | True when                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| **Single touch pressed** | The single touch control is active (its recorders/publishers were started by it). _v2.0 only._ |
| **Single touch OK**      | All recorders and publishers included in single touch report a healthy state. _v2.0 only._     |

#### Storage

| Feedback               | True when                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Storage state**      | The storage is in the chosen state: ready, no device, device present, read-only device or formatting. _v2.0 only._ |
| **Storage free below** | Free space of the storage is below the given percentage (default 10 %). _v2.0 only._                               |

#### CMS events

| Feedback         | True when                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Event status** | There is an upcoming event / the ongoing event is running / the ongoing event is paused / there is any ongoing event. _v2.0 only._ |

#### System

| Feedback          | True when                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| **AFU state**     | Automatic file upload is in the chosen state: idle, paused, uploading, error or disabled. _v2.0 only._ |
| **CPU load high** | The Pearl reports its CPU load as too high. _v2.0 only._                                               |
| **CPU temp high** | The CPU temperature has reached the device's threshold. _v2.0 only._                                   |

### Variables

Use variables as `$(pearl:variable_id)` where `pearl` is the label you gave the connection. Ids that contain a device id (inputs, outputs) have every character other than letters, digits, `_` and `-` replaced by `_`, for example input `D2P0.hdmi-a` becomes `input_D2P0_hdmi-a_name`. Durations ending in `_hms` are formatted `HH:MM:SS`; values ending in `_time` are local clock times `HH:MM`. Unknown values are empty.

#### Channels & layouts

| Variable                                             | Content                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `channel_N_name`                                     | Channel name                                                  |
| `channel_N_active_layout`                            | Name of the active layout                                     |
| `channel_N_active_layout_id`                         | Id of the active layout                                       |
| `channel_N_resolution`, `_fps`, `_bitrate`           | Video encoder resolution, frame rate and bitrate (kbit/s)     |
| `channel_N_publishers_count`                         | Number of publishers on the channel                           |
| `channel_N_streaming_count`                          | Number of publishers currently streaming                      |
| `channel_N_metadata_title`, `_author`, `_rec_prefix` | Content metadata (after _Get Content Metadata_ or first poll) |

#### Streams / publishers

| Variable                               | Content                                          |
| -------------------------------------- | ------------------------------------------------ |
| `stream_N_P_name`                      | Publisher name                                   |
| `stream_N_P_type`                      | Publisher type (rtmp, srt, hls, ndi, ...)        |
| `stream_N_P_state`                     | started / stopped / starting / listening / error |
| `stream_N_P_bitrate`                   | Current send rate                                |
| `stream_N_P_duration`, `_duration_hms` | Seconds streaming and as `HH:MM:SS`              |
| `stream_N_P_configured`                | Whether the publisher has a valid configuration  |
| `publishers_active_count`              | Publishers streaming on the whole device         |

#### Recorders

| Variable                                                                | Content                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `recorder_N_name`                                                       | Recorder name                                            |
| `recorder_N_state`                                                      | started / stopped / paused / starting / error / disabled |
| `recorder_N_active`                                                     | Whether the recorder is active                           |
| `recorder_N_duration`, `_duration_hms`                                  | Seconds of the current recording and as `HH:MM:SS`       |
| `recorder_N_total`                                                      | Bytes written in the current recording                   |
| `recorder_N_last_file_name`, `_last_file_size_mb`, `_last_file_created` | Newest archive file (needs _Poll last archive file_)     |
| `recorders_active_count`                                                | Recorders recording on the whole device                  |

#### Inputs and outputs

| Variable           | Content                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `input_ID_name`    | Input name                                                           |
| `input_ID_type`    | Input type (hdmi, sdi, usb, srt, rtsp, ndi, audio, ...)              |
| `output_ID_name`   | Output name                                                          |
| `output_ID_source` | Source last set through Companion (empty until set, see limitations) |

#### Single touch

| Variable                                        | Content                                       |
| ----------------------------------------------- | --------------------------------------------- |
| `stc_ID_pressed`                                | Whether the single touch control is active    |
| `stc_ID_status`                                 | Overall health of the controlled items        |
| `stc_ID_recorders_active`, `_recorders_total`   | Recorders running / included in single touch  |
| `stc_ID_publishers_active`, `_publishers_total` | Publishers running / included in single touch |

#### Storage

| Variable                          | Content                                   |
| --------------------------------- | ----------------------------------------- |
| `storage_ID_state`                | ready / nodev / dev / devro / formatting  |
| `storage_ID_media_type`           | Media type reported by the Pearl          |
| `storage_ID_total_gb`, `_free_gb` | Capacity and free space in GB (1 decimal) |
| `storage_ID_free_percent`         | Free space in percent                     |

#### Automatic file upload (AFU)

| Variable                                     | Content                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `afu_state`                                  | Comma separated states of all AFU destinations |
| `afu_protocol`                               | Protocol of the first AFU destination          |
| `afu_queue_files`, `afu_queue_size_mb`       | Files and MB waiting in the upload queue       |
| `afu_file_name`, `afu_file_progress_percent` | File currently uploading and its progress      |
| `afu_error`                                  | Last AFU error message                         |

#### CMS events

| Variable                                            | Content                               |
| --------------------------------------------------- | ------------------------------------- |
| `event_upcoming_id`, `event_upcoming_title`         | Next scheduled event                  |
| `event_upcoming_start`, `event_upcoming_start_time` | Start as Unix time and local `HH:MM`  |
| `event_upcoming_starts_in_hms`                      | Countdown to the start                |
| `event_ongoing_id`, `event_ongoing_title`           | Current event                         |
| `event_ongoing_status`                              | running / paused                      |
| `event_ongoing_finish`, `event_ongoing_finish_time` | Finish as Unix time and local `HH:MM` |
| `event_ongoing_remaining_hms`                       | Time left in the current event        |

#### System

| Variable                                                                                                                                                                                                             | Content                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `system_status_date`                                                                                                                                                                                                 | Device date/time                                      |
| `system_status_uptime`, `system_status_uptime_hms`                                                                                                                                                                   | Uptime in seconds and as `HH:MM:SS`                   |
| `system_status_cpuload`, `system_cpuload_high`                                                                                                                                                                       | CPU load in percent and the device's high-load flag   |
| `system_status_cputemp`, `system_cputemp_threshold`                                                                                                                                                                  | CPU temperature and the device's threshold            |
| `firmware_version`, `firmware_revision`                                                                                                                                                                              | Firmware version and revision                         |
| `product_name`, `product_id`                                                                                                                                                                                         | Device model                                          |
| `identity_name`, `identity_location`, `identity_description`                                                                                                                                                         | Device identity fields                                |
| `config_presets`                                                                                                                                                                                                     | Comma separated names of stored configuration presets |
| `connectivity_external_ip`, `connectivity_mdns`, `connectivity_dns`, `connectivity_http`, `connectivity_https`, `connectivity_captive_portal`, `connectivity_icmp`, `connectivity_epiphan_edge`, `connectivity_vtun` | Network connectivity check results                    |
| `speedtest_bandwidth_mbps`, `speedtest_protocol`, `speedtest_mode`, `speedtest_duration`, `speedtest_udp_loss`                                                                                                       | Result of the last _Run speed test_                   |

### Presets

Presets are generated from what the Pearl reports, so they appear after the first successful poll.

| Category           | Buttons                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Channels**       | One button per layout of every channel; red while that layout is active.                                       |
| **Publishers**     | One toggle button per publisher and per "all publishers" of a channel; green while streaming.                  |
| **Recorders**      | Toggle and reset button per recorder (red while recording), plus _All recorders start_ / _All recorders stop_. |
| **Outputs**        | One button per output and source (multi-viewer, device info, console, each channel, each input).               |
| **Inputs**         | Mute / unmute pair per audio input.                                                                            |
| **Previews**       | Live thumbnail button per channel, input and output.                                                           |
| **Single touch**   | Toggle button per single touch control; green while pressed, red text when something it controls is unhealthy. |
| **Storage**        | Status button per storage showing `... GB free`; red when below 10 % free.                                     |
| **System**         | CPU load, CPU temperature, uptime, reboot and refresh buttons.                                                 |
| **Events**         | Start upcoming, stop / pause / resume ongoing, extend +5 min, and a status display button.                     |
| **AFU**            | Upload status display (blue while uploading, red on error).                                                    |
| **Config presets** | One button per configuration preset stored on the Pearl (applies all sections).                                |

### Tips

- **Toggle streams and recorders from presets.** The Publisher and Recorder presets use the _Toggle_ action with a state feedback, so one button both shows and switches the state. Drag them onto a page and rename as needed.
- **Put live numbers on buttons.** Button text like `REC\n$(pearl:recorder_1_duration_hms)` or `$(pearl:storage_sd_free_gb) GB` updates every poll. Countdown variables such as `$(pearl:event_upcoming_starts_in_hms)` are recomputed every poll too.
- **Preview thumbnails on a Stream Deck.** Add the _Channel preview_ / _Input preview_ / _Output preview_ feedback (or the Previews presets) and set _Preview width_ to roughly the button size (72 for a classic Stream Deck key, 144 for XL/+ keys, larger for Stream Deck displays). Keep the refresh interval at 1..2 s and only place the previews you need, every one costs a request per interval.
- **Confirm dangerous buttons.** Reboot, shutdown, eject storage and apply configuration preset act immediately. Consider putting them on a second step or a separate page.
- **Many channels or presets?** Lower polling frequency (for example 15..30 s) reduces load on the Pearl; use _Refresh state now_ on a button when you need an immediate update.
- **Something does not react?** Turn on _Enable verbose logging_, retry, and read the connection log: the Pearl's own error message (for example "Input settings are not supported") is logged for every rejected request.

### Known limitations

- **Layouts come from the legacy API.** REST API v2.0 has no endpoint to list layouts or to read/write layout settings, so the layout dropdowns, the active layout feedback and _Get/Set layout data_ still use the legacy `/api/channels/{id}/layouts` endpoints. They work on all supported firmware versions.
- **No output source feedback.** The API can set an output's source but has no endpoint to read it back. `output_ID_source` therefore only reflects the last value set through Companion and is empty after a restart.
- **Not exposed on purpose.** Factory reset, deleting publishers and the ad-hoc CMS login (which would require CMS user credentials in a button) are deliberately not offered. _Create ad-hoc event_ on Kaltura/Panopto therefore only works when a login session already exists on the Pearl (created from its web UI) or when the CMS configuration does not require one.
- **Content metadata uses the admin CGI.** Title/author/prefix are read and written through `/admin/channelN/get_params.cgi` and `set_params.cgi` because they are not part of the REST API.
- **Legacy firmware** (before 4.24.1, or with _Use API v2.0_ unticked) only offers the original actions, feedbacks and variables; everything marked _v2.0 only_ is unavailable and logs a warning if triggered.
