import { vec3 } from "./vec3.js";

export function createAABB(min, max) {
    // two points as extrema for bounding box
    return {
        min: vec3.fromValues(
            Math.min(min[0], max[0]),
            Math.min(min[1], max[1]),
            Math.min(min[2], max[2]),
        ),
        max: vec3.fromValues(
            Math.max(min[0], max[0]),
            Math.max(min[1], max[1]),
            Math.max(min[2], max[2]),
        ),
    };
}

export function sphereAABB(center, radius) {
    const c = center;
    const r = radius;

    return createAABB(
        vec3.fromValues(c[0] - r, c[1] - r, c[2] - r),
        vec3.fromValues(c[0] + r, c[1] + r, c[2] + r),
    )
}

export function surroundingAABB(a, b) {
    // create larger bbox from 2 bbox
    return createAABB(
        vec3.fromValues(
            Math.min(a.min[0], b.min[0]),
            Math.min(a.min[1], b.min[1]),
            Math.min(a.min[2], b.min[2]),
        ),
        vec3.fromValues(
            Math.max(a.max[0], b.max[0]),
            Math.max(a.max[1], b.max[1]),
            Math.max(a.max[2], b.max[2]),
        ),
    );
}