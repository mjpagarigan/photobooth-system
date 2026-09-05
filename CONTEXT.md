# Photobooth Session and Frame Context

This context defines the language used for configurable photo frames and the guest capture lifecycle.

## Language

**Frame**:
A transparent PNG overlay with its original pixel dimensions and an ordered collection of photo slots.
_Avoid_: Strip, template

**Visible frame**:
A frame available in the Frame Editor library and eligible for the guest review chooser.
_Avoid_: Active frame, undeleted frame

**Archived frame**:
A frame hidden from the editor and guest chooser while retained for historical session integrity.
_Avoid_: Deleted frame

**Active frame**:
The visible frame explicitly selected for new sessions; editing a frame does not make it active.
_Avoid_: Selected frame, current frame

**Session frame lock**:
The active frame identity and required shot count captured when a guest session starts and held constant for that session.
_Avoid_: Selected frame

**Photo slot**:
A movable, resizable region that places one captured photo beneath the frame artwork.
_Avoid_: Placeholder, crop box

**Shot count**:
The number of photos a session captures, equal to the active frame's number of photo slots and limited to 1–10.
_Avoid_: Capture count, slot count

**Layer order**:
The back-to-front ordering of photo slots beneath the transparent frame artwork.
_Avoid_: Slot number, shot order
