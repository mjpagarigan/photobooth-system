# Ticket — Infinite dynamic frames

Label: wayfinder:task (fix 2)
Status: open

## Question

How do hardcoded 2-frame options become an unbounded, operator-managed frame library that flows automatically into Review selection?

## Decision

Frames become an ordered, array-backed store (drizzle migration in `apps/kiosk`, following existing migration patterns) replacing the fixed tuple. New CRUD IPC: list / add (upload PNG) / update layout / delete / reorder, keyed by frame id instead of `optionIndex(0|1)`. Existing mat + anniversary frames seeded as the first two entries so nothing regresses. FrameEditor becomes a list-based editor (add, rename, slot editing via existing react-rnd flow, delete, reorder). ReviewScreen renders one preview per stored frame with arrow-key navigation and Enter to select — new uploads appear there automatically with no code change per frame. Constraints preserved: transparent PNG import validation, 1:3 strip aspect, exactly 3 slots per frame, PHOTO_COUNT stays 3.

## Key facts from recon

- Hardcoded today: `frame-service.ts` tuple `[option1, option2]`, packaged PNGs wired at `index.ts:136-144`, `FrameLayoutSchema.length(3)` + zod tuple at `domain.ts:65-77/144`, `getFrameOptions(): [StoredFrame|null, StoredFrame|null]`.
- Upload path: IPC `admin:choose-frame` → native dialog → `importFrameForOption(optionIndex, …)` (`register-ipc.ts:163-183`).
- Compositing: `processCollage` uses selected frame PNG + slots (`booth-workflow.ts:343-368`) — must become frameId-driven.
- Review keyboard selection currently 2-option Space/Enter (`ReviewScreen.tsx:45-50`).

## Not yet resolved (fog)

- Deletion policy for frames referenced by archived sessions.
