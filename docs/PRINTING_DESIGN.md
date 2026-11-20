# 4R Printing — Hardware Findings and Design

Status: implemented on `feat/printing` (2026-11-13). Software verified with the fake printer;
the physical acceptance checks in section 7 have not been run. Section 9 lists where the build
differs from this plan.
Date: 2026-11-13.

## 1. Product decisions (fixed)

1. Two Frame shapes. 1:3 Frames stay digital-only. Landscape 4R Frames (3:2) are the only printable shape. QR delivery works for both.
2. The operator runs the kiosk; guests have no controls. For each 4R session the operator turns printing on or off (off by default) and picks copies (1 when turned on, no maximum, no per-session limit).
3. Bordered, landscape 4R (6×4", 152.4×101.6 mm).
4. Any printer brand or model, USB or network.
5. Printer offline or out of paper: an indicator on the operator screen and the guest-facing display, plus an operator **Proceed** button. The skipped print stays queued and prints automatically when the printer comes back.
6. The operator can see and cancel queued jobs.
7. Operators can reprint any 4R photo from Recent photos, with a copy count.
8. Color management at a mid level: an optional ICC profile per printer, plus a built-in color test page.

## 2. Hardware findings

### 2.1 What was available on this machine

| Queue                  | Driver                               | Port       | Connected?                                    |
| ---------------------- | ------------------------------------ | ---------- | --------------------------------------------- |
| EPSON L3210 Series     | Epson ESC/P-R V4 Class Driver (v4)   | USB003     | No: `WorkOffline=True`, no USB device present |
| EPSON L110 Series      | EPSON L110 Series (v3 vendor driver) | USB002     | No: `WorkOffline=True`                        |
| Microsoft Print to PDF | Microsoft Print To PDF               | PORTPROMPT | Software, always available                    |

There is no network printer and no second brand. Both physical printers are Epson ink-tank (inkjet) models, not dye-sub, and neither was plugged in. **None of the physical-print acceptance tests could run yet.** Everything below comes from what the drivers report to Windows, plus one software print.

### 2.2 4×6 paper: same size, different names

The same physical size appears under three names and three IDs:

| Driver                   | Paper name                | RawKind | Size (1/100 in) |
| ------------------------ | ------------------------- | ------- | --------------- |
| Epson ESC/P-R V4 (L3210) | `102 x 152 mm (4 x 6 in)` | 127     | 400×600         |
| EPSON L110 (v3)          | `10 x 15 cm (4 x 6 in)`   | 285     | 400×600         |
| Microsoft Print to PDF   | `North America 4x 6`      | 183     | 400×600         |

**Consequence:** matching paper by name or ID can't work across brands. Match by **physical size (400×600 hundredths of an inch, either orientation)**, then let the operator confirm or override in Settings when a driver lists more than one candidate.

### 2.3 Printable area (bordered) is driver-specific and asymmetric

Reported for 4×6 paper, portrait coordinates, inches:

| Driver           | Left  | Top   | Right | Bottom    | Printable     |
| ---------------- | ----- | ----- | ----- | --------- | ------------- |
| L3210 (v4 class) | 0.133 | 0.119 | 0.133 | **0.195** | 3.733 × 5.686 |
| L110 (v3 vendor) | 0.117 | 0.117 | 0.117 | 0.117     | 3.767 × 5.767 |

The v4 driver keeps a larger margin on one short edge. These are what the drivers _say_. The real margin has to be confirmed on paper with the calibration chart (section 7).

### 2.4 Resolution

The L3210 reports one custom resolution of 360×360 DPI (Epson inkjets work at 360 and 720). The rest are quality levels (Draft to High) with no DPI attached. Dye-sub printers usually report 300. **Render the print image at the driver's reported DPI when it gives one, otherwise at 300 DPI.** At 300 DPI a full 6×4" sheet is 1800×1200 px; at 360 DPI it is 2160×1440 px.

The 1080p camera maximum (1920×1080) is fine for this: every slot is smaller than the full sheet.

### 2.5 Status reporting: don't trust `Get-Printer`

With both Epsons unplugged, `Get-Printer` reported **`PrinterStatus: Normal`**, while WMI (`Win32_Printer`) reported **`WorkOffline: True`** for the same queues. Any health check built on `Get-Printer` alone would show a disconnected printer as healthy.

These signals are available through the generic spooler, from most to least reliable:

1. **Queue level:** `Win32_Printer.WorkOffline`, `PrinterStatus`, `DetectedErrorState` (4 = no paper, 8 = jammed, 9 = offline). Confirmed working for USB disconnect. Paper-out depends on the driver and still needs a hardware test.
2. **Job level:** the job status flags in `Win32_PrintJob` / `Get-PrintJob` (Error, Offline, PaperOut, UserIntervention, Blocked). Many inkjet drivers raise paper-out only here, while a job is printing.
3. **Fallback timeout:** a job that hasn't finished within a set time is treated as a printer problem. This catches drivers that report nothing. Inkjets need about 1–2 minutes per 4R sheet at high quality, so the default should be generous (proposed: 4 minutes, adjustable in Settings).

Still to measure on hardware: how quickly signals 1 and 2 show up for USB and for network/IPP printers.

### 2.6 How to send the print: comparison

| Path                                                                         | Any brand, USB + network | Exact paper and printable area                                                                              | Status                                                                                           | Verdict                                                           |
| ---------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Electron `webContents.print({ silent, deviceName, pageSize })`               | Yes                      | No: `pageSize` is a name or a size, with no access to the driver's paper list or margins                    | None: `PrinterInfo` has no status field, and the callback only means the job reached the spooler | Rejected                                                          |
| PDF handed to the spooler (SumatraPDF or similar)                            | Yes                      | Partly                                                                                                      | None                                                                                             | Rejected (adds a bundled third-party exe and still has no status) |
| Vendor SDK or hot folder                                                     | No: one brand each       | Yes                                                                                                         | Good                                                                                             | Rejected (fails decision 4)                                       |
| **.NET `System.Drawing.Printing.PrintDocument` through the Windows spooler** | **Yes**                  | **Yes: chooses the driver's paper size, reads `PrintableArea` and `HardMargin`, sets landscape and copies** | **Through the WMI queue and job queries in 2.5**                                                 | **Recommended**                                                   |

**Spike result (scratch only, not committed):** a PowerShell + .NET `PrintDocument` script silently printed one landscape 4×6 page to Microsoft Print to PDF, with no dialog. The PDF page box is **432×288 pt = 6×4 in**, and `DocumentName` was set to a job key the spooler can find later. PowerShell 5.1 and System.Drawing ship with every Windows 10/11 install, so nothing extra has to be bundled.

**What this gives up compared with vendor SDKs:** ribbon or ink levels, exact prints-remaining counts, and reliable paper-out on some drivers. The timeout fallback (2.5, signal 3) covers the indicator. The counts are lost.

## 3. Where the 1:3-only assumption lives

**This corrects what I told you earlier.** I said the pipeline enforces 1:3. It doesn't. `ImagePipeline` builds its canvas from the **Frame PNG's own pixel size**, and Frame import (`normalizeFramePng`) accepts any shape. The 1:3 constants are legacy or unused. What's left:

| Place                                                                                           | What assumes 1:3                                                                                                        | Change needed                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `image/strip-export-config.ts`                                                                  | `PRODUCTION_STRIP_EXPORT` 1200×3600 + `hasExactProductionStripAspect` (unused); output check requires `density === 600` | Rename to Frame export settings. Keep sRGB, 4:4:4 and 600 DPI metadata (harmless for 3:2), and remove the unused size and aspect helpers |
| `image/image-validation.ts`                                                                     | `CANONICAL_FRAME_WIDTH/HEIGHT/ASPECT` (exported, unused)                                                                | Delete                                                                                                                                   |
| `frame/frame-service.ts:14`                                                                     | `SUPPORTED_FRAME_ASPECT = 1/3`, documented as used only to detect legacy shipped Frames                                 | Keep, renamed for that purpose                                                                                                           |
| `renderer/styles.css` `.frame-stage`                                                            | `aspect-ratio: 1 / 3` fallback (overridden inline by `FrameEditor.tsx:405`)                                             | Drop the fallback, then visually check that a landscape Frame fits the editor canvas                                                     |
| `renderer/styles.css` `.attract-strip`                                                          | `aspect-ratio: 1 / 2` (attract-screen decoration)                                                                       | Check with a landscape active Frame                                                                                                      |
| `renderer/styles.css` `.final-keepsake .final-result` `max-height: 520px`, `Photostrip` collage | Written for tall images; use the Frame's aspect                                                                         | Visual check on the final, review and QR screens with a 3:2 Frame                                                                        |
| Second display (`QrStationScreen`)                                                              | Result layout sized for a tall photo                                                                                    | Visual check and layout fix if needed                                                                                                    |
| `gallery/recent-gallery-service.ts`                                                             | `PREVIEW_LONG_EDGE = 3600` (long-edge based, fine for both shapes)                                                      | None; also add the print queue and reprint (section 5)                                                                                   |
| `apps/public/src/styles.css`                                                                    | `.photo-card--loading` 360 px tall and `.skeleton-photo` 160 px wide: a tall skeleton                                   | Use a skeleton that fits both shapes, or one sized from the photo's aspect                                                               |
| `renderer/local-fixtures.ts`, `visual-fixtures.ts`, `native-self-test.ts`                       | Every fixture is 1200×3600                                                                                              | Add a 3:2 fixture Frame and run the self-test on both shapes                                                                             |
| Playwright visual snapshots                                                                     | Only 1:3                                                                                                                | Add landscape 4R snapshots for review, final, second display, Recent photos and the guest page                                           |

Nothing in the database schema needs to change for Frame shape: `frames.width` and `frames.height` already store it.

**A Frame counts as printable** when `width / height` is within ±0.5% of 3:2. It's worked out from the stored size, with no new flag. When an operator imports a 3:2 Frame smaller than 1800×1200, the Frame Editor shows a warning (it would print soft).

## 4. Laying out the print: one conflict you need to decide

The rule "even border on all four sides" and the rule "print the whole 3:2 Frame unchanged" can't both hold on 3:2 paper with a margin. With an even border _b_, the image area is (6 − 2b) × (4 − 2b), which is never 3:2 unless _b_ = 0.

Worked example on the L3210 (largest margin 0.195"):

| Option                                                          | Top/bottom border | Left/right border | Frame artwork                                                                      |
| --------------------------------------------------------------- | ----------------- | ----------------- | ---------------------------------------------------------------------------------- |
| **A. Fit whole Frame, centered** (recommended)                  | 4.9 mm            | 7.4 mm            | Untouched                                                                          |
| B. Even border, scale to fill and crop the left and right edges | 4.9 mm            | 4.9 mm            | About 3.5% cropped from the left and right edges (the safe zone has to cover this) |

On the L110 (0.117" margins) option A gives 3.0 mm top/bottom and 4.4 mm left/right.

**Decided (2026-11-13): option A.** The whole Frame is scaled to fit inside the printable area and centered. Nothing is ever cropped, and the side borders end up a little wider than the top and bottom. The border on each axis is centered using the largest margin the driver reports, so the asymmetric v4 margin never shows as a lopsided border.

Because nothing is cropped, the 4R safe zone in the Frame Editor is a fixed 1 mm inset, as a guard against small positioning errors in the printer.

## 5. Design

### 5.1 Modules

```
main/print/
  printer-adapter.ts          interface PrinterAdapter
  windows-spooler-adapter.ts  long-lived PowerShell helper, JSON lines over stdio
  print-helper.ps1            .NET PrintDocument + WMI queries (bundled resource)
  mock-printer-adapter.ts     scriptable: ready/offline/paper_out/slow/recover, writes PNGs to a folder
  print-renderer.ts           sharp: Frame composite -> print bitmap at printer DPI, ICC conversion
  print-queue.ts              same pattern as cloud/upload-queue.ts (lease, tick, recover)
  printer-health.ts           one signal used by health service, indicators and self-test
```

`PrinterAdapter`:

```ts
listPrinters(): Promise<PrinterSummary[]>;               // name, driver, port, isNetwork
getCapabilities(name): Promise<PrinterCapabilities>;      // 4x6 candidates, printable area, dpi
getStatus(name): Promise<PrinterStatus>;                  // ready | offline | paper_out | error | unknown
submit(doc: { name; documentKey; bitmapPath; paper; landscape }): Promise<{ spoolerJobId }>;
findJob(name, documentKey): Promise<SpoolerJob | null>;   // looked up by DocumentName
cancel(name, documentKey): Promise<void>;
```

The adapter is chosen in settings (`printerAdapter: 'windows' | 'mock'`), like `cameraAdapter`. A long-lived helper process avoids the roughly 1-second PowerShell start-up on every status check. It runs with `-ExecutionPolicy Bypass` for that one process only, so no system setting changes.

### 5.2 Data

New table `print_jobs`, **one row per physical copy**, grouped by `request_id`. One copy per spooler document means a crash or paper-out after copy 2 of 5 leaves an exact count, and each remaining copy can be cancelled on its own.

| Column                                                                                 | Notes                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `request_id`, `copy_index`                                                       | `document_key = GraceBooth-<id>` is set as the spooler DocumentName                                                                                      |
| `session_id`, `source_asset_id`                                                        | The session's composite asset                                                                                                                            |
| `kind`                                                                                 | `session` or `reprint`                                                                                                                                   |
| `print_asset_path`                                                                     | Print bitmap rendered **when the job is queued** and stored encrypted in the vault, so a later Frame edit or retention cleanup can't change or delete it |
| `printer_name`, `paper_raw_kind`, `paper_name`                                         | Copied from Settings at queue time                                                                                                                       |
| `state`                                                                                | `queued`, `submitting`, `spooled`, `printed`, `needs_attention`, `failed`, `cancelled`                                                                   |
| `spooler_job_id`, `submitted_at`, `printed_at`, `cancelled_at`                         |                                                                                                                                                          |
| `lease_owner`, `lease_until`, `attempt_count`, `last_error_code`, `last_error_message` | Same as `upload_jobs`                                                                                                                                    |

Settings gain: `printer_adapter`, `printer_name`, `paper_raw_kind`, `paper_name`, `print_timeout_seconds`, `icc_profile_ref` (an optional encrypted file stored like Frames). The retention service skips any asset with a print job that hasn't reached `printed`, `failed` or `cancelled`. The audit log gains `print_submit`, `print_cancel` and `reprint`.

### 5.3 Print job states and recovery

```
queued -> submitting -> spooled -> printed
              |            |
              |            +-> needs_attention   (timeout, or job error flag)
              +-> needs_attention                (crash; spooler has no record)
queued | needs_attention -> cancelled            (operator)
needs_attention -> queued                        (operator "Print again")
needs_attention -> printed                       (operator "It printed")
```

- **Printer unavailable:** jobs stay `queued`. The queue checks the printer every few seconds and submits only while status is `ready`. That's the "prints when it comes back" behavior.
- **Recovery after a crash or power loss:** for each `submitting` or `spooled` job, look up its `document_key` in the spooler queue.
  - Found: adopt the spooler job and keep watching it. The spooler keeps its jobs across a reboot.
  - `spooled` and not found: the spooler finished it, so mark `printed`.
  - `submitting` and not found: the app can't know whether it reached the printer, so mark **`needs_attention`**. The operator chooses Print again or It printed. This is the only way to guarantee no double print without vendor job history.
- **Decided (2026-11-13): the Windows `PrintService/Operational` event log stays off.** The app never changes this machine-wide setting. An uncertain `submitting` job is settled by the operator in the print queue panel.

### 5.4 Session flow

The print queue has its own states, like `upload_jobs`, instead of new session states, so printing and QR delivery never wait on each other. The session flow changes in one place:

- **Review screen** (4R Frames only): a **Print** switch (off) and a copy stepper (1). If the operator switches to a 1:3 Frame during review, the controls disappear and printing is turned off. `acceptPhotos(frameId, print: { copies } | null)` locks the choice into `sessions.print_copies`.
- **Proceed:** with Print on, if the printer isn't `ready` when the operator taps Accept, the review screen shows the printer indicator and **Proceed**. Proceed accepts the photos and queues the print; the session continues to processing and QR as normal. Printers that are `ready` skip this step.
- After processing, the queue renders the print bitmap and creates one row per copy.

`session-state-machine.ts` needs no new states. Its tests gain coverage for the print payload on `accept_photos`.

### 5.5 Operator surfaces

- **Indicator:** one `PrinterHealth` signal (`ready`, `offline`, `paper_out`, `error`, `unknown`, plus a queued count), shown as a status pill on the operator screens and the guest-facing display (main kiosk screen and second display), and in Admin health. Guests see only the message, never controls.
- **Print queue panel** (in Recent photos): waiting and needs-attention jobs with Cancel, Print again and It printed.
- **Reprint:** in the Recent photos detail dialog, for 4R photos only, with a copy count. It goes through the same queue and writes an audit entry.
- **Settings > Printer:** pick the printer, the 4×6 paper candidate (pre-selected by size), timeout and ICC profile; plus **Print calibration chart** and **Print color test** buttons.

### 5.6 Color (mid)

- Default: composite stays sRGB and the driver handles color.
- With an ICC profile set: `print-renderer` converts sRGB to that profile with sharp (`withIccProfile`). **The operator must turn off color adjustment in the driver**, or color gets converted twice. Settings shows this note next to the profile picker.
- **Color test page:** sRGB patches, a gray ramp and a skin-tone strip, printed with and without the profile and compared with the same page on screen.

### 5.7 Health and self-test

`HealthService` adds `printer`. `native:self-test` starts the print helper, lists printers, checks the chosen printer's capabilities, renders a 3:2 test Frame, and prints one page to Microsoft Print to PDF, checking that the PDF page box is 432×288 pt.

## 6. Tests

- **Unit:** paper matching by size across the three naming variants above; option A fit-and-center math against the L3210/L110 margins (artwork never cropped, each axis centered); ICC path; the print-job state transitions in 5.3.
- **Recovery:** kill the process at each state (`submitting`, `spooled`) with the mock adapter; assert there are no duplicate submits and that `needs_attention` appears when it should.
- **E2E (Playwright + mock printer):** a 4R session with print off, then on with 3 copies, a printer offline at Accept, then Proceed, then the printer recovering, and the job printing once; cancel from the queue; reprint from Recent photos; a 1:3 session and switching Frames during review never offer printing.
- **`verify-photobooth`:** screenshots of review (with print controls), the indicator on both displays, the queue panel, the reprint dialog and Settings > Printer; regenerate snapshots wherever the shape changed.

## 7. Acceptance on hardware (confirmed list) — not yet run

| Check                                                                                                                               | Needs                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Calibration chart on real 4R paper, landscape, ruler-measured (size, whole Frame visible, borders centered on each axis, safe zone) | A USB printer **and** a network printer, from **two brands** |
| Color test page with and without ICC, compared with the screen                                                                      | One printer + its ICC profile                                |
| Printer's own counter matches after kill-mid-print, power loss, multi-copy, reprint, cancel                                         | Each test printer                                            |
| Unplug / paper-out shows indicator on both screens; Proceed keeps QR; queued job prints once on return unless cancelled             | Each test printer                                            |
| 1:3 Frame sessions unchanged and never offer printing                                                                               | Software only                                                |
| Unit, state-machine and e2e tests with the fake printer, plus `verify-photobooth` screenshots                                       | Software only                                                |

Hardware available today: two Epson USB printers (one brand, not plugged in) and no network printer.

## 8. Decisions needed before implementation

1. ~~Print layout~~: decided, option A (whole Frame, centered, never cropped).
2. ~~Windows PrintService event log~~: decided, stays off; the operator settles uncertain jobs.
3. **Test hardware:** which network printer and second brand will be used for the acceptance tests in section 7.

## 9. As built: differences from the plan

- **No stored print bitmap.** A copy points at the session's finished photo (`source_asset_id`).
  The print page is rendered from it just before submission, written to `print-staging/`, handed
  to the spooler and deleted right away. Retention cleanup skips any session with an unfinished
  copy, so the photo can't disappear under a waiting job.
- **No leases on `print_jobs`.** The queue runs in one process and sends one copy at a time, so
  the `submitting` state alone is enough for crash recovery.
- **Session copies wait for the photo.** Accepting with printing on creates the copies as
  `waiting_for_photo`. Saving the finished photo moves them to `queued`; start-up recovery does
  the same if the app stopped in between.
- **A copy stuck at the printer is not reprinted.** When a copy stays in the Windows queue past
  the timeout, the indicator turns into a printer problem and the copy keeps waiting; it never
  goes to `needs_attention`. Only a crash during submission does.
- **Status refresh:** every 3 s (250 ms in e2e mode), plus right after any request, cancel or
  settings change.
- **Copy guard:** one request accepts 1–999 copies. There is no product limit; the cap only
  stops a mistyped number from creating thousands of rows.
- **Native self-test:** the printer check (section 5.7) is not built. It would fail on machines
  with no Microsoft Print to PDF queue, so it needs its own opt-in flag first.
- **E2e hooks:** in e2e mode only, the fake printer and a helper that adds a landscape 4R Frame are
  exposed on `globalThis.__graceBoothE2e` for Playwright. Packaged builds refuse e2e mode.
- **First real printer (Epson L805 over Wi-Fi, generic ESC/P-R V4 class driver).** It printed
  through the app's code path. When it stopped (likely paper or a jam), Windows reported only
  `PrinterStatus 1` / `DetectedErrorState 1` ("Other"), and the job showed `Error`. The helper now
  treats "Other" and "Stopped printing" as a printer problem, so the indicator shows even when no
  copy is waiting.

### Where the code lives

| Area                 | Files                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Shared types and IPC | `packages/shared/src/print.ts`, `packages/shared/src/ipc.ts`                                                               |
| Database             | `apps/kiosk/migrations/0011_printing.sql`, `apps/kiosk/src/main/database/print-repository.ts`                              |
| Printing             | `apps/kiosk/src/main/print/*`, `apps/kiosk/resources/print/print-helper.ps1`                                               |
| IPC                  | `apps/kiosk/src/main/ipc/print-ipc.ts`                                                                                     |
| UI                   | `ReviewScreen.tsx`, `components/Printing.tsx`, `admin/PrinterSettingsCard.tsx`, `RecentGallery.tsx`, `QrStationScreen.tsx` |
| Tests                | `tests/main/print.test.ts`, `tests/renderer/Printing.test.tsx`, print tests in `tests/e2e/kiosk-electron.spec.ts`          |
