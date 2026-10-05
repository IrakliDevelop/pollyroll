---
name: pollyroll-webgl
description: Rules for Pollyroll's custom WebGL2 renderer (src/render/, src/skins/): GGX PBR shading, GLSL ES 3.00 pitfalls, procedural patterns, glass, instancing, glyph atlas, resource lifetime, context loss, and shader debugging. Use when writing or reviewing shaders or renderer code.
---

# Pollyroll WebGL2 renderer

PBR section adapted from forge-gpu `pbr-shading` (Zlib, Rosy Game Studio); see
[../THIRD_PARTY.md](../THIRD_PARTY.md). Ported from HLSL to GLSL ES 3.00 and altered for Pollyroll.

## Shading (Cook–Torrance, metallic-roughness)

```glsl
float a = roughness * roughness;            // alpha = roughness², not roughness
float a2 = a * a;
float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
float D = a2 / (PI * d * d);                 // GGX normal distribution
float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;   // direct light; IBL uses r²/2
float G = (NdotV / (NdotV * (1.0 - k) + k)) * (NdotL / (NdotL * (1.0 - k) + k));
vec3 F0 = mix(vec3(0.04), albedo, metallic); // metals take F0 from albedo
vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
vec3 spec = D * G * F / (4.0 * max(NdotV, 0.001) * max(NdotL, 0.001));
vec3 diffuse = (1.0 - F) * (1.0 - metallic) * albedo / PI;
```

- Clamp `NdotV` and `NdotL` away from zero in the denominator.
- Clearcoat is a second GGX lobe with fixed F0 0.04 and its own roughness, layered over the base.
- Environment is analytic (sky/ground gradient sampled along the reflection vector, blurred by
  mixing toward the hemisphere average as roughness rises). No cubemaps, no textures.

## Glass

Draw back faces first, then front faces with alpha from Fresnel (`mix(0.15, 1.0, F)`), refraction
tint from the environment along `refract(-V, N, 1.0/1.5)`. Depth write off for the back-face pass.

## GLSL ES 3.00 pitfalls

- `#version 300 es` must be the first line; declare `precision highp float;` in fragment shaders.
- Strict types: `vec3 x = vec3(1.0)`, `1.0` not `1` for floats; no implicit int→float.
- Reserved words that are illegal identifiers: `sample`, `filter`, `input`, `output`, `common`,
  `patch`, `cast`. No ternary on structs.
- Always check `COMPILE_STATUS` and `LINK_STATUS`; on failure throw `PollyrollShaderError` with
  `getShaderInfoLog`. A black canvas almost always means a failed compile or link.

## Procedural patterns

- Patterns are functions of object-space position so they stick to the die while it tumbles.
- Use an integer hash (PCG / `uvec3` based) for noise, not `fract(sin(x) * 43758.5)`: the sin hash
  differs across GPUs and breaks screenshot baselines.
- Custom skin patterns implement `vec3 pattern(vec3 p, vec3 n, vec3 a, vec3 b)`; the renderer
  splices them into a program variant and caches it by source.

## Performance and lifetime

- No allocation in the frame loop: reuse typed arrays for instance data and uniforms.
- One instanced draw per die type; upload instance matrices once per frame with `bufferSubData`.
- The loop stops when every die has settled; `requestAnimationFrame` is not re-armed while idle.
- Cap device pixel ratio at `maxDpr`; resize the drawing buffer only when the size actually changes.
- Every buffer, texture, VAO, program, and listener created by a tray is deleted in `dispose()`.
- Handle `webglcontextlost` (prevent default, stop the loop) and `webglcontextrestored` (rebuild
  all GPU resources from CPU-side caches).

## Debugging

| Symptom                           | First check                                             |
| --------------------------------- | ------------------------------------------------------- |
| Black or empty canvas             | shader info log, link status, viewport size, DPR resize |
| Faceted lighting on rounded edges | normals not normalized after interpolation              |
| Labels mirrored or upside down    | atlas UV orientation, `UNPACK_FLIP_Y_WEBGL`             |
| Wrong number on top               | symmetry remap (physics skill), not the renderer        |

Debug views worth keeping behind an internal flag: normals as `n * 0.5 + 0.5`, atlas UVs as color,
material ID as flat color.
