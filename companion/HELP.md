## Epiphan Pearl

Control and monitor Epiphan Pearl encoders (Pearl-2, Pearl Mini, Pearl Nano, Pearl Nexus) from Companion. The action set matches the sibling Epiphan Pearl Stream Deck plugin one for one: Recorder, Stream, Layout, Single Touch, Bookmark, Preview, Output Source, Apply Preset, Event, System Status, Reboot / Shutdown, Audio and Storage.

### Requirements

- **Pearl firmware 4.24.1 or newer** for the full feature set. This module talks to the Pearl REST API v2.0 (`/api/v2.0/...`).
- **Older firmware** still works for the actions that do not need v2.0: Stream, Layout, Bookmark and Reboot / Shutdown work in full; Recorder works for a single recorder's Start/Stop/Toggle/Reset (Pause, Resume and "All recorders" need v2.0). Every other action is marked _requires API v2.0_ below. On older firmware (or with _Use API v2.0 (if available)_ unticked) such an action logs a warning and does nothing when pressed, and such a feedback is always false (previews and system/AFU data stay empty).
- A Pearl user with **admin** rights (the default `admin` account). Operator accounts cannot change settings.
- Network access from the Companion host to the Pearl's HTTP port (80 by default), or its HTTPS port (443 by default) when _Use HTTPS_ is ticked.

If you are upgrading a connection created before this module's 3.0.0 release, an upgrade script converts every action and feedback that still has a Stream Deck counterpart to its new id automatically (your buttons keep working, though a few option layouts changed — see the changelog). A handful of actions and feedbacks had no Stream Deck counterpart at all (renaming channels/publishers, input mute/phantom power, RTMP/SRT destination editing, ad-hoc CMS sessions, network connectivity/speed test, content metadata, manual refresh) and are gone; if any button still holds one, the connection log prints one warning per removed id the first time it starts, naming how many buttons carried it.

### Connection settings

The setting names below are the labels shown in the connection's settings page.

| Setting                                                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Host**                                                    | IP address or DNS name of the Pearl (default `192.168.255.250`).                                                                                                                                                                                                                                                                                                                                                                      |
| **Port**                                                    | HTTP port of the Pearl web UI/API (default `80`; becomes `443` automatically the first time you turn on _Use HTTPS_ if you left it at `80`).                                                                                                                                                                                                                                                                                          |
| **Username**                                                | Pearl account name (default `admin`).                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Password**                                                | Password for that account. Leave blank if the Pearl has no password set.                                                                                                                                                                                                                                                                                                                                                              |
| **Use HTTPS**                                               | Off by default. If HTTPS is enabled on the Pearl, enable it here too.                                                                                                                                                                                                                                                                                                                                                                 |
| **Accept self-signed certificate**                          | Shown only while _Use HTTPS_ is ticked. Ticked by default: accept the Pearl's own (self-signed) certificate without a trusted CA. Untick to require a certificate a public or internal CA has signed; an untrusted certificate then fails the connection instead of being accepted.                                                                                                                                                   |
| **Poll interval (ms)**                                      | Milliseconds between state polls (500..300000, default `2000`). Every poll refreshes channels, publishers, recorders, inputs, outputs, storage, single touch, system status and the CMS schedule. Firmware, device identity and the list of configuration presets are fetched on the first poll and then every 30th poll. If a poll fails, the next one waits longer (doubling each time, up to 15 s) until the device answers again. |
| **Request timeout (ms)**                                    | Milliseconds a single request may take before it is aborted (1000..60000, default `5000`).                                                                                                                                                                                                                                                                                                                                            |
| **Preview image refresh interval (s, 0 disables previews)** | Seconds between preview image refreshes (0..300, default `2`). `0` disables every preview (the audio meter has its own 500 ms level poll and is not affected). Only previews actually placed on a button are fetched, at most 3 at a time, so a page full of preview buttons does not overwhelm the Pearl.                                                                                                                            |
| **Preview image width (px)**                                | Width in pixels requested from the Pearl for preview images (72..720, default `144`). Larger images look sharper on big surfaces but cost more bandwidth and CPU on the Pearl.                                                                                                                                                                                                                                                        |
| **Poll CMS schedule**                                       | Ticked (default): poll the upcoming and ongoing CMS event, plus the next 10 scheduled/recent events, every poll (Kaltura, Panopto, YuJa, Opencast...). Untick if the Pearl is not connected to a CMS.                                                                                                                                                                                                                                 |
| **Enable verbose logging**                                  | Log every request and response at debug level. Useful when reporting a problem; leave off in normal use.                                                                                                                                                                                                                                                                                                                              |
| **Use API v2.0 (if available)**                             | Ticked (default): probe for the v2.0 API and use it; fall back to the legacy API if it is missing. Untick to force the legacy API.                                                                                                                                                                                                                                                                                                    |
| **Preset categories to generate**                           | Multi-select, default: every category. Controls which groups of ready-made buttons appear in the drag-and-drop preset list (see Presets below). Unchecking a group only hides its auto-generated buttons; the underlying actions and feedbacks stay available for a hand-built button, and anything already on a page keeps working.                                                                                                  |

### Actions, feedbacks, variables and presets

Actions never disable the connection when the Pearl rejects a request: the device's own error message is
logged and written to the `last_error` variable. Text options that accept variables (`Bookmark`'s Text,
`Layout`'s Layout ID) are expanded with Companion's variable parser before being sent.

#### Recorder

Start, stop, pause or toggle a Pearl recorder. Toggle starts a stopped recorder and stops a running or
paused one; "All recorders" controls every recorder on the device.

| Option       | Values                                    | Default       |
| ------------ | ----------------------------------------- | ------------- |
| **Recorder** | "All recorders" or a specific recorder    | All recorders |
| **Action**   | Toggle, Start, Stop, Pause, Resume, Reset | Toggle        |

Pause, Resume and "All recorders" require API v2.0. Start/Stop/Toggle/Reset on a single recorder work on
legacy firmware too — Reset automatically falls back to the legacy endpoint if the v2.0 one is unavailable.

**Feedback — Recorder state** (`recorder_state`): true while the selected recorder — or, for "All
recorders", the aggregate of every recorder — is in the chosen state (Started, Starting, Paused, Error,
Stopped, Disabled). The aggregate reports the first of Started, Starting, Paused, Error found among all
recorders, otherwise Stopped. Style: red badge (used for Started/Error), amber for Paused/Starting.

**Variables**: `recorder_ID_name`, `_state`, `_state_word` (`REC`/`PAUSED`/`ERR`/`OFF`/`?`), `_duration`
(seconds), `_duration_text` (`3:45`/`1:02:03`), `_duration_hms` (`HH:MM:SS`); `recorder_all_state_word`,
`recorders_active_count`.

**Presets — Recording**: one toggle button per recorder plus "All recorders"; red while recording or
errored, amber while paused or starting.

#### Stream

Start, stop or toggle a channel's stream (publisher). "All publishers" starts or stops every stream
configured on the channel.

| Option        | Values                                                           | Default       |
| ------------- | ---------------------------------------------------------------- | ------------- |
| **Channel**   | the Pearl's channels                                             | first channel |
| **Publisher** | "Channel – All publishers" or a specific "Channel – Name (type)" | first entry   |
| **Action**    | Toggle, Start, Stop                                              | Toggle        |

**Feedback — Stream state** (`stream_state`): true while the selected publisher — or, for "All
publishers", the aggregate of the channel's publishers — is in the chosen state (Started, Starting,
Listening, Error, Stopped). Green (Started), amber (Starting/Listening), red (Error).

**Variables**: `channel_CID_publisher_PID_name`, `_type`, `_state`, `_state_word`
(`LIVE`/`STARTING`/`LISTEN`/`ERR`/`OFF`/`?`), `_error`; `channel_CID_publishers_state_word` (aggregate);
`channel_CID_name`.

**Presets — Streaming**: one toggle button per publisher and per channel's "All publishers"; green LIVE,
amber STARTING/LISTEN, red ERR.

#### Layout

Switch a channel to a layout. The key lights up while that layout is active.

| Option        | Values                                                     | Default       |
| ------------- | ---------------------------------------------------------- | ------------- |
| **Channel**   | the Pearl's channels                                       | first channel |
| **Layout**    | layouts of that channel, labelled "Channel – Layout"       | first entry   |
| **Layout ID** | text, accepts variables; used only while _Layout_ is empty | `''`          |

_Layout ID_ tooltip (verbatim): "Fallback for firmware that does not list layouts: type the layout ID shown
in the Pearl Admin UI (Channel → Layouts). Used only while "Layout" is empty."

**Feedback — Layout active** (`layout_active`): true while the selected layout is the active layout of its
channel. Amber.

**Feedback — Layout preview** (advanced, `layout_preview`): shows a live preview image of that specific
layout on its switch button, whether or not it is currently active. Uses an undocumented endpoint (not in
Epiphan's published REST API v2.0 specification, confirmed working by Epiphan) that renders a given layout
directly. Requires _Preview image refresh interval_ > 0.

**Variables**: `channel_CID_active_layout` (name), `_active_layout_id`, `_name`.

**Presets — Layouts**: one button per layout, title = layout name, subtitle = channel name; amber while
active, plus the live preview image.

#### Single Touch

Trigger a Pearl single-touch control (start/stop recording and streaming together). Most devices have only
control 0. _Requires API v2.0._

| Option                   | Values                             | Default                              |
| ------------------------ | ---------------------------------- | ------------------------------------ |
| **Single touch control** | the device's single touch controls | `0` when present, else the first one |

**Feedback — Single touch state** (`singletouch_active`): "On" is true while pressed; "Error" is true while
the control reports a failed start. Green (On), red (Error).

**Variables**: `singletouch_ID_active`, `_status_ok`, `_summary` (`rec 1/3 · str 1/2`), `_state_word`
(`ON`/`ERR`/`''`).

**Presets — Single touch**: one toggle button per control; green while pressed, red text while unhealthy.

#### Bookmark

Add a bookmark (marker) to a channel's recording. Bookmarks are only stored while the channel is recording.

| Option                                 | Values                  | Default       |
| -------------------------------------- | ----------------------- | ------------- |
| **Channel**                            | the Pearl's channels    | first channel |
| **Text**                               | text, accepts variables | `Marker`      |
| **Append the current time (HH:MM:SS)** | checkbox                | off           |

_Text_ tooltip (verbatim): "Shown in the recording’s bookmark list. Keep it short."

No new feedback — the Bookmarks preset reuses **Recorder state** with _Recorder_ set to the channel's own
id, so no variables are added either.

**Presets — Bookmarks**: one button per channel, text `Bookmark` / `Marker`; grey text while the channel's
recorder is not recording (an inverted **Recorder state** feedback).

#### Preview

Show a live thumbnail of a channel, video input or output on the key. Display-only — there is no dedicated
action; place the feedback directly (or use a Previews preset).

**Feedback — Preview** (advanced, `preview`): _Source type_ = Channel (default), Input or Output; _Source_
lists channels, video-capable inputs and outputs together (an audio-only input has no picture and is not
offered) — pick the entry matching _Source type_. Requires _Preview image refresh interval_ > 0. Channel,
input and output previews require API v2.0 and stay blank without it; the _Layout preview_ feedback (see
Layout above) works on legacy firmware too, since it uses the same legacy endpoint on both API versions.

**Variables**: `channel_CID_name`, `input_ID_name`, `output_ID_name` (used as the title line on the preview
presets).

**Presets — Previews**: one button per channel, per video-capable input and per output, showing the live
image with the source's name.

#### Output Source

Switch the source shown on a Pearl HDMI/SDI output. _Requires API v2.0._

| Option     | Values                                                                                    | Default      |
| ---------- | ----------------------------------------------------------------------------------------- | ------------ |
| **Output** | the device's outputs                                                                      | first output |
| **Source** | Built-in: Multiview, Built-in: Device info, Built-in: Console, Channel: name, Input: name | first entry  |

**Feedback — Output source recently set** (`output_set`): true while this connection set the selected
source on the selected output within the last 5 seconds. The API has no way to read the output source back,
so this only reflects what this connection itself last sent, not a value confirmed by the device. Green.

**Variables**: `output_ID_name`, `_source` (optimistic, empty until set, see Known limitations).

**Presets**: none — build Output Source buttons by hand from the action above (green **Output set** feedback).

#### Apply Preset

Apply a Pearl configuration preset. This can interrupt recordings and streams and the device may reboot.
_Requires API v2.0._

| Option                          | Values                                                                                              | Default               |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| **Preset**                      | configuration presets stored on the device                                                          | first preset          |
| **Sections**                    | multi-select: System, Network, Sources, EDID, Channels, AFU, CMS, AV Studio, Front screen, Displays | none (= whole preset) |
| **Confirm with a second press** | checkbox — see Confirm and hold                                                                     | on                    |

**Feedback — Confirm pending** (`confirm_pending`): true while a confirm-gated action on this button is
armed, waiting for a second press. Red, with `Press again` in place of the label on that button only — see
Confirm and hold below.

**Feedback — Action failed (recent)** (`action_failed`): true for three seconds on the button whose last
device command failed — rejected (for example an Extend that would overlap the next event, 409), timed out
or unreachable. Red with `Failed` in place of the label; every ready-made preset that sends a command
carries it, so a refused command is visible on the key and not only in Companion's log. The message is in
`last_error`.

**Variables**: `preset_names` (comma-separated), `preset_last_applied` (optimistic), `preset_status`
(`Rebooting…` for 60 s when the device reports a reboot).

**Presets — Configuration presets**: one button per device preset, text `Apply` / preset name / the confirm
hint or `Rebooting…`; red while confirm is armed.

#### Event

Start, pause, resume, stop or extend a scheduled CMS event. Toggle adapts to the event state; a fixed
action that does not apply to the event is not sent. _Requires API v2.0._

| Option        | Values                                                                                                                                                                     | Default                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Event**     | Upcoming (next scheduled), Ongoing (running or paused), Running, Paused, Completed (most recent), or a specific polled event (`title (status)`, custom text also accepted) | Ongoing (running or paused)     |
| **Action**    | Status only (no action), Toggle (start / pause / resume), Start, Stop, Pause, Resume, Extend                                                                               | Toggle (start / pause / resume) |
| **Extend by** | seconds, 30..21600, shown only for Extend                                                                                                                                  | 300                             |

_Event_ tooltip (verbatim): "\"Ongoing\" always targets the event that is currently running or paused,
\"Upcoming\" the next scheduled one. Picking a specific event ties the button to it." The event is resolved
fresh from the device at press time, not from the last poll, so an alias can never fire on a stale event.

**Feedback — Event state** (`event_state`): true while the resolved event is in the selected state
(Running, Paused, Ongoing (running or paused), Scheduled, Finished, None). Green (Running), amber (Paused),
cms blue (Scheduled), grey (None).

**Feedback — Event command applies** (`event_applies`): true while the selected command (Start, Stop,
Pause, Resume, Extend) would actually be sent for the resolved event's current status — the same rule the
Event action itself uses. Cms blue.

**Variables**: `event_upcoming_id`/`_title`/`_start`/`_start_time`/`_starts_in_hms`/`_time_text`
(`in 5:00`/`Starting…`/`Nothing scheduled`)/`_state_word` (`SCHED`/`—`); `event_ongoing_id`/`_title`/
`_status`/`_finish`/`_finish_time`/`_remaining_hms`/`_time_text` (`12:30 left`/`No ongoing event`)/
`_state_word` (`LIVE`/`PAUSED`/`—`); `event_ongoing_toggle_command` (`START`/`PAUSE`/`RESUME`/`''`); aliases
`event_title`, `event_state`, `event_remaining` (mirror the ongoing event).

**Presets — CMS events**: ongoing status, upcoming status, toggle, start upcoming, stop, pause, resume,
extend +5:00. The status/toggle buttons colour by state; the five command buttons grey out their text (an
inverted **Event command applies**) when the command does not currently apply.

#### System Status

Show CPU load and temperature, automatic file upload (AFU) state and device info. Display-only — polling
replaces the Stream Deck's tap-to-refresh key (there is no dedicated action). CPU load/temperature and AFU
data require API v2.0; on legacy firmware the feedback stays false and its variables stay empty.

**Feedback — System condition** (`system`): true while the selected condition holds — CPU load high, CPU
temperature high, AFU uploading, AFU paused, AFU error, AFU idle, AFU off (disabled or none). Amber
(CPU/paused), red (error), green (uploading).

**Variables**: `cpu_load`, `cpu_temp`, `uptime_seconds`, `uptime` (`3d 4h`), `system_status_text`
(`47°C · up 3d 4h`), `afu_state` (comma-separated states of every AFU destination), `afu_text`
(`Uploading`/`Idle`/`Paused`/`Error`/`AFU off`), `afu_protocol`, `afu_queue_files`, `afu_error`,
`product_name`, `firmware`, `device_name`.

**Presets — System**: CPU load / status button (amber while high or hot), AFU status button (green
uploading, amber paused, red error), device info button.

#### Reboot / Shutdown

Reboot or shut down the Pearl. Shut down powers the Pearl off completely; it must be switched back on at the
device.

| Option                          | Values                          | Default |
| ------------------------------- | ------------------------------- | ------- |
| **Action**                      | Reboot, Shut down               | Reboot  |
| **Confirm with a second press** | checkbox — see Confirm and hold | on      |

**Feedback**: **Confirm pending** (see Apply Preset above).

**Variables**: `power_status` (`Command sent` for 30 s).

**Presets — Power**: Reboot, Shut down; red while confirm is armed.

#### Audio

Nudge the capture gain (dB) or the audio delay (ms) of an audio input. "Nothing" only re-reads the input.
Rotary ticks arriving within 150 ms are combined into one step — see Rotary below. _Requires API v2.0._

| Option            | Values                                                     | Default     |
| ----------------- | ---------------------------------------------------------- | ----------- |
| **Input**         | audio-capable inputs                                       | first input |
| **Press adjusts** | Nothing, Gain, Delay                                       | Nothing     |
| **Direction**     | Up, Down — shown only while _Press adjusts_ is not Nothing | Up          |
| **Step**          | 1..100 — shown only while _Press adjusts_ is not Nothing   | 1           |

_Step_ tooltip (verbatim): "Gain steps are in dB (0–100), delay steps in milliseconds (−300..300)."

**Feedback — Audio meter** (advanced, `audio`): draws a stereo level meter for an audio input on the right
edge of the button — two vertical bars (left and right channel) with a light peak tick each, over a
−60..0 dBFS scale: green up to 62 % of the bar, amber to 82 %, red above. The bars are drawn _over_ the
button, so its own text, colour and other feedbacks stay visible; a mono input gets a single bar, and an
input reporting no levels (no signal, or a device without the level endpoint) draws nothing at all.

Putting this feedback on a button starts a **500 ms level poll** for the whole connection; taking the last
one off stops it again. One poll covers every metered input (a single request lists them all), so ten meter
buttons cost the Pearl no more than one. The level variables below are filled by that poll only — while no
meter is placed anywhere in the connection they read empty. If you want a text-only level readout, keep one
meter button somewhere in the same connection, or press a button with _Press adjusts_ = Nothing, which
re-reads the levels once.

**Variables**: `input_ID_name` (every input, incl. video-only), and for audio-capable inputs also
`_peak_dbfs`, `_peak_left`, `_peak_right`, `_level_text` (`-18 dBFS`/`silent`/`No signal`; all four empty
while no meter is subscribed), `_gain`, `_delay` (from the regular poll, always available).

**Presets**: none — build audio buttons by hand from the action, feedback and variables above (a rotary
button works with the action on both rotate steps, see Rotary below).

#### Storage

Eject removable media (SD card / USB) from a Pearl storage device. The main storage cannot be ejected.
_Requires API v2.0._

| Option                          | Values                          | Default                                 |
| ------------------------------- | ------------------------------- | --------------------------------------- |
| **Storage**                     | the device's storages           | `main` when present, else the first one |
| **Confirm with a second press** | checkbox — see Confirm and hold | on                                      |

Ejecting a storage that has nothing to eject (`No media`) logs "Nothing to eject" and does nothing — it
never arms a confirm.

**Feedback — Storage level** (`storage_level`): true while the selected storage is in the selected
condition — Low (≥ 90 % used), Full (≥ 97 % used), Read-only, No media, Not ready, Formatting, OK. Amber
(Low), red (Full), grey (No media).

**Feedback**: **Confirm pending** (see Apply Preset above).

**Variables**: `storage_ID_state`, `_free` (human bytes, e.g. `11 GB`), `_total`, `_used_pct`, `_text`
(`of 128 GB`, read under `_free` as "11 GB of 128 GB"/`No media`/`Not ready`/`Formatting…`/`No data`), `_level_word` (`LOW`/`FULL`/`RO`/`''`),
`_hint` (`Ejected` for 4 s).

**Presets — Storage**: one button per storage showing free space, status and eject hint; green OK, amber
Low, red Full, grey No media; red while confirm is armed.

### Confirm and hold

Companion has no press-and-hold progress arc, so the actions the Stream Deck plugin gates behind a hold
(_Apply Preset_, _Reboot / Shutdown_, _Storage_'s eject) instead offer a **Confirm with a second press**
checkbox, ticked by default. With it ticked, the first press only arms the button — it sets the
`confirm_hint` variable to `Press again` and turns on the **Confirm pending** feedback (red) —
and sends nothing to the device; pressing the _same_ button again within 3 seconds sends the command. If 3
seconds pass without a second press, the button quietly disarms. Untick the checkbox to send the command
immediately on every press, matching the old (pre-3.0.0) behaviour.

Only one confirm can be armed at a time: pressing a different confirm-gated button while one is already
armed re-arms the new one and drops the first, rather than the two buttons confirming independently.

If you would rather reproduce the Stream Deck's actual hold gesture, use Companion's own press-duration
button steps instead: put the action under **Release after N ms** (Companion's button step editor lets you
add a step for "released after" a given hold time — use 2000 ms for _Reboot / Shutdown_, 1500 ms for _Apply
Preset_ and _Storage_'s eject, matching the Stream Deck plugin's own hold times) and untick **Confirm with a
second press** on that copy of the action — the command then only fires when the button is held down for at
least that long and then released, and a short tap does nothing.

### Rotary (Stream Deck+)

Companion sends **Rotate left** / **Rotate right** (and, on push-capable surfaces, a separate **Press**)
events for rotary controls. The Audio presets' rotary Gain and rotary Delay buttons wire the _Audio_ action
into both rotate directions (Down = decrease, Up = increase, both with _Step_ 1) and put the same action
with _Press adjusts_ set to Nothing on the push step, so pressing the dial simply re-reads the input (its
levels straight away, the rest with the next poll) instead of changing anything. Ticks that arrive within
150 ms of each other (a fast spin of the dial, or several quick presses of a Gain/Delay preset button) are
combined into a single request carrying their summed step, rather than sending one request per tick — three
quick clicks of a _Step_ 1 gain dial send one change of +3, not three of +1.

Add the **Audio meter** feedback to a dial's button to see the bars next to the gain or delay readout.

### Feedbacks summary

| Feedback             | Type             | Colour(s)                                                          |
| -------------------- | ---------------- | ------------------------------------------------------------------ |
| `recorder_state`     | boolean          | red (Started/Error), amber (Starting/Paused)                       |
| `stream_state`       | boolean          | green (Started), amber (Starting/Listening), red (Error)           |
| `layout_active`      | boolean          | amber                                                              |
| `layout_preview`     | advanced (image) | —                                                                  |
| `singletouch_active` | boolean          | green (On), red (Error)                                            |
| `preview`            | advanced (image) | —                                                                  |
| `output_set`         | boolean          | green                                                              |
| `event_state`        | boolean          | green (Running), amber (Paused), cms blue (Scheduled), grey (None) |
| `event_applies`      | boolean          | cms blue                                                           |
| `system`             | boolean          | amber (CPU/paused), red (error), green (uploading)                 |
| `storage_level`      | boolean          | amber (Low), red (Full), grey (No media)                           |
| `audio`              | advanced (image) | —                                                                  |
| `confirm_pending`    | boolean          | red, `Press again` on the key                                      |
| `action_failed`      | boolean          | red, `Failed` on the key for 3 s                                   |

### Variables summary

Use variables as `$(pearl:variable_id)` where `pearl` is the label you gave the connection. Ids built from a
device id (recorders, channels, publishers, inputs, outputs, storages, single touch controls) have every
character other than letters, digits, `_` and `-` replaced by `_`. Suffixes ending `_hms` are `HH:MM:SS`;
`_text`/`_time` suffixes are the ready-to-display forms described in each action's section above. Unknown
values are always empty, never missing.

| Prefix                                                                                                   | Covered under                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `recorder_*`, `recorders_active_count`                                                                   | Recorder                                                |
| `channel_*_publisher_*`, `channel_*_publishers_state_word`, `channel_*_name`, `channel_*_active_layout*` | Stream, Layout                                          |
| `singletouch_*`                                                                                          | Single Touch                                            |
| `input_*`                                                                                                | Audio                                                   |
| `output_*`                                                                                               | Output Source                                           |
| `preset_names`, `preset_last_applied`, `preset_status`                                                   | Apply Preset                                            |
| `event_*`                                                                                                | Event                                                   |
| `cpu_*`, `uptime*`, `system_status_text`, `afu_*`, `product_name`, `firmware`, `device_name`             | System Status                                           |
| `power_status`                                                                                           | Reboot / Shutdown                                       |
| `storage_*`                                                                                              | Storage                                                 |
| `confirm_hint`                                                                                           | every confirm-gated action (see Confirm and hold)       |
| `last_error`                                                                                             | every action (the most recent failure's device message) |

### Presets summary

Presets are generated from what the Pearl reports, so they appear after the first successful poll. Which
categories actually get generated is controlled by _Preset categories to generate_ (see Connection settings
above); all of them are on by default.

Every button follows the Stream Deck plugin's key layout, drawn with Companion's own renderer: the
category's icon small at the top, the text at the bottom (size 20; 16 on the CMS status keys and the stream
keys, which carry three lines; 22 on the Single touch summary; the Single touch and stream keys carry no icon so all their lines fit), a
dark background with light text, no top bar, and the state colour filling the background when a feedback
is true. Labels and text size stay editable like any Companion button.

| Category                  | Buttons                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| **Recording**             | Toggle per recorder, plus "All recorders".                                        |
| **Streaming**             | Toggle per stream (channel, stream name, state), plus "All Streams" per channel.  |
| **Layouts**               | Switch button per layout, live preview image.                                     |
| **Single touch**          | Toggle per control.                                                               |
| **Bookmarks**             | One button per channel (channel name / Bookmark), greyed out while not recording. |
| **Previews**              | Live thumbnail per channel, video-capable input and output.                       |
| **Configuration presets** | Apply button per device preset, confirm-gated.                                    |
| **CMS events**            | Ongoing/upcoming status, toggle, start/stop/pause/resume, extend +5:00.           |
| **System**                | CPU load/status, AFU status, device info.                                         |
| **Power**                 | Reboot, Shut down; both confirm-gated.                                            |
| **Storage**               | Status + eject per storage, confirm-gated.                                        |

### Tips

- **Toggle streams and recorders from presets.** The Streaming and Recording presets use the _Toggle_
  option together with a state feedback, so one button both shows and switches the state. Drag them onto a
  page and rename as needed.
- **Put live numbers on buttons.** Button text like `$(pearl:recorder_1_state_word) $(pearl:recorder_1_duration_text)`
  or `$(pearl:storage_main_free)` updates every poll. Countdown variables such as
  `$(pearl:event_upcoming_starts_in_hms)` are recomputed every poll too, corrected for the Pearl's own clock.
- **Preview thumbnails on a Stream Deck.** Add the _Preview_ or _Layout preview_ feedback (or use the
  Previews/Layouts presets) and set _Preview image width (px)_ to roughly the button size (72 for a classic
  Stream Deck key, 144 for XL/+ keys). Keep _Preview image refresh interval_ at 1–2 s and only place the
  previews you actually need — each one costs a request per interval.
- **Confirm dangerous buttons — or make them a real hold.** _Reboot / Shutdown_, _Storage_ eject and _Apply
  Preset_ all default to a second-press confirm; untick the checkbox and use Companion's own "Release after
  N ms" step instead if you want the actual Stream Deck hold gesture back (see Confirm and hold above).
- **Many channels or presets?** A slower _Poll interval (ms)_ (for example 5000–10000) reduces load on the
  Pearl. If the drag-and-drop preset list feels cluttered (a Pearl with many layouts or inputs can produce a
  lot of Layouts/Previews/Audio buttons), uncheck the categories you do not use in _Preset categories to
  generate_.
- **Something does not react?** Turn on _Enable verbose logging_, retry, and read the connection log: the
  Pearl's own error message is logged for every rejected request and also lands in the `last_error` variable.

### Known limitations

- **Channel/layout/publisher options use composite ids.** Companion dropdowns cannot depend on another
  option's current value, so _Layout_'s and _Publisher_'s choices pack their channel into the id itself
  (`Channel – Layout`, `Channel – Publisher (type)`). You never need to read or type these ids by hand
  except in _Layout ID_, the manual fallback.
- **Display-only Stream Deck settings are not offered.** Things that only changed how a Stream Deck key drew
  itself (show duration/title, per-key refresh rate and image resolution, on-press refresh, hold duration)
  have no Companion option; the same information is available through variables, and the connection's
  _Preview image refresh interval_/_width_ settings apply to every preview button at once.
- **Only one confirm can be armed at a time.** Arming a second confirm-gated button while another is still
  waiting for its second press drops the first one's arming rather than tracking both independently.
- **Layouts come from the legacy API.** REST API v2.0 has no endpoint to list layouts, so the layout
  dropdowns and the active-layout feedback use the legacy `/api/channels/{id}/layouts` endpoints, which work
  on all supported firmware versions.
- **Layout previews use an undocumented endpoint.** `GET /channels/{cid}/layouts/{lid}/preview` is not part
  of Epiphan's published REST API v2.0 specification; it was confirmed working by Epiphan, but as an
  unpublished endpoint it could change or be removed in a future firmware update without appearing in
  Epiphan's release notes. If that happens the preview simply stops producing an image, like any other
  unreachable preview.
- **Input levels come from the legacy API, and only while a meter is placed.**
  `input_ID_peak_dbfs`/`_peak_left`/`_peak_right`/`_level_text` and the _Audio meter_ feedback are filled by
  a 500 ms poll of the legacy `GET /api/sources/status` list (its ids carry a device-serial prefix the v2.0
  `/inputs` ids lack; the module matches them with the prefix stripped). That poll runs only while at least
  one _Audio meter_ feedback is on a button of this connection, so the four level variables read empty
  otherwise; the regular poll interval never fetches levels. On a device where the endpoint is unavailable
  they stay empty rather than erroring.
- **Output source, applied configuration preset and storage hints are optimistic.** The API can set an
  output's source, apply a configuration preset and eject a storage, but has no endpoint to read any of
  those back. `output_ID_source`, `preset_last_applied` and the matching feedbacks therefore only reflect
  the last value set through Companion — empty/false after a restart, and stale if changed from the Pearl
  web UI or another controller.
- **Not exposed on purpose.** Renaming channels/publishers, muting or phantom-powering inputs, editing
  RTMP/SRT destinations, creating publishers or network inputs, ad-hoc CMS sessions, network
  connectivity/speed test and content metadata have no Stream Deck counterpart and are not offered by this
  module (see Requirements above for what happens to a button that still has one from an older connection).
- **Legacy firmware** (before 4.24.1, or with _Use API v2.0 (if available)_ unticked) only offers the
  actions and feedbacks marked above as not requiring it. Every action/feedback marked _requires API v2.0_
  is still listed but not functional on such a device: the action logs a warning and does nothing when
  triggered, the feedback is always false, and its variables stay empty.
