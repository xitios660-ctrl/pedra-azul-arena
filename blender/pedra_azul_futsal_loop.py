# Pedra Azul Arena
# Blender 4.x scene generator for the futsal hero loop.
#
# Run:
#   blender -b -P blender/pedra_azul_futsal_loop.py
#
# Output:
#   frontend/public/assets/video/pedra-azul-blender-loop.mp4
#
# The live website also contains a lightweight real-time Canvas match layer,
# so visitors get motion immediately while this Blender source remains the
# editable high-quality 3D master.

import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT = os.path.join(ROOT, "frontend", "public", "assets", "video", "pedra-azul-blender-loop.mp4")

FPS = 30
SECONDS = 8
END = FPS * SECONDS

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)

def mat(name, color, metallic=0.0, roughness=0.45, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = strength
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = (*emission, 1.0)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = strength
    return m

def cube(name, scale, loc, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        o.data.materials.append(material)
    if bevel:
        bev = o.modifiers.new("Soft edges", "BEVEL")
        bev.width = bevel
        bev.segments = 3
    return o

def uv_sphere(name, radius, loc, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, radius=radius, location=loc)
    o = bpy.context.object
    o.name = name
    if material:
        o.data.materials.append(material)
    return o

def cylinder(name, radius, depth, loc, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=depth, location=loc)
    o = bpy.context.object
    o.name = name
    if material:
        o.data.materials.append(material)
    return o

def line_box(name, x, y, z, sx, sy, material):
    return cube(name, (sx, sy, 0.018), (x, y, z), material)

def create_goal(x, facing=1):
    white = bpy.data.materials["CourtWhite"]
    post = 0.07
    width = 3.0
    height = 2.0
    depth = 0.85
    cylinder("GoalPostL", post, height, (x, -width / 2, height / 2), white)
    cylinder("GoalPostR", post, height, (x, width / 2, height / 2), white)
    top = cylinder("GoalCrossbar", post, width, (x, 0, height), white)
    top.rotation_euler[0] = math.radians(90)
    net = mat("NetGhost" + str(x), (0.55, 0.65, 0.7), roughness=0.8)
    net.diffuse_color = (0.55, 0.65, 0.7, 0.18)
    panel = cube("GoalNet", (depth / 2, width / 2, height / 2), (x + facing * depth / 2, 0, height / 2), net)
    panel.display_type = "WIRE"

def create_player(name, loc, team_mat, accent_mat):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root.location = loc

    torso = cube(name + "_Torso", (0.24, 0.16, 0.42), (0, 0, 1.08), team_mat, bevel=0.1)
    head = uv_sphere(name + "_Head", 0.18, (0, 0, 1.68), bpy.data.materials["Skin"])
    leg_l = cylinder(name + "_LegL", 0.075, 0.66, (-0.12, 0, 0.48), accent_mat)
    leg_r = cylinder(name + "_LegR", 0.075, 0.66, (0.12, 0, 0.48), accent_mat)
    arm_l = cylinder(name + "_ArmL", 0.06, 0.62, (-0.36, 0, 1.12), bpy.data.materials["Skin"])
    arm_r = cylinder(name + "_ArmR", 0.06, 0.62, (0.36, 0, 1.12), bpy.data.materials["Skin"])
    arm_l.rotation_euler[1] = math.radians(18)
    arm_r.rotation_euler[1] = math.radians(-18)

    for o in (torso, head, leg_l, leg_r, arm_l, arm_r):
        o.parent = root
    return root

def key_loc(o, frame, xyz):
    o.location = xyz
    o.keyframe_insert(data_path="location", frame=frame)

def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

clear_scene()

# Materials
floor = mat("Floor", (0.018, 0.028, 0.038), metallic=0.2, roughness=0.22)
court_blue = mat("CourtBlue", (0.015, 0.11, 0.15), metallic=0.08, roughness=0.28)
white = mat("CourtWhite", (0.88, 0.94, 0.96), roughness=0.32, emission=(0.55, 0.9, 1.0), strength=0.45)
cyan = mat("PedraCyan", (0.0, 0.72, 0.92), metallic=0.12, roughness=0.32, emission=(0.0, 0.55, 0.8), strength=0.22)
dark = mat("PedraDark", (0.012, 0.018, 0.024), metallic=0.15, roughness=0.36)
away = mat("AwayWhite", (0.75, 0.78, 0.8), metallic=0.02, roughness=0.48)
red = mat("AwayAccent", (0.5, 0.025, 0.07), metallic=0.06, roughness=0.38)
skin = mat("Skin", (0.34, 0.18, 0.11), roughness=0.62)
ball_mat = mat("Ball", (0.9, 0.92, 0.9), roughness=0.42)

# Arena shell
cube("ArenaFloor", (22, 12, 0.08), (0, 0, -0.12), floor)
cube("Court", (19.8, 9.8, 0.04), (0, 0, 0.0), court_blue)

# Court lines
line_box("HalfLine", 0, 0, 0.06, 0.035, 9.8, white)
line_box("SideTop", 0, 9.65, 0.06, 19.6, 0.035, white)
line_box("SideBottom", 0, -9.65, 0.06, 19.6, 0.035, white)
line_box("GoalLeft", -19.6, 0, 0.06, 0.035, 9.65, white)
line_box("GoalRight", 19.6, 0, 0.06, 0.035, 9.65, white)

# Center circle
bpy.ops.mesh.primitive_torus_add(major_radius=2.0, minor_radius=0.035, major_segments=96, location=(0, 0, 0.07))
bpy.context.object.data.materials.append(white)

create_goal(-19.55, -1)
create_goal(19.55, 1)

# Dark stands and luminous rails
for side in (-1, 1):
    cube("Stand" + str(side), (21, 2.4, 2.1), (0, side * 12.4, 1.6), dark, bevel=0.25)
    rail = cube("Rail" + str(side), (18.5, 0.035, 0.035), (0, side * 10.8, 4.0), cyan)
    rail.data.materials.clear()
    rail.data.materials.append(cyan)

# Players
home_positions = [(-12, -3.5, 0), (-6, 2.6, 0), (2, -2.3, 0), (9, 2.2, 0)]
away_positions = [(-8, 1.6, 0), (-1, 3.6, 0), (6, -3.2, 0), (13, 0.5, 0)]
homes = [create_player("Home_%d" % i, p, cyan, dark) for i, p in enumerate(home_positions)]
aways = [create_player("Away_%d" % i, p, away, red) for i, p in enumerate(away_positions)]
keeper = create_player("Goalkeeper", (18.0, 0, 0), red, dark)

# Loopable motion paths
frames = [1, 61, 121, 181, END + 1]
home_keys = [
    [(-12,-3.5,0), (-10,-1.5,0), (-7,1.8,0), (-5,-2.8,0), (-12,-3.5,0)],
    [(-6,2.6,0), (-3,3.1,0), (0,1.1,0), (2,3.0,0), (-6,2.6,0)],
    [(2,-2.3,0), (5,-3.0,0), (8,-0.6,0), (10,-2.0,0), (2,-2.3,0)],
    [(9,2.2,0), (11,1.0,0), (13,2.1,0), (14,0.3,0), (9,2.2,0)],
]
away_keys = [
    [(-8,1.6,0), (-7,-0.6,0), (-5,2.2,0), (-9,2.8,0), (-8,1.6,0)],
    [(-1,3.6,0), (1,2.2,0), (4,3.4,0), (2,1.6,0), (-1,3.6,0)],
    [(6,-3.2,0), (7,-1.3,0), (10,-3.0,0), (8,-0.2,0), (6,-3.2,0)],
    [(13,0.5,0), (14,2.5,0), (15,-0.8,0), (12,-2.0,0), (13,0.5,0)],
]
for o, keys in zip(homes, home_keys):
    for f, p in zip(frames, keys):
        key_loc(o, f, p)
for o, keys in zip(aways, away_keys):
    for f, p in zip(frames, keys):
        key_loc(o, f, p)

for f, p in zip(frames, [(18,0,0), (17.7,0.6,0), (18,-0.4,0), (17.5,-0.9,0), (18,0,0)]):
    key_loc(keeper, f, p)

# Ball sequence: control, pass, pass, shot, return for loop
ball = uv_sphere("FutsalBall", 0.23, (-11.2, -3.4, 0.28), ball_mat)
ball_points = [
    (1, (-11.2,-3.4,0.28)),
    (48, (-5.4,2.4,0.48)),
    (92, (2.4,-2.0,0.36)),
    (142, (9.5,2.1,0.38)),
    (182, (19.1,0.3,1.05)),
    (END + 1, (-11.2,-3.4,0.28)),
]
for f, p in ball_points:
    key_loc(ball, f, p)
for curve in [fc for fc in ball.animation_data.action.fcurves]:
    for kp in curve.keyframe_points:
        kp.interpolation = "BEZIER"

# Lighting
world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.007, 0.012, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.16

for x, y in [(-12,-7), (-4,7), (5,-7), (13,7)]:
    bpy.ops.object.light_add(type="AREA", location=(x, y, 9.5))
    l = bpy.context.object
    l.data.energy = 1150
    l.data.shape = "DISK"
    l.data.size = 5.0
    l.data.color = (0.62, 0.86, 1.0)
    look_at(l, (x * 0.35, y * 0.35, 0))

for x in (-14, 0, 14):
    bpy.ops.object.light_add(type="SPOT", location=(x, 0, 11))
    l = bpy.context.object
    l.data.energy = 1350
    l.data.color = (0.0, 0.62, 1.0)
    l.data.spot_size = math.radians(48)
    l.data.spot_blend = 0.55
    look_at(l, (x * 0.25, 0, 0))

# Camera
bpy.ops.object.camera_add(location=(26.5, -28.0, 15.0))
cam = bpy.context.object
cam.data.lens = 38
cam.data.sensor_width = 36
look_at(cam, (2.5, 0, 1.0))
bpy.context.scene.camera = cam
key_loc(cam, 1, (26.5, -28.0, 15.0))
key_loc(cam, END // 2, (25.2, -27.0, 15.7))
key_loc(cam, END + 1, (26.5, -28.0, 15.0))
for fc in cam.animation_data.action.fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = "SINE"

# Render
scene = bpy.context.scene
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except Exception:
    scene.render.engine = "BLENDER_EEVEE"

scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = END
scene.render.image_settings.file_format = "FFMPEG"
scene.render.ffmpeg.format = "MPEG4"
scene.render.ffmpeg.codec = "H264"
scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
scene.render.ffmpeg.ffmpeg_preset = "GOOD"
scene.render.filepath = OUTPUT

scene.view_settings.look = "AgX - Medium High Contrast"
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

print("Rendering Pedra Azul futsal loop to:", OUTPUT)
bpy.ops.render.render(animation=True)
print("Done:", OUTPUT)
