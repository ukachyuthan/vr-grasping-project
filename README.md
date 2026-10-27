# Grasp Demonstrator

A Quest 3 WebXR app for showing an RL grasping policy the grasps it keeps getting
wrong. During training, [unitree-grasping](../unitree-grasping) queues every failed
grasp, replays it at random points later in training, and sets aside the ones that
still fail after 4 replays. This app loads those cases onto a
virtual table in your room. You pick up the object with your own hands, and the
app records how you did it.

```
train_grasp_pose.py ──► FailureCurator ──► data/vr_failures/<run>/cases/*.json
  (failure → replay queue → 4 failed replays)      │
                                                   ▼
                     Quest 3 ◄── this app (Vite dev server + /api)
                        │
          grasp + lift with hands
                        ▼
      data/vr_failures/<run>/demos/<case>/*.json ──► scripts/load_vr_demos.py
```

Built on vanilla Three.js and the raw WebXR API, following `mixed_vr_car_routing`.

## Running it

```bash
npm install
npm run dev
```

The dev server serves both the app and the cases, from two places. The menu's
**SOURCE** button switches between them:

- **TRAINING**: every run in `../unitree-grasping/data/vr_failures/` (override with
  `VR_DATASET_DIR=...`). If training runs on another machine, rsync the run folder
  over; each run folder is self-contained, meshes included.
- **One entry per folder in [sample-events/](sample-events/)** (override with
  `VR_SAMPLE_EVENTS_DIR=...`). Use these as fixed test scenarios.

The app opens on TRAINING when it has cases, otherwise on the first sample set.
The terminal prints both paths.

## Sample events

`sample-events/example/` has five scenarios for testing without a training run.
Each is a different way a two-finger grasp goes wrong:

| Scenario | How the robot failed |
| --- | --- |
| `torus` | Pinched across the hole, so both fingers closed on air. |
| `block` | Jaws set along the long axis, wider than the gripper opens. |
| `cylinder` | Lying on its side; both contacts on the curved top, nothing to squeeze against. |
| `bracket` | Aimed at the empty inside corner of the L. |
| `wedge` | Pinched near the apex, so the slopes squeeze it out. |

Each folder in `sample-events/` has the same layout as one training run folder
(`manifest.json`, `cases/`, `objects/`). To keep an interesting training run as
a scenario set, copy its folder in under any name. It shows up on the next
SOURCE press, no restart needed.

```bash
cp -r ../unitree-grasping/data/vr_failures/grasp_pose_envs64_20260921_101500 sample-events/hard_torus
```

Demos you record against a sample set are saved inside it (`<folder>/demos/`,
git-ignored), so `scripts/load_vr_demos.py --dataset sample-events` reads them.
Regenerate `example` with `npm run sample-events`.

**On the Quest 3**, WebXR needs a secure context. Use either:

- **LAN:** open the printed `https://<your-ip>:5173` in the Meta Quest Browser and
  accept the self-signed certificate (Advanced → Proceed).
- **USB:** run `adb reverse tcp:5173 tcp:5173` and open `https://localhost:5173`.

Hand tracking must be on: Settings → Movement Tracking → Hand and Body Tracking.

In a desktop browser the page is a preview. Drag to orbit, S switches source,
N/P switch cases, G toggles the robot's attempts, R resets, and X marks the case
impossible.

## Impossible cases

Some cases can't be done by any two-finger gripper from that pose: too thin to
pinch off the table, or wider than the jaws on every side. Press **IMPOSSIBLE**
on those instead of recording a demo. It saves `<run>/verdicts/<case_id>.json`;
press again to undo. Training leaves these cases out of its metrics and never
exports the same object at the same heading (shape + yaw bin) again.

## Held-out cases

If a run has a `split.json` (unitree-grasping `scripts/split_failure_cases.py`),
the cases it lists as `heldout` are hidden here. They are kept free of demos so
training can be tested on failures nobody demonstrated.

```bash
npm test          # grasp logic, demo recording, dataset API
npm run typecheck
npm run build
```

## Using it

Press **Enter AR**. The table appears about 50 cm below your eyes, with the object
where the robot saw it. You stand where the robot's base is. Red dot pairs joined
by a line are the robot's failed attempts (the original failure plus the 4 failed
replays that got the case exported, the latest brightest), and the green slab marks the lift height to reach.

1. Grasp the object with your **thumb and a finger on opposite sides**.
   - Grasping turns the object blue and your hand's joints green.
   - Fingers touching without a grasp turn it yellow.
   - Two fingers resting on the same face don't grasp.
2. Lift it through the green slab (5 cm by default) and hold for half a second.
3. The object turns green. About a second later the demo saves and the menu
   shows `SAVED ✓`.

Poke the menu, beside the table's left edge, with your index finger.
The hand that's holding the object can't press buttons.

| Button | What it does |
| --- | --- |
| `SOURCE: …` | Switch between TRAINING and each `sample-events/` folder. |
| `◀ PREV` / `NEXT ▶` | Switch case within the source. Newest runs come first. |
| `RETRY` | Put the object back and start a new take. Every successful take is saved. |
| `ROBOT` | Show/hide the robot's failed contact points. |
| `RECENTER` | Re-place the table in front of where you're looking now. |

If you release the object it drops straight down onto the table. If it falls off
the table it respawns.

## What gets saved

One JSON per successful take, at `<run folder>/demos/<case_id>/<timestamp>.json`
in whichever source the case came from:

- `grasp.c1_local` / `grasp.c2_local`: thumb and opposing-finger contact points at
  the moment of grasp, in the **scaled object-local frame**. This is the same frame
  and meaning as the env's `contact_left_local` / `contact_right_local`, so a demo
  is directly a target for the two-point action head.
- `grasp.mode`: `opposed` (contact normals face each other) or `pinch` (thumb–index
  pinch at the surface, with no normal check). Filter on it if pinch grasps look
  unphysical for the gripper.
- `frames`: at 30 Hz, the object pose, whether it's held, and all 25 joints of
  each tracked hand plus wrist orientation.
- `events`: grasp / release / success / dropped, with timestamps.

All poses are in the robot-base frame: z-up, metres, quaternions as wxyz.
The schemas live in [src/data/types.ts](src/data/types.ts).

## How it fits together

```
server/dataset.ts       Vite middleware: /api/sources/<source>/{cases,files,demos}
src/sim/frames.ts       sim (z-up, robot base) ↔ three.js room placement
src/sim/objectModel.ts  OBJ (or point-cloud hull) + surface samples for contact queries
src/sim/grasp.ts        grasp detection, carrying (welded to the wrist), drop to table
src/sim/demo.ts         lift success rule and recording
src/xr/hands.ts         raw XRHand joint poses, including wrist orientation
src/app.ts              wires it together; src/ui/panel.ts is the poke menu
```

Every task object is parented to one "task root" whose matrix maps sim
coordinates into the room. Hand joints go through `taskRoot.worldToLocal()`, so
everything recorded is already in the training code's frame.

## Limits

- **No contact physics.** A grasp welds the object to your wrist, like the sim's
  grasp lock. It doesn't check whether a real gripper could hold that grip.
- **Shapes without an OBJ** fall back to the convex hull of the point cloud
  (the menu shows `HULL`), which fills in hollows: a torus becomes a disc.
- The **mesh and point cloud must share a frame.** The ghost point cloud is drawn
  over the object so a mismatch is visible at a glance.
- A released object falls straight down and doesn't tip over.
