# Ticket — Infinite dynamic frames

Label: wayfinder:task (fix 2)
Status: implemented and verified

## Question

How do hardcoded 2-frame options become an unbounded, operator-managed frame library that flows automatically into Review selection?

## Decision

Frames use the existing ordered, array-backed library and CRUD IPC, keyed by frame id. Import accepts transparent PNGs at their original aspect ratio and dimensions within 50 MB, 80 megapixels, and 12,000 px per edge. An Add frame dialog confirms detected dimensions/aspect ratio, name, and a 1–10 shot count, then creates an orientation-aware starter grid. Slots remain independently movable and resizable from 0.1%–100%, stay within frame bounds, and support Bring forward and Send to back beneath the PNG artwork.

The active frame is changed only by an explicit **Use for new sessions** action. Its slot count determines the next session's shot count. Session start locks the frame and shot count; review shows only visible frames with the same slot count. Archiving a frame hides it from editor and review. Archiving the active frame activates the next visible library item, falling back to the previous item, and the final visible frame is protected. Increasing Shots / slots preserves existing slots and adds balanced generated slots; decreasing confirms and removes the highest-numbered slots first.

## Key facts from recon

- Hardcoded today: `frame-service.ts` tuple `[option1, option2]`, packaged PNGs wired at `index.ts:136-144`, `FrameLayoutSchema.length(3)` + zod tuple at `domain.ts:65-77/144`, `getFrameOptions(): [StoredFrame|null, StoredFrame|null]`.
- Upload path: IPC `admin:choose-frame` → native dialog → `importFrameForOption(optionIndex, …)` (`register-ipc.ts:163-183`).
- Compositing: `processCollage` uses selected frame PNG + slots (`booth-workflow.ts:343-368`) — must become frameId-driven.
- Review keyboard selection currently 2-option Space/Enter (`ReviewScreen.tsx:45-50`).

## Resolved follow-up decisions

- “Delete” is an immediate archive/hide operation, preserving historical references.
- Arbitrary aspect ratios are supported without normalizing to 1200×3600.
- Shot count is 1–10 and derives from the active frame.
- Layer actions are limited to one-step Bring forward and extreme Send to back.
- The editor contains every frame aspect ratio within the available viewer without cropping or stretching. Layer controls sit above Position & scale and remain present for one-slot frames, where they report the already-front/back boundary.

## Compatibility fixes verified

- Review cards and the All frame layouts picker now contain each frame inside the available preview area using its saved width/height ratio. The old fixed 1:3 preview viewport no longer crops, compresses, or stretches landscape and square artwork.
- Landscape frames receive a landscape review-card footprint instead of being centered inside the legacy portrait card. Finished-photo and QR-station previews now use the image's intrinsic ratio, occupy the available result pane, and have no white portrait backing surface.
- The image-worker boundary now accepts safe processed output at the selected frame's aspect ratio instead of requiring the legacy 1200×3600 result. It still rejects empty payloads, mismatched ratios, dimensions above 12,000 px per edge, and outputs above 80 megapixels.
- Worker capture messages use a dynamic array, so the 1–10 session shot-count contract reaches the image pipeline without a hidden three-capture type assumption.
- Regression coverage exercises a 1920×1080 one-slot review preview in both chooser surfaces and validates a 1920×1080 worker result before the workflow queues it for cloud upload.
- The linked `create-upload` Edge Function was found running obsolete 2,400 px minimum-long-edge and 6,000 px maximum-edge validation. It was deployed from the verified local source and re-downloaded to confirm the live function now has no minimum edge and uses the 12,000 px limit.
- Follow-up: the live database still held the old dimension and Google-Forms-only constraints. Applied the recruitment URL migration and an original-size dimension migration allowing 1–12,000 px per edge within 80 megapixels. Verified accepted and rejected inputs against live constraints in a temporary table, plus the create-upload database RPC inside a rolled-back transaction. No guest records are changed by the probe at `supabase/tests/frame_delivery_constraints_probe.sql`.
